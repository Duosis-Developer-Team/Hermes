# =============================================================================
# HERMES - Meeting schemas
# =============================================================================
# Response shapes for the Meetings module + the structured result the
# sync service hands back to its caller. Kept deliberately separate
# from the Graph wire format so the Graph adapter can change without
# rippling into the API.
# =============================================================================

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel


class MeetingAttendeeResponse(BaseModel):
    id: UUID
    meeting_id: UUID
    email: str
    display_name: Optional[str] = None
    hermes_user_id: Optional[UUID] = None
    response_status: Optional[str] = None
    attendee_type: Optional[str] = None


class MeetingResponse(BaseModel):
    id: UUID
    external_event_id: str
    source: str
    subject: str
    body_preview: Optional[str] = None
    organizer_email: Optional[str] = None
    organizer_name: Optional[str] = None
    start_datetime: datetime
    end_datetime: datetime
    timezone: Optional[str] = None
    duration_minutes: Optional[int] = None
    join_url: Optional[str] = None
    is_online_meeting: bool
    is_cancelled: bool
    sensitivity: str
    last_synced_at: Optional[datetime] = None
    attendees: List[MeetingAttendeeResponse] = []


class MeetingSyncResult(BaseModel):
    """Returned by the sync service so the caller (an admin
    endpoint, or in future a scheduler) can render or log a summary
    without re-parsing the database."""

    ok: bool
    error: Optional[str] = None
    users_attempted: int = 0
    users_succeeded: int = 0
    meetings_upserted: int = 0
    meetings_cancelled: int = 0
    attendees_upserted: int = 0
    # Per-user breakdown for the admin UI's sync-status table later.
    per_user: List[dict] = []
