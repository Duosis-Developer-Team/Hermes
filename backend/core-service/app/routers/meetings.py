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
from shared.auth import CurrentUser, get_current_user


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
    user_id: Optional[UUID] = Query(
        None,
        description=(
            "Admin only: view another user's meetings. Non-admin "
            "callers always see their own — this param is silently "
            "ignored for them."
        ),
    ),
    include_cancelled: bool = Query(False),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    meetings = meeting_service.list_meetings_for_user(
        db,
        current_user,
        start_date=start_date,
        end_date=end_date,
        target_user_id=user_id,
        include_cancelled=include_cancelled,
    )
    return [_serialize_meeting(m) for m in meetings]


class SyncMeRequest(BaseModel):
    start_date: Optional[date] = None
    end_date: Optional[date] = None


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
    Unlike the admin endpoint it never calls auth-service: the
    email -> Hermes-user-id map is built from the caller's own JWT
    claims (id + email), so it keeps working even when the internal
    auth-service hop is unavailable. Each user mapping themselves is
    enough for their own meetings to become visible to them; other
    attendees get mapped when they in turn sync their own calendar.

    Fails gracefully (ok=False + error) when Graph is unconfigured;
    the page just shows whatever is already in the database.
    """
    today = date.today()
    default_start = today - timedelta(days=today.weekday())  # Monday
    start = payload.start_date or default_start
    end = payload.end_date or (start + timedelta(days=6))
    if end < start:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="end_date must be on or after start_date.",
        )

    client = get_graph_client()
    if not client.is_configured:
        return MeetingSyncResult(
            ok=False,
            error=(
                "Microsoft Graph is not configured on this deployment."
            ),
            users_attempted=0,
            users_succeeded=0,
        )

    email = (current_user.email or "").strip()
    if not email:
        return MeetingSyncResult(
            ok=False,
            error="Your account has no email on file to sync.",
            users_attempted=0,
            users_succeeded=0,
        )

    user_map = {email.lower(): UUID(current_user.id)}
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
