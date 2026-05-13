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

from datetime import date
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.meeting import Meeting, MeetingAttendee
from ..schemas.meeting import MeetingAttendeeResponse, MeetingResponse
from ..services import meeting_service
from shared.auth import CurrentUser, get_current_user


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
