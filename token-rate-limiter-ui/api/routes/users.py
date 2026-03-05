"""
Routes for listing workspace users, service principals, and groups.
"""

import logging
from typing import Optional
from fastapi import APIRouter, Query

from databricks.sdk import WorkspaceClient

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["identity"])

_workspace_client: Optional[WorkspaceClient] = None


def _get_ws() -> WorkspaceClient:
    global _workspace_client
    if _workspace_client is None:
        _workspace_client = WorkspaceClient()
    return _workspace_client


@router.get("/users")
def list_users(search: str = Query("", description="Filter by name or email")):
    """List workspace users with display name and email."""
    w = _get_ws()
    results = []
    try:
        for u in w.users.list(
            filter=f'displayName co "{search}"' if search else None,
            count=100,
        ):
            email = ""
            if u.emails:
                for e in u.emails:
                    if getattr(e, "primary", False):
                        email = e.value or ""
                        break
                    if not email and e.value:
                        email = e.value
            results.append({
                "id": u.id,
                "displayName": u.display_name or email or u.user_name or "",
                "email": email or u.user_name or "",
                "userName": u.user_name or "",
            })
    except Exception as e:
        logger.error(f"Error listing users: {e}")
    return results


@router.get("/service-principals")
def list_service_principals(search: str = Query("", description="Filter by name")):
    """List workspace service principals."""
    w = _get_ws()
    results = []
    try:
        for sp in w.service_principals.list(
            filter=f'displayName co "{search}"' if search else None,
            count=100,
        ):
            results.append({
                "id": sp.id,
                "displayName": sp.display_name or "",
                "applicationId": sp.application_id or "",
            })
    except Exception as e:
        logger.error(f"Error listing service principals: {e}")
    return results


@router.get("/groups")
def list_groups(search: str = Query("", description="Filter by name")):
    """List workspace groups."""
    w = _get_ws()
    results = []
    try:
        for g in w.groups.list(
            filter=f'displayName co "{search}"' if search else None,
            count=100,
        ):
            results.append({
                "id": g.id,
                "displayName": g.display_name or "",
            })
    except Exception as e:
        logger.error(f"Error listing groups: {e}")
    return results
