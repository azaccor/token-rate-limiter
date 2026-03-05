"""
CRUD routes for user_token_limits.
"""

import logging
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.db import db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/limits", tags=["limits"])


class LimitCreate(BaseModel):
    entity_type: str          # user | service_principal | group
    entity_name: str
    model_name: Optional[str] = None  # None = all models
    limit_type: str           # tokens | dollars
    limit_value: float
    window_type: str          # hours | days | weeks | months | total
    window_units: int = 1
    override: bool = False


class LimitUpdate(BaseModel):
    entity_type: Optional[str] = None
    entity_name: Optional[str] = None
    model_name: Optional[str] = None
    limit_type: Optional[str] = None
    limit_value: Optional[float] = None
    window_type: Optional[str] = None
    window_units: Optional[int] = None
    override: Optional[bool] = None


@router.get("")
def list_limits(
    entity_type: Optional[str] = None,
    entity_name: Optional[str] = None,
    model_name: Optional[str] = None,
):
    """List all token limits with optional filters."""
    sql = "SELECT * FROM user_token_limits WHERE 1=1"
    params = []

    if entity_type:
        sql += " AND entity_type = %s"
        params.append(entity_type)
    if entity_name:
        sql += " AND entity_name = %s"
        params.append(entity_name)
    if model_name:
        sql += " AND model_name = %s"
        params.append(model_name)

    sql += " ORDER BY updated_at DESC"
    rows = db.execute(sql, params if params else None)
    return rows if rows else []


@router.get("/{limit_id}")
def get_limit(limit_id: int):
    """Get a single limit by ID."""
    row = db.execute_one("SELECT * FROM user_token_limits WHERE id = %s", (limit_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Limit not found")
    return row


@router.post("", status_code=201)
def create_limit(body: LimitCreate):
    """Create a new token limit."""
    # Validate override
    if body.override and body.entity_type == "group":
        raise HTTPException(
            status_code=400,
            detail="Override is only valid for user or service_principal entity types",
        )

    rows = db.execute_returning(
        """
        INSERT INTO user_token_limits
            (entity_type, entity_name, model_name, limit_type, limit_value,
             window_type, window_units, override)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING *
        """,
        (
            body.entity_type,
            body.entity_name,
            body.model_name,
            body.limit_type,
            body.limit_value,
            body.window_type,
            body.window_units,
            body.override,
        ),
    )
    return rows[0] if rows else {}


@router.put("/{limit_id}")
def update_limit(limit_id: int, body: LimitUpdate):
    """Update an existing token limit."""
    existing = db.execute_one("SELECT * FROM user_token_limits WHERE id = %s", (limit_id,))
    if not existing:
        raise HTTPException(status_code=404, detail="Limit not found")

    # Build dynamic update
    fields = []
    params = []
    for field_name, value in body.model_dump(exclude_none=True).items():
        fields.append(f"{field_name} = %s")
        params.append(value)

    if not fields:
        return existing

    fields.append("updated_at = CURRENT_TIMESTAMP")
    params.append(limit_id)

    sql = f"UPDATE user_token_limits SET {', '.join(fields)} WHERE id = %s RETURNING *"
    rows = db.execute_returning(sql, params)
    return rows[0] if rows else existing


@router.delete("/{limit_id}")
def delete_limit(limit_id: int):
    """Delete a token limit."""
    count = db.execute_write("DELETE FROM user_token_limits WHERE id = %s", (limit_id,))
    if count == 0:
        raise HTTPException(status_code=404, detail="Limit not found")
    return {"deleted": True, "id": limit_id}
