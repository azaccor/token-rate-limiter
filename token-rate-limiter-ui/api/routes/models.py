"""
Routes for listing available models.
Pulls from serving endpoints (authoritative) merged with model_pricing table.
Excludes embedding-only models (no chat completions).
"""

import logging
from fastapi import APIRouter
from databricks.sdk import WorkspaceClient

from api.db import db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/models", tags=["models"])

_EMBEDDING_KEYWORDS = ("embedding", "gte-", "bge-")


@router.get("")
def list_models():
    """
    Return all FM serving endpoint names that are suitable for chat/completions
    rate limiting, sorted alphabetically.
    Also auto-inserts any new endpoints into model_pricing with $0 defaults
    so they appear in the pricing editor.
    """
    try:
        w = WorkspaceClient()
        endpoints = list(w.serving_endpoints.list())
        all_endpoint_names = [
            ep.name for ep in endpoints
            if ep.name and not any(kw in ep.name.lower() for kw in _EMBEDDING_KEYWORDS)
        ]
        logger.info(f"Found {len(all_endpoint_names)} serving endpoints from SDK")
    except Exception as exc:
        logger.warning("Could not list serving endpoints from SDK: %s", exc)
        all_endpoint_names = []

    # Fall back to pricing table if SDK call failed
    priced = set()
    try:
        rows = db.execute("SELECT model_name FROM model_pricing")
        if rows:
            priced = {r["model_name"] for r in rows}
            logger.info(f"Found {len(priced)} models in pricing table")
        else:
            logger.info("model_pricing table is empty")
    except Exception as exc:
        logger.error("Database query failed (table may not exist): %s", exc, exc_info=True)
        # Return serving endpoints even if DB query fails
        logger.info("Returning serving endpoints only (database unavailable)")

    if not all_endpoint_names:
        logger.info(f"Returning {len(priced)} models from pricing table")
        return sorted(priced)

    # Auto-insert new endpoints into pricing with $0 defaults
    for name in all_endpoint_names:
        if name not in priced:
            try:
                db.execute_returning(
                    "INSERT INTO model_pricing (model_name, input_price_per_token, output_price_per_token) "
                    "VALUES (%s, 0, 0) ON CONFLICT (model_name) DO NOTHING",
                    (name,),
                )
            except Exception as exc:
                logger.warning("Could not auto-insert pricing for %s: %s", name, exc)

    logger.info(f"Returning {len(all_endpoint_names)} models")
    return sorted(all_endpoint_names)
