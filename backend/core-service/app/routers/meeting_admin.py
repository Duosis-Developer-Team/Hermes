# =============================================================================
# HERMES - Meeting admin router
# =============================================================================
# Admin-only endpoints that drive the Microsoft Graph sync. The
# heavy lifting lives in meeting_service / graph_service — this
# router is just the HTTP boundary.
#
#   POST /admin/meetings/sync           — pull a date range from Graph
#   GET  /admin/meetings/sync-status    — last-synced summary
#
# Auth-service is queried for the active-user list because the
# email → Hermes user mapping is needed to grant visibility
# downstream. The admin's own request cookie / Bearer is forwarded
# as the auth header. We never log it.
# =============================================================================

import logging
from datetime import date
from typing import Optional
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models.meeting import Meeting
from ..schemas.meeting import MeetingSyncResult
from ..services import meeting_service
from ..services.graph_service import get_graph_client
from shared.auth import (
    ACCESS_TOKEN_COOKIE_NAME,
    CurrentUser,
    require_admin,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/meetings", tags=["Meeting Admin"])


# ---------------------------------------------------------------------------
# Request / response shapes
# ---------------------------------------------------------------------------

class MeetingSyncRequest(BaseModel):
    start_date: date
    end_date: date
    user_id: Optional[UUID] = None


class MeetingSyncStatus(BaseModel):
    configured: bool
    total_meetings: int
    last_synced_at: Optional[str] = None
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_token(request: Request) -> Optional[str]:
    """Pull the caller's JWT from the HttpOnly cookie or the
    Authorization: Bearer header — same precedence shared/auth uses.
    Forwarded to auth-service for the /users/lookup call so we can
    build the email→Hermes-user-id map. The token is never logged."""
    cookie = request.cookies.get(ACCESS_TOKEN_COOKIE_NAME)
    if cookie:
        return cookie
    header = request.headers.get("Authorization") or request.headers.get(
        "authorization"
    )
    if header and header.lower().startswith("bearer "):
        return header.split(" ", 1)[1].strip()
    return None


async def _fetch_active_users(token: str) -> list[dict]:
    """Pull every active Hermes user from auth-service. Returns a list
    of {id, email, full_name, is_active} dicts. Empty list on failure
    (the sync runner will then report 'no users' instead of crashing).
    """
    settings = get_settings()
    base = settings.AUTH_SERVICE_URL.rstrip("/")
    # AUTH_SERVICE_URL may already include /api/v1 (k8s configmap
    # convention). Normalise either form.
    if base.endswith("/api/v1"):
        base = base[: -len("/api/v1")]
    url = f"{base}/api/v1/auth/users/lookup"
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
        if resp.status_code != 200:
            logger.warning(
                "auth-service /users/lookup failed status=%s", resp.status_code
            )
            return []
        data = resp.json()
        if not isinstance(data, list):
            return []
        return data
    except Exception as e:
        logger.warning("auth-service /users/lookup error: %s", e)
        return []


# ---------------------------------------------------------------------------
# POST /admin/meetings/sync
# ---------------------------------------------------------------------------

@router.post("/sync", response_model=MeetingSyncResult)
async def sync_meetings(
    payload: MeetingSyncRequest,
    request: Request,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Pull Microsoft Graph calendar events for the given date range
    into Hermes.

      - With `user_id`: sync only that Hermes user's calendar (still
        upserts attendees + meetings for everyone invited).
      - Without `user_id`: sync every active Hermes user's calendar
        sequentially (Option A in the design doc — Graph rate-limit
        friendly).

    Fails gracefully when Microsoft Graph is unconfigured or admin
    consent hasn't been granted; the response carries an `error`
    string the UI can show as a toast.
    """
    if payload.end_date < payload.start_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="end_date must be on or after start_date.",
        )

    # Short-circuit before reaching out to auth-service if Graph
    # isn't configured at all — saves a round trip and gives a
    # clearer error.
    client = get_graph_client()
    if not client.is_configured:
        return MeetingSyncResult(
            ok=False,
            error=(
                "Microsoft Graph is not configured on this deployment. "
                "Set AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET "
                "on the core-service and grant admin consent for "
                "Calendars.Read in Azure Portal."
            ),
            users_attempted=0,
            users_succeeded=0,
        )

    token = _extract_token(request)
    if not token:
        # require_admin should have failed first, but defend anyway.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token missing.",
        )

    users = await _fetch_active_users(token)
    # Build the email → Hermes user UUID dict the service expects.
    user_map: dict[str, UUID] = {}
    email_to_id_for_lookup: dict[str, UUID] = {}
    for u in users:
        email = (u.get("email") or "").strip().lower()
        uid_raw = u.get("id")
        if not email or not uid_raw:
            continue
        try:
            uid = UUID(uid_raw)
        except Exception:
            continue
        user_map[email] = uid
        email_to_id_for_lookup[email] = uid

    # Pick which emails to actually pull from Graph.
    if payload.user_id is not None:
        # Single-user sync: find that user's email in the lookup
        # and run only for them.
        target_email = next(
            (
                email
                for email, uid in email_to_id_for_lookup.items()
                if uid == payload.user_id
            ),
            None,
        )
        if not target_email:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Target user not found among active Hermes users.",
            )
        emails_to_sync = [target_email]
    else:
        # Full company sync. Active users only — list() preserves the
        # auth-service ordering (sorted by full_name) for predictable
        # progress logging.
        emails_to_sync = [
            (u.get("email") or "").strip()
            for u in users
            if (u.get("email") or "").strip()
            and (u.get("is_active") is None or u.get("is_active") is True)
        ]
        if not emails_to_sync:
            return MeetingSyncResult(
                ok=False,
                error="No active Hermes users to sync.",
            )

    logger.info(
        "meetings sync requested by admin=%s users=%d range=%s..%s",
        admin.id,
        len(emails_to_sync),
        payload.start_date,
        payload.end_date,
    )

    result = await meeting_service.sync_all_active_users_range(
        db,
        user_emails=emails_to_sync,
        start_date=payload.start_date,
        end_date=payload.end_date,
        user_map=user_map,
    )
    return result


# ---------------------------------------------------------------------------
# GET /admin/meetings/sync-status
# ---------------------------------------------------------------------------

@router.get("/sync-status", response_model=MeetingSyncStatus)
async def get_sync_status(
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Lightweight snapshot the admin UI can poll: is Graph configured,
    how many meetings are in the DB, and when was the most recent
    last_synced_at."""
    client = get_graph_client()
    total = db.query(func.count(Meeting.id)).scalar() or 0
    most_recent = (
        db.query(func.max(Meeting.last_synced_at)).scalar()
    )
    return MeetingSyncStatus(
        configured=client.is_configured,
        total_meetings=int(total),
        last_synced_at=most_recent.isoformat() if most_recent else None,
        error=None,
    )
