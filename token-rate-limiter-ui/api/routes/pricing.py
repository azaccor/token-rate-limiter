"""
Routes for model pricing management.
"""

import logging
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.db import db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/pricing", tags=["pricing"])


class PricingUpdate(BaseModel):
    input_price_per_token: Optional[float] = None
    output_price_per_token: Optional[float] = None


@router.get("")
def list_pricing():
    """List all model pricing."""
    rows = db.execute("SELECT * FROM model_pricing ORDER BY model_name")
    return rows if rows else []


@router.get("/{model_name}")
def get_pricing(model_name: str):
    """Get pricing for a specific model."""
    row = db.execute_one("SELECT * FROM model_pricing WHERE model_name = %s", (model_name,))
    if not row:
        raise HTTPException(status_code=404, detail="Model not found")
    return row


@router.put("/{model_name}")
def update_pricing(model_name: str, body: PricingUpdate):
    """Update pricing for a model."""
    existing = db.execute_one(
        "SELECT * FROM model_pricing WHERE model_name = %s", (model_name,)
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Model not found")

    fields = []
    params = []
    if body.input_price_per_token is not None:
        fields.append("input_price_per_token = %s")
        params.append(body.input_price_per_token)
    if body.output_price_per_token is not None:
        fields.append("output_price_per_token = %s")
        params.append(body.output_price_per_token)

    if not fields:
        return existing

    fields.append("updated_at = CURRENT_TIMESTAMP")
    params.append(model_name)

    sql = f"UPDATE model_pricing SET {', '.join(fields)} WHERE model_name = %s RETURNING *"
    rows = db.execute_returning(sql, params)
    return rows[0] if rows else existing
