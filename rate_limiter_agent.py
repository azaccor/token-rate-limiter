"""
TokenRateLimiterAgent — Standalone rate limiter that enforces token/dollar
limits defined in user_token_limits, logs usage with cost data to token_usage,
and returns quota information in custom_outputs.

Usage:
    agent = TokenRateLimiterAgent(
        db_config={
            "host": "<YOUR_LAKEBASE_HOST>",
            "port": 5432,
            "dbname": "databricks_postgres",
            "sslmode": "require",
        },
        workspace_client=WorkspaceClient(),
        endpoint_name="ep-...",
        group_members={
            "data-science-team": ["alice@company.com", "bob@company.com"],
            "engineering": ["charlie@company.com"],
        },
    )

    # Before calling the FM endpoint:
    quota = agent.check_quota("alice@company.com", "databricks-claude-sonnet-4-5")
    if not quota["allowed"]:
        # Return 429 or block the request
        ...

    # After the FM call completes:
    agent.log_usage(
        user_name="alice@company.com",
        model_name="databricks-claude-sonnet-4-5",
        prompt_tokens=1200,
        completion_tokens=350,
        request_id="req-abc123",
    )
"""

import logging
import time
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

import psycopg2
import psycopg2.pool

logger = logging.getLogger(__name__)


class TokenRateLimiterAgent:
    """Enforces token and dollar rate limits using Lakebase as the backing store."""

    def __init__(
        self,
        db_config: Dict[str, Any],
        workspace_client: Any,
        endpoint_name: str,
        group_members: Optional[Dict[str, List[str]]] = None,
    ):
        """
        Args:
            db_config: psycopg2 connection parameters (host, port, dbname, sslmode).
            workspace_client: A databricks.sdk.WorkspaceClient instance for
                              generating OAuth credentials.
            endpoint_name: The Lakebase endpoint name for credential generation.
            group_members: Mapping of group name -> list of user/SP names.
                           Populated at load_context time by querying the
                           Databricks groups API.
        """
        self._db_config = db_config
        self._ws = workspace_client
        self._endpoint_name = endpoint_name
        self._group_members = group_members or {}
        self._pool: Optional[psycopg2.pool.ThreadedConnectionPool] = None
        self._token_expires: float = 0

        # Build reverse lookup: user_name -> list of group names
        self._user_groups: Dict[str, List[str]] = {}
        for group_name, members in self._group_members.items():
            for member in members:
                self._user_groups.setdefault(member, []).append(group_name)

        # Cache model pricing
        self._pricing_cache: Dict[str, Dict[str, Decimal]] = {}
        self._pricing_loaded: float = 0

    # ------------------------------------------------------------------
    # Connection management
    # ------------------------------------------------------------------

    def _generate_token(self) -> str:
        cred = self._ws.postgres.generate_database_credential(
            endpoint=self._endpoint_name
        )
        self._token_expires = time.time() + 45 * 60
        return cred.password

    def _get_pool(self) -> psycopg2.pool.ThreadedConnectionPool:
        if self._pool is None or time.time() >= self._token_expires:
            if self._pool:
                try:
                    self._pool.closeall()
                except Exception:
                    pass
            token = self._generate_token()
            self._pool = psycopg2.pool.ThreadedConnectionPool(
                minconn=1,
                maxconn=5,
                host=self._db_config["host"],
                port=self._db_config.get("port", 5432),
                dbname=self._db_config.get("dbname", "databricks_postgres"),
                user="databricks",
                password=token,
                sslmode=self._db_config.get("sslmode", "require"),
                connect_timeout=10,
            )
        return self._pool

    def _query(self, sql: str, params=None) -> List[Dict[str, Any]]:
        pool = self._get_pool()
        conn = pool.getconn()
        try:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                if cur.description:
                    cols = [d[0] for d in cur.description]
                    return [dict(zip(cols, row)) for row in cur.fetchall()]
                return []
        except psycopg2.OperationalError as e:
            if "password" in str(e).lower() or "auth" in str(e).lower():
                logger.warning("Auth error, refreshing token")
                pool.putconn(conn, close=True)
                self._pool = None
                self._token_expires = 0
                return self._query(sql, params)  # Retry once
            raise
        finally:
            try:
                pool.putconn(conn)
            except Exception:
                pass

    def _execute(self, sql: str, params=None) -> int:
        pool = self._get_pool()
        conn = pool.getconn()
        try:
            conn.autocommit = False
            with conn.cursor() as cur:
                cur.execute(sql, params)
                conn.commit()
                return cur.rowcount
        except Exception:
            conn.rollback()
            raise
        finally:
            try:
                pool.putconn(conn)
            except Exception:
                pass

    # ------------------------------------------------------------------
    # Pricing
    # ------------------------------------------------------------------

    def _load_pricing(self):
        """Load model pricing into cache (refreshes every 5 minutes)."""
        if time.time() - self._pricing_loaded < 300 and self._pricing_cache:
            return
        rows = self._query("SELECT model_name, input_price_per_token, output_price_per_token FROM model_pricing")
        self._pricing_cache = {
            r["model_name"]: {
                "input": Decimal(str(r["input_price_per_token"])),
                "output": Decimal(str(r["output_price_per_token"])),
            }
            for r in rows
        }
        self._pricing_loaded = time.time()

    def _get_pricing(self, model_name: str) -> Tuple[Decimal, Decimal]:
        """Return (input_price_per_token, output_price_per_token)."""
        self._load_pricing()
        p = self._pricing_cache.get(model_name, {"input": Decimal("0"), "output": Decimal("0")})
        return p["input"], p["output"]

    # ------------------------------------------------------------------
    # Quota check
    # ------------------------------------------------------------------

    def _compute_usage_for_window(
        self,
        user_name: str,
        model_name: Optional[str],
        window_type: str,
        window_units: int,
    ) -> Tuple[Decimal, Decimal]:
        """Compute (total_tokens, total_cost_usd) for the given window.

        If model_name is None, aggregates across all models.
        """
        sql = "SELECT COALESCE(SUM(total_tokens), 0) AS tokens, COALESCE(SUM(total_cost_usd), 0) AS cost FROM token_usage WHERE user_name = %s"
        params: list = [user_name]

        if model_name:
            sql += " AND model_name = %s"
            params.append(model_name)

        if window_type != "total":
            sql += f" AND request_timestamp >= NOW() - INTERVAL '%s {window_type}'"
            params.append(window_units)

        row = self._query(sql, params)
        if row:
            return Decimal(str(row[0]["tokens"])), Decimal(str(row[0]["cost"]))
        return Decimal("0"), Decimal("0")

    def check_quota(
        self, user_name: str, model_name: str
    ) -> Dict[str, Any]:
        """Check whether the user is within all applicable rate limits.

        Returns a dict with:
            allowed: bool
            reason: str (if blocked)
            tokens_used: Decimal
            cost_used: Decimal
            token_limit: Decimal | None
            dollar_limit: Decimal | None
            tokens_remaining: Decimal | None
            dollars_remaining: Decimal | None
        """
        result: Dict[str, Any] = {
            "allowed": True,
            "reason": None,
            "tokens_used": Decimal("0"),
            "cost_used": Decimal("0"),
            "token_limit": None,
            "dollar_limit": None,
            "tokens_remaining": None,
            "dollars_remaining": None,
        }

        # 1. Check for override limits first
        override_limits = self._query(
            """
            SELECT * FROM user_token_limits
            WHERE entity_name = %s
              AND (entity_type = 'user' OR entity_type = 'service_principal')
              AND override = TRUE
              AND (model_name = %s OR model_name IS NULL)
            """,
            (user_name, model_name),
        )

        if override_limits:
            # Only evaluate override limits
            return self._evaluate_limits(user_name, model_name, override_limits)

        # 2. Collect all applicable limits
        applicable_limits = []

        # User/SP limits for this specific model
        user_model_limits = self._query(
            """
            SELECT * FROM user_token_limits
            WHERE entity_name = %s
              AND (entity_type = 'user' OR entity_type = 'service_principal')
              AND model_name = %s
              AND override = FALSE
            """,
            (user_name, model_name),
        )
        applicable_limits.extend(user_model_limits)

        # User/SP limits for all models (model_name IS NULL)
        user_all_limits = self._query(
            """
            SELECT * FROM user_token_limits
            WHERE entity_name = %s
              AND (entity_type = 'user' OR entity_type = 'service_principal')
              AND model_name IS NULL
              AND override = FALSE
            """,
            (user_name,),
        )
        applicable_limits.extend(user_all_limits)

        # Group limits
        user_groups = self._user_groups.get(user_name, [])
        for group_name in user_groups:
            group_limits = self._query(
                """
                SELECT * FROM user_token_limits
                WHERE entity_name = %s
                  AND entity_type = 'group'
                  AND (model_name = %s OR model_name IS NULL)
                """,
                (group_name, model_name),
            )
            applicable_limits.extend(group_limits)

        if not applicable_limits:
            return result  # No limits configured, allow

        return self._evaluate_limits(user_name, model_name, applicable_limits)

    def _evaluate_limits(
        self,
        user_name: str,
        model_name: str,
        limits: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Evaluate a list of limits. Block if ANY limit is exceeded."""
        result: Dict[str, Any] = {
            "allowed": True,
            "reason": None,
            "tokens_used": Decimal("0"),
            "cost_used": Decimal("0"),
            "token_limit": None,
            "dollar_limit": None,
            "tokens_remaining": None,
            "dollars_remaining": None,
        }

        min_token_remaining = None
        min_dollar_remaining = None

        for lim in limits:
            lim_model = lim.get("model_name")  # None means all models
            limit_type = lim["limit_type"]
            limit_value = Decimal(str(lim["limit_value"]))
            window_type = lim["window_type"]
            window_units = lim["window_units"]

            tokens_used, cost_used = self._compute_usage_for_window(
                user_name, lim_model, window_type, window_units
            )

            # Track the max usage seen
            if tokens_used > result["tokens_used"]:
                result["tokens_used"] = tokens_used
            if cost_used > result["cost_used"]:
                result["cost_used"] = cost_used

            if limit_type == "tokens":
                remaining = limit_value - tokens_used
                result["token_limit"] = limit_value
                if min_token_remaining is None or remaining < min_token_remaining:
                    min_token_remaining = remaining
                if tokens_used >= limit_value:
                    result["allowed"] = False
                    result["reason"] = (
                        f"Token limit exceeded: {tokens_used} / {limit_value} tokens "
                        f"({window_type}={window_units}, entity={lim['entity_name']}, "
                        f"model={lim_model or 'all'})"
                    )
            elif limit_type == "dollars":
                remaining = limit_value - cost_used
                result["dollar_limit"] = limit_value
                if min_dollar_remaining is None or remaining < min_dollar_remaining:
                    min_dollar_remaining = remaining
                if cost_used >= limit_value:
                    result["allowed"] = False
                    result["reason"] = (
                        f"Dollar limit exceeded: ${cost_used} / ${limit_value} "
                        f"({window_type}={window_units}, entity={lim['entity_name']}, "
                        f"model={lim_model or 'all'})"
                    )

        result["tokens_remaining"] = max(Decimal("0"), min_token_remaining) if min_token_remaining is not None else None
        result["dollars_remaining"] = max(Decimal("0"), min_dollar_remaining) if min_dollar_remaining is not None else None

        return result

    # ------------------------------------------------------------------
    # Usage logging
    # ------------------------------------------------------------------

    def log_usage(
        self,
        user_name: str,
        model_name: str,
        prompt_tokens: int,
        completion_tokens: int,
        request_id: Optional[str] = None,
        response_content: Optional[str] = None,
        request_timestamp: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        """Log a completed request to token_usage with cost computation.

        Returns the computed cost breakdown.
        """
        if request_timestamp is None:
            request_timestamp = datetime.now(timezone.utc)

        total_tokens = prompt_tokens + completion_tokens

        # Compute costs
        input_price, output_price = self._get_pricing(model_name)
        input_token_usd = Decimal(str(prompt_tokens)) * input_price
        output_token_usd = Decimal(str(completion_tokens)) * output_price
        total_cost_usd = input_token_usd + output_token_usd

        self._execute(
            """
            INSERT INTO token_usage
                (user_name, model_name, prompt_tokens, completion_tokens,
                 total_tokens, input_token_usd, output_token_usd, total_cost_usd,
                 request_timestamp, request_id, response_content)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                user_name,
                model_name,
                prompt_tokens,
                completion_tokens,
                total_tokens,
                float(input_token_usd),
                float(output_token_usd),
                float(total_cost_usd),
                request_timestamp,
                request_id,
                response_content,
            ),
        )

        return {
            "input_token_usd": float(input_token_usd),
            "output_token_usd": float(output_token_usd),
            "total_cost_usd": float(total_cost_usd),
            "total_tokens": total_tokens,
        }

    # ------------------------------------------------------------------
    # Custom outputs (for FM response enrichment)
    # ------------------------------------------------------------------

    def custom_outputs(
        self, user_name: str, model_name: str
    ) -> Dict[str, Any]:
        """Return quota information to include in the FM response.

        Call this AFTER log_usage to get updated remaining quota.
        """
        quota = self.check_quota(user_name, model_name)
        outputs = {
            "tokens_used": int(quota["tokens_used"]),
            "cost_used_usd": float(quota["cost_used"]),
        }
        if quota["token_limit"] is not None:
            outputs["token_limit"] = int(quota["token_limit"])
        if quota["dollar_limit"] is not None:
            outputs["dollar_limit"] = float(quota["dollar_limit"])
        if quota["tokens_remaining"] is not None:
            outputs["tokens_remaining"] = int(quota["tokens_remaining"])
        if quota["dollars_remaining"] is not None:
            outputs["dollars_remaining"] = float(quota["dollars_remaining"])
        return outputs

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def close(self):
        """Close the connection pool."""
        if self._pool:
            try:
                self._pool.closeall()
            except Exception:
                pass
            self._pool = None
