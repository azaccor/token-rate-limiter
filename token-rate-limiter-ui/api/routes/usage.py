"""
Routes for querying token usage data and monitoring.
"""

import logging
from typing import Optional
from datetime import datetime
from fastapi import APIRouter, Query, HTTPException

from api.db import db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/usage", tags=["usage"])


@router.get("")
def get_usage(
    user_name: Optional[str] = Query(None),
    model_name: Optional[str] = Query(None),
    start_time: Optional[str] = Query(None, description="ISO datetime"),
    end_time: Optional[str] = Query(None, description="ISO datetime"),
    limit: int = Query(500, ge=1, le=5000),
):
    """Get raw usage records with filters."""
    try:
        sql = "SELECT * FROM token_usage WHERE 1=1"
        params = []

        if user_name:
            sql += " AND user_name = %s"
            params.append(user_name)
        if model_name:
            sql += " AND model_name = %s"
            params.append(model_name)
        if start_time:
            sql += " AND request_timestamp >= %s"
            params.append(start_time)
        if end_time:
            sql += " AND request_timestamp <= %s"
            params.append(end_time)

        sql += " ORDER BY request_timestamp DESC LIMIT %s"
        params.append(limit)

        rows = db.execute(sql, params)
        logger.info(f"Retrieved {len(rows) if rows else 0} usage records")
        return rows if rows else []
    except Exception as exc:
        logger.error("Failed to get usage (table may not exist): %s", exc, exc_info=True)
        # Return empty list instead of error - table may not be initialized yet
        return []


@router.get("/timeseries")
def get_usage_timeseries(
    user_name: Optional[str] = Query(None),
    model_name: Optional[str] = Query(None),
    group_name: Optional[str] = Query(None),
    start_time: Optional[str] = Query(None),
    end_time: Optional[str] = Query(None),
    bucket: str = Query("hour", description="hour | day | week | month"),
    metric: str = Query("tokens", description="tokens | dollars"),
):
    """Get time-bucketed usage for charts."""
    try:
        # Build the time bucket expression
        bucket_map = {
            "hour": "date_trunc('hour', request_timestamp)",
            "day": "date_trunc('day', request_timestamp)",
            "week": "date_trunc('week', request_timestamp)",
            "month": "date_trunc('month', request_timestamp)",
        }
        bucket_expr = bucket_map.get(bucket, bucket_map["hour"])

        # Select metric
        if metric == "dollars":
            metric_expr = "COALESCE(SUM(total_cost_usd), 0)"
        else:
            metric_expr = "COALESCE(SUM(total_tokens), 0)"

        sql = f"""
            SELECT
                {bucket_expr} AS time_bucket,
                model_name,
                {metric_expr} AS value
            FROM token_usage
            WHERE 1=1
        """
        params = []

        if user_name:
            sql += " AND user_name = %s"
            params.append(user_name)
        if model_name:
            sql += " AND model_name = %s"
            params.append(model_name)
        if start_time:
            sql += " AND request_timestamp >= %s"
            params.append(start_time)
        if end_time:
            sql += " AND request_timestamp <= %s"
            params.append(end_time)

        sql += f" GROUP BY {bucket_expr}, model_name ORDER BY time_bucket"

        rows = db.execute(sql, params)
        logger.info(f"Retrieved {len(rows) if rows else 0} timeseries records")
        return rows if rows else []
    except Exception as exc:
        logger.error("Failed to get usage timeseries (table may not exist): %s", exc, exc_info=True)
        # Return empty list instead of error - table may not be initialized yet
        return []


@router.get("/top-consumers")
def get_top_consumers(
    start_time: Optional[str] = Query(None),
    end_time: Optional[str] = Query(None),
    model_name: Optional[str] = Query(None),
    metric: str = Query("tokens"),
    limit: int = Query(10, ge=1, le=50),
):
    """Get top token consumers in a time range."""
    try:
        if metric == "dollars":
            metric_expr = "COALESCE(SUM(total_cost_usd), 0)"
        else:
            metric_expr = "COALESCE(SUM(total_tokens), 0)"

        sql = f"""
            SELECT
                user_name,
                {metric_expr} AS value,
                COUNT(*) AS request_count
            FROM token_usage
            WHERE 1=1
        """
        params = []

        if start_time:
            sql += " AND request_timestamp >= %s"
            params.append(start_time)
        if end_time:
            sql += " AND request_timestamp <= %s"
            params.append(end_time)
        if model_name:
            sql += " AND model_name = %s"
            params.append(model_name)

        sql += f" GROUP BY user_name ORDER BY value DESC LIMIT %s"
        params.append(limit)

        rows = db.execute(sql, params)
        logger.info(f"Retrieved {len(rows) if rows else 0} top consumers")
        return rows if rows else []
    except Exception as exc:
        logger.error("Failed to get top consumers (table may not exist): %s", exc, exc_info=True)
        # Return empty list instead of error - table may not be initialized yet
        return []


