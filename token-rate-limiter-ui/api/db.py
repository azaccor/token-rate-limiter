"""
Lakebase (PostgreSQL) connection pool.

Uses a native Postgres role (token_rate_limiter_app) with a static password
injected via Databricks Secrets. This is the recommended pattern for Databricks
Apps because the app service principal cannot reliably generate OAuth credentials
for itself at runtime.

The WorkspaceClient is still used for identity-related API calls (users, groups, SPs, models).
"""

import os
import base64
import threading
import logging
from contextlib import contextmanager
from typing import Optional

import psycopg2
import psycopg2.pool

logger = logging.getLogger(__name__)

LAKEBASE_HOST = os.environ.get("POSTGRES_HOST", "<YOUR_LAKEBASE_HOST>")
LAKEBASE_PORT = int(os.environ.get("POSTGRES_PORT", "5432"))
LAKEBASE_DB = os.environ.get("POSTGRES_DB", "databricks_postgres")
LAKEBASE_USER = os.environ.get("POSTGRES_USER", "token_rate_limiter_app")
LAKEBASE_SSLMODE = os.environ.get("POSTGRES_SSLMODE", "require")

_SECRET_SCOPE = os.environ.get("SECRET_SCOPE", "<YOUR_SECRET_SCOPE>")
_SECRET_KEY = os.environ.get("SECRET_KEY", "<YOUR_SECRET_KEY>")


def _resolve_password() -> str:
    """Return the DB password from env var (injected by app.yaml) or Databricks Secrets SDK."""
    pw = os.environ.get("POSTGRES_PASSWORD", "")
    if pw:
        return pw
    # Fallback: fetch directly via Databricks SDK
    try:
        from databricks.sdk import WorkspaceClient
        w = WorkspaceClient()
        result = w.api_client.do(
            "GET",
            "/api/2.0/secrets/get",
            query={"scope": _SECRET_SCOPE, "key": _SECRET_KEY},
        )
        encoded = result.get("value", "")
        if encoded:
            pw = base64.b64decode(encoded).decode("utf-8")
            logger.info("Password resolved via Databricks Secrets SDK")
            return pw
    except Exception as exc:
        logger.error("Could not resolve DB password via SDK: %s", exc)
    return ""


LAKEBASE_PASSWORD = _resolve_password()


class LakebaseConnectionManager:
    """Thread-safe Lakebase connection pool using static credentials."""

    def __init__(self):
        self._pool: Optional[psycopg2.pool.ThreadedConnectionPool] = None
        self._lock = threading.Lock()

    def _create_pool(self) -> psycopg2.pool.ThreadedConnectionPool:
        logger.info(f"Creating Lakebase pool: {LAKEBASE_USER}@{LAKEBASE_HOST}/{LAKEBASE_DB}")
        return psycopg2.pool.ThreadedConnectionPool(
            minconn=1,
            maxconn=10,
            host=LAKEBASE_HOST,
            port=LAKEBASE_PORT,
            dbname=LAKEBASE_DB,
            user=LAKEBASE_USER,
            password=LAKEBASE_PASSWORD,
            sslmode=LAKEBASE_SSLMODE,
            connect_timeout=10,
        )

    def _get_pool(self) -> psycopg2.pool.ThreadedConnectionPool:
        if self._pool is None:
            with self._lock:
                if self._pool is None:
                    self._pool = self._create_pool()
        return self._pool

    def _invalidate_pool(self):
        with self._lock:
            if self._pool is not None:
                try:
                    self._pool.closeall()
                except Exception:
                    pass
                self._pool = None

    @contextmanager
    def get_connection(self):
        pool = self._get_pool()
        conn = None
        try:
            conn = pool.getconn()
            conn.autocommit = False
            yield conn
            conn.commit()
        except psycopg2.OperationalError as e:
            if conn:
                try:
                    conn.rollback()
                    pool.putconn(conn, close=True)
                except Exception:
                    pass
                conn = None
            # Retry once with a fresh pool (handles stale connections)
            logger.warning(f"DB operational error, retrying: {e}")
            self._invalidate_pool()
            pool = self._get_pool()
            conn = pool.getconn()
            conn.autocommit = False
            yield conn
            conn.commit()
        except Exception:
            if conn:
                try:
                    conn.rollback()
                except Exception:
                    pass
            raise
        finally:
            if conn:
                try:
                    pool.putconn(conn)
                except Exception:
                    pass

    def execute(self, sql: str, params=None):
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                if cur.description:
                    cols = [d[0] for d in cur.description]
                    return [dict(zip(cols, row)) for row in cur.fetchall()]
                return []

    def execute_one(self, sql: str, params=None):
        rows = self.execute(sql, params)
        return rows[0] if rows else None

    def execute_write(self, sql: str, params=None):
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                return cur.rowcount

    def execute_returning(self, sql: str, params=None):
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                if cur.description:
                    cols = [d[0] for d in cur.description]
                    return [dict(zip(cols, row)) for row in cur.fetchall()]
                return []


db = LakebaseConnectionManager()
