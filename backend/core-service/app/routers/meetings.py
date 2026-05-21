# =============================================================================
# HERMES - Meetings router (user-facing)
# =============================================================================
# Read-only endpoints for the Meetings calendar page. All visibility
# is enforced by meeting_service.list_meetings_for_user /
# get_meeting_for_user — admin sees all (or a target user), non-admin
# sees only meetings where they are a mapped attendee. Existence of
# meetings outside the caller's scope never leaks (single-fetch
# denials return 404, not 403).
# =============================================================================

import logging
from datetime import date, timedelta
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.meeting import Meeting, MeetingAttendee
from ..schemas.meeting import (
    MeetingAttendeeResponse,
    MeetingResponse,
    MeetingSyncResult,
)
from ..services import meeting_service
from ..services.graph_service import get_graph_client
from shared.auth import CurrentUser, get_current_user, require_admin


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/meetings", tags=["Meetings"])


def _serialize_attendee(a: MeetingAttendee) -> MeetingAttendeeResponse:
    return MeetingAttendeeResponse(
        id=a.id,
        meeting_id=a.meeting_id,
        email=a.email,
        display_name=a.display_name,
        hermes_user_id=a.hermes_user_id,
        response_status=a.response_status,
        attendee_type=a.attendee_type,
    )


def _serialize_meeting(m: Meeting) -> MeetingResponse:
    return MeetingResponse(
        id=m.id,
        external_event_id=m.external_event_id,
        source=m.source,
        subject=m.subject,
        body_preview=m.body_preview,
        organizer_email=m.organizer_email,
        organizer_name=m.organizer_name,
        start_datetime=m.start_datetime,
        end_datetime=m.end_datetime,
        timezone=m.timezone,
        duration_minutes=m.duration_minutes,
        join_url=m.join_url,
        is_online_meeting=bool(m.is_online_meeting),
        is_cancelled=bool(m.is_cancelled),
        sensitivity=m.sensitivity,
        last_synced_at=m.last_synced_at,
        attendees=[_serialize_attendee(a) for a in (m.attendees or [])],
    )


@router.get("", response_model=List[MeetingResponse])
async def list_meetings(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    user_ids: Optional[str] = Query(
        None,
        description=(
            "Admin only: comma-separated Hermes user IDs to view. The "
            "result is the UNION of those users' meetings. Empty/omitted "
            "= every meeting. Non-admin callers always see their own — "
            "this param is silently ignored for them."
        ),
    ),
    include_cancelled: bool = Query(False),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_user_ids: Optional[List[UUID]] = None
    if user_ids:
        parsed: List[UUID] = []
        for chunk in user_ids.split(","):
            chunk = chunk.strip()
            if not chunk:
                continue
            try:
                parsed.append(UUID(chunk))
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid user id in user_ids: {chunk}",
                )
        target_user_ids = parsed or None

    meetings = meeting_service.list_meetings_for_user(
        db,
        current_user,
        start_date=start_date,
        end_date=end_date,
        target_user_ids=target_user_ids,
        include_cancelled=include_cancelled,
    )
    return [_serialize_meeting(m) for m in meetings]


class SyncMeRequest(BaseModel):
    start_date: Optional[date] = None
    end_date: Optional[date] = None


class SyncUserRequest(BaseModel):
    """Admin payload to sync one specific user's calendar. The email
    is supplied by the caller (the frontend already has it from the
    user lookup), so this path never calls auth-service either."""

    user_id: UUID
    email: str
    start_date: Optional[date] = None
    end_date: Optional[date] = None


def _resolve_week_range(
    start_date: Optional[date], end_date: Optional[date]
) -> tuple[date, date]:
    """Default an unset range to the current ISO week (Mon–Sun)."""
    today = date.today()
    start = start_date or (today - timedelta(days=today.weekday()))
    end = end_date or (start + timedelta(days=6))
    if end < start:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="end_date must be on or after start_date.",
        )
    return start, end


async def _sync_one_calendar(
    db: Session,
    *,
    email: str,
    user_id: UUID,
    start: date,
    end: date,
) -> MeetingSyncResult:
    """Sync a single user's Graph calendar for a date range, mapping
    that user's own email -> Hermes id so the meetings become visible
    to them. No auth-service round trip — the (email, user_id) pair is
    supplied by the caller (own JWT for /sync-me, request body for the
    admin /sync-user). Fails gracefully when Graph is unconfigured."""
    client = get_graph_client()
    if not client.is_configured:
        return MeetingSyncResult(
            ok=False,
            error="Microsoft Graph is not configured on this deployment.",
            users_attempted=0,
            users_succeeded=0,
        )

    email = (email or "").strip()
    if not email:
        return MeetingSyncResult(
            ok=False,
            error="No email on file to sync.",
            users_attempted=0,
            users_succeeded=0,
        )

    user_map = {email.lower(): user_id}
    summary = await meeting_service.sync_user_meetings(
        db,
        user_email=email,
        start_date=start,
        end_date=end,
        user_map=user_map,
    )
    return MeetingSyncResult(
        ok=bool(summary["ok"]),
        error=summary.get("error"),
        users_attempted=1,
        users_succeeded=1 if summary["ok"] else 0,
        meetings_upserted=summary["meetings_upserted"],
        meetings_cancelled=summary["meetings_cancelled"],
        attendees_upserted=summary["attendees_upserted"],
        per_user=[summary],
    )


@router.post("/sync-me", response_model=MeetingSyncResult)
async def sync_my_meetings(
    payload: SyncMeRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Sync ONLY the calling user's own Microsoft Graph calendar for a
    date range (defaults to the current ISO week).

    This is the auto-sync path the Meetings page fires on load, so a
    user always sees fresh meetings without an admin pressing "Sync".
    The email -> Hermes-user-id map is built from the caller's own JWT
    claims (id + email), so it keeps working even when the internal
    auth-service hop is unavailable.
    """
    start, end = _resolve_week_range(payload.start_date, payload.end_date)
    return await _sync_one_calendar(
        db,
        email=current_user.email,
        user_id=UUID(current_user.id),
        start=start,
        end=end,
    )


@router.post("/sync-user", response_model=MeetingSyncResult)
async def sync_user_meetings_admin(
    payload: SyncUserRequest,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Admin only — sync ONE specific user's calendar (the user the
    admin is viewing in the Meetings selector). The frontend passes the
    target's id + email from the user lookup it already loaded, so this
    path also avoids the core -> auth-service hop that breaks the legacy
    company-wide sync. Lets an admin see a teammate's calendar without
    waiting for that teammate to log in and self-sync."""
    start, end = _resolve_week_range(payload.start_date, payload.end_date)
    return await _sync_one_calendar(
        db,
        email=payload.email,
        user_id=payload.user_id,
        start=start,
        end=end,
    )


@router.get("/{meeting_id}", response_model=MeetingResponse)
async def get_meeting(
    meeting_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    meeting = meeting_service.get_meeting_for_user(
        db, current_user, meeting_id
    )
    return _serialize_meeting(meeting)