@router.get("/near-limit")
def get_near_limit_users(threshold: float = Query(0.9, ge=0, le=1)):
    """Find users approaching their rate limits (>= threshold of limit).

    Since blocked requests are not logged, we identify users at >= 90%
    of any applicable limit as 'approaching limit'.
    """
    try:
        # Get all limits
        limits = db.execute("SELECT * FROM user_token_limits ORDER BY entity_name")
        if not limits:
            logger.info("No limits found")
            return []

        results = []
        for lim in limits:
            entity_name = lim["entity_name"]
            model_name = lim.get("model_name")
            limit_type = lim["limit_type"]
            limit_value = float(lim["limit_value"])
            window_type = lim["window_type"]
            window_units = lim["window_units"]

            # Build usage query
            if limit_type == "dollars":
                metric_expr = "COALESCE(SUM(total_cost_usd), 0)"
            else:
                metric_expr = "COALESCE(SUM(total_tokens), 0)"

            sql = f"SELECT {metric_expr} AS used FROM token_usage WHERE user_name = %s"
            params = [entity_name]

            if model_name:
                sql += " AND model_name = %s"
                params.append(model_name)

            if window_type != "total":
                sql += f" AND request_timestamp >= NOW() - INTERVAL '%s {window_type}'"
                params.append(window_units)

            row = db.execute_one(sql, params)
            used = float(row["used"]) if row else 0

            if limit_value > 0:
                pct = used / limit_value
                if pct >= threshold:
                    results.append({
                        "entity_name": entity_name,
                        "entity_type": lim["entity_type"],
                        "model_name": model_name or "All Models",
                        "limit_type": limit_type,
                        "limit_value": limit_value,
                        "used": round(used, 4),
                        "percentage": round(pct * 100, 1),
                        "window_type": window_type,
                        "window_units": window_units,
                        "status": "exceeded" if pct >= 1.0 else "approaching",
                    })

        results.sort(key=lambda x: x["percentage"], reverse=True)
        logger.info(f"Found {len(results)} near-limit users")
        return results
    except Exception as exc:
        logger.error("Failed to get near-limit users (table may not exist): %s", exc, exc_info=True)
        # Return empty list instead of error - table may not be initialized yet
        return []


@router.get("/gauge")
def get_usage_gauges():
    """For each configured limit, return usage vs limit as a gauge value."""
    try:
        limits = db.execute("SELECT * FROM user_token_limits ORDER BY entity_name")
        if not limits:
            logger.info("No limits found for gauges")
            return []

        gauges = []
        for lim in limits:
            entity_name = lim["entity_name"]
            model_name = lim.get("model_name")
            limit_type = lim["limit_type"]
            limit_value = float(lim["limit_value"])
            window_type = lim["window_type"]
            window_units = lim["window_units"]

            if limit_type == "dollars":
                metric_expr = "COALESCE(SUM(total_cost_usd), 0)"
            else:
                metric_expr = "COALESCE(SUM(total_tokens), 0)"

            sql = f"SELECT {metric_expr} AS used FROM token_usage WHERE user_name = %s"
            params = [entity_name]

            if model_name:
                sql += " AND model_name = %s"
                params.append(model_name)

            if window_type != "total":
                sql += f" AND request_timestamp >= NOW() - INTERVAL '%s {window_type}'"
                params.append(window_units)

            row = db.execute_one(sql, params)
            used = float(row["used"]) if row else 0
            pct = (used / limit_value * 100) if limit_value > 0 else 0

            gauges.append({
                "id": lim["id"],
                "entity_name": entity_name,
                "entity_type": lim["entity_type"],
                "model_name": model_name or "All Models",
                "limit_type": limit_type,
                "limit_value": limit_value,
                "used": round(used, 4),
                "percentage": round(min(pct, 100), 1),
                "window_type": window_type,
                "window_units": window_units,
            })

        logger.info(f"Generated {len(gauges)} gauge values")
        return gauges
    except Exception as exc:
        logger.error("Failed to get usage gauges (table may not exist): %s", exc, exc_info=True)
        # Return empty list instead of error - table may not be initialized yet
        return []
