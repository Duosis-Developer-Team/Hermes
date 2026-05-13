# =============================================================================
# HERMES - Meeting service
# =============================================================================
# Pure DB + Graph orchestration for the Meetings module. No HTTP yet —
# Stage 3 wires this behind /api/v1/core/meetings endpoints.
#
# Responsibilities:
#   - upsert_event_from_graph: turn one Graph event into a Meeting
#     row + its MeetingAttendee rows, idempotently.
#   - sync_user_meetings: pull a date range from Graph for one user,
#     upsert each event, mark missing-but-known events as cancelled
#     only when Graph explicitly says so.
#   - sync_all_active_users_range: fan-out runner used by the admin
#     "Sync Meetings" button.
#   - list_meetings_for_user: visibility-aware reader used by the
#     Meetings calendar page. Non-admin sees only meetings where they
#     are a mapped attendee. Admin can pass a target user_id.
#   - get_meeting_for_user: same visibility gate for single fetch.
#
# Privacy stance — applied at write time:
#   - sensitivity in {private, confidential}:
#       * subject  → "Private Meeting"
#       * body_preview → None
#       * body content is never read from Graph (we only $select
#         bodyPreview), so there's nothing else to scrub.
#
# Visibility stance — applied at read time:
#   - admin: any meeting
#   - non-admin: meetings where meeting_attendees.hermes_user_id ==
#     current user. External attendees (unmapped emails) never grant
#     access — they're stored for display only.
# =============================================================================

import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Callable, Iterable, List, Mapping, Optional, Sequence
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ..models.meeting import Meeting, MeetingAttendee
from ..schemas.meeting import MeetingSyncResult
from .graph_service import (
    GraphConfigError,
    GraphRequestError,
    get_graph_client,
)
from shared.auth import CurrentUser

logger = logging.getLogger(__name__)

PRIVATE_SENSITIVITIES = {"private", "confidential"}


# =============================================================================
# Upsert
# =============================================================================

def _normalise_dt(value: Optional[Mapping]) -> Optional[datetime]:
    """Convert Graph's `{ dateTime, timeZone }` shape to a tz-aware
    datetime. We always request `outlook.timezone="UTC"` upstream so
    the dateTime is in UTC; this function trusts that and attaches
    tzinfo if it's missing."""
    if not value:
        return None
    raw = value.get("dateTime")
    if not raw:
        return None
    # Graph returns ISO 8601 without a trailing 'Z' in this header
    # mode. Python ≥3.11 handles fromisoformat() with offsetless
    # values; we then attach UTC.
    parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _resolve_user_id(
    email: Optional[str],
    user_map: Mapping[str, UUID],
) -> Optional[UUID]:
    """Email → Hermes user UUID via case-insensitive lookup. The
    caller is responsible for building user_map; meeting_service
    never reaches out to auth-service itself so it stays pure."""
    if not email:
        return None
    return user_map.get(email.strip().lower())


def upsert_event_from_graph(
    db: Session,
    event: Mapping,
    *,
    user_map: Mapping[str, UUID],
    source: str = "microsoft_graph",
) -> tuple[Meeting, int, int]:
    """Idempotently turn one Graph event into Meeting + attendee
    rows. Returns (meeting, upserted_attendee_count, attendees_added).

    Honours privacy rules at write time so private bodies are never
    persisted at rest.
    """
    external_id = event.get("id")
    if not external_id:
        raise ValueError("Graph event without an id")

    start_dt = _normalise_dt(event.get("start"))
    end_dt = _normalise_dt(event.get("end"))
    if start_dt is None or end_dt is None:
        raise ValueError(f"Graph event {external_id} missing start/end")

    duration_minutes = max(
        0, int((end_dt - start_dt).total_seconds() // 60)
    )

    sensitivity = (event.get("sensitivity") or "normal").lower()
    is_private = sensitivity in PRIVATE_SENSITIVITIES

    raw_subject = (event.get("subject") or "").strip()
    if is_private:
        subject = "Private Meeting"
        body_preview = None
    else:
        subject = raw_subject or "(Untitled meeting)"
        # Trim to a manageable preview length; Graph already gives a
        # short bodyPreview but be defensive.
        body_preview = (event.get("bodyPreview") or "").strip() or None
        if body_preview and len(body_preview) > 2000:
            body_preview = body_preview[:2000]

    organizer = event.get("organizer") or {}
    organizer_email = (
        ((organizer.get("emailAddress") or {}).get("address") or "")
        .strip()
        or None
    )
    organizer_name = (
        ((organizer.get("emailAddress") or {}).get("name") or "")
        .strip()
        or None
    )

    online_meeting = event.get("onlineMeeting") or {}
    join_url = (
        event.get("onlineMeetingUrl")
        or online_meeting.get("joinUrl")
        or None
    )

    is_online = bool(event.get("isOnlineMeeting"))
    is_cancelled = bool(event.get("isCancelled"))
    timezone_name = event.get("originalStartTimeZone") or None
    now = datetime.now(timezone.utc)

    # --- Meeting upsert -------------------------------------------------
    meeting = (
        db.query(Meeting)
        .filter(
            Meeting.source == source,
            Meeting.external_event_id == external_id,
        )
        .first()
    )
    if meeting is None:
        meeting = Meeting(
            source=source,
            external_event_id=external_id,
            subject=subject,
            body_preview=body_preview,
            organizer_email=organizer_email,
            organizer_name=organizer_name,
            start_datetime=start_dt,
            end_datetime=end_dt,
            timezone=timezone_name,
            duration_minutes=duration_minutes,
            join_url=join_url,
            is_online_meeting=is_online,
            is_cancelled=is_cancelled,
            sensitivity=sensitivity,
            last_synced_at=now,
        )
        db.add(meeting)
        db.flush()  # need meeting.id for the attendee rows below
    else:
        meeting.subject = subject
        meeting.body_preview = body_preview
        meeting.organizer_email = organizer_email
        meeting.organizer_name = organizer_name
        meeting.start_datetime = start_dt
        meeting.end_datetime = end_dt
        meeting.timezone = timezone_name
        meeting.duration_minutes = duration_minutes
        meeting.join_url = join_url
        meeting.is_online_meeting = is_online
        meeting.is_cancelled = is_cancelled
        meeting.sensitivity = sensitivity
        meeting.last_synced_at = now

    # --- Attendees upsert -----------------------------------------------
    attendees_in: list[dict] = []

    # The organizer is also an attendee from a visibility standpoint.
    if organizer_email:
        attendees_in.append(
            {
                "email": organizer_email,
                "display_name": organizer_name,
                "response_status": "organizer",
                "attendee_type": "organizer",
            }
        )
    for entry in event.get("attendees") or []:
        email_addr = (entry.get("emailAddress") or {}) or {}
        email = (email_addr.get("address") or "").strip()
        if not email:
            continue
        display_name = (email_addr.get("name") or "").strip() or None
        status_obj = entry.get("status") or {}
        attendees_in.append(
            {
                "email": email,
                "display_name": display_name,
                "response_status": (status_obj.get("response") or "none").lower(),
                "attendee_type": (entry.get("type") or "required").lower(),
            }
        )

    # Deduplicate by lower(email).
    seen_emails: set[str] = set()
    deduped: list[dict] = []
    for a in attendees_in:
        key = a["email"].lower()
        if key in seen_emails:
            continue
        seen_emails.add(key)
        deduped.append(a)

    existing = {
        row.email.lower(): row
        for row in db.query(MeetingAttendee)
        .filter(MeetingAttendee.meeting_id == meeting.id)
        .all()
    }
    added = 0
    upserted = 0
    for a in deduped:
        key = a["email"].lower()
        row = existing.get(key)
        hermes_user_id = _resolve_user_id(a["email"], user_map)
        if row is None:
            db.add(
                MeetingAttendee(
                    meeting_id=meeting.id,
                    email=a["email"],
                    display_name=a["display_name"],
                    hermes_user_id=hermes_user_id,
                    response_status=a["response_status"],
                    attendee_type=a["attendee_type"],
                )
            )
            added += 1
            upserted += 1
        else:
            # Keep the row in sync — display name, status, and the
            # email→Hermes-user mapping (the user might have been
            # created in Hermes after the meeting was originally
            # synced).
            row.display_name = a["display_name"]
            row.response_status = a["response_status"]
            row.attendee_type = a["attendee_type"]
            row.hermes_user_id = hermes_user_id
            upserted += 1

    return meeting, upserted, added


# =============================================================================
# Sync — Graph → DB
# =============================================================================

def _to_iso_utc(d: date) -> str:
    """date → ISO 8601 in UTC. start uses 00:00, end uses next day's
    00:00 so the range is inclusive of the entire end_date."""
    return datetime.combine(d, time.min, tzinfo=timezone.utc).isoformat()


async def sync_user_meetings(
    db: Session,
    *,
    user_email: str,
    start_date: date,
    end_date: date,
    user_map: Mapping[str, UUID],
) -> dict:
    """Pull a date range from Graph for one user and upsert each
    event. Returns a small summary dict for the caller.

    Errors (config / Graph HTTP) are caught and surfaced in the
    return dict so a single bad user doesn't tank a multi-user run.
    """
    client = get_graph_client()
    start_iso = _to_iso_utc(start_date)
    end_iso = _to_iso_utc(end_date + timedelta(days=1))

    summary = {
        "user_email": user_email,
        "ok": False,
        "error": None,
        "meetings_upserted": 0,
        "meetings_cancelled": 0,
        "attendees_upserted": 0,
    }
    try:
        async for event in client.iter_calendar_view(
            user_email=user_email,
            start_iso=start_iso,
            end_iso=end_iso,
        ):
            meeting, upserted, _added = upsert_event_from_graph(
                db, event, user_map=user_map
            )
            summary["meetings_upserted"] += 1
            summary["attendees_upserted"] += upserted
            if meeting.is_cancelled:
                summary["meetings_cancelled"] += 1
        db.commit()
        summary["ok"] = True
    except GraphConfigError as e:
        db.rollback()
        summary["error"] = str(e)
    except GraphRequestError as e:
        db.rollback()
        summary["error"] = e.message
        logger.warning(
            "meeting sync user_email=%s graph_error=%s",
            user_email,
            e.message,
        )
    except Exception as e:  # last-resort guard
        db.rollback()
        summary["error"] = f"Unexpected error: {e}"
        logger.exception(
            "meeting sync user_email=%s unexpected error", user_email
        )
    return summary


async def sync_all_active_users_range(
    db: Session,
    *,
    user_emails: Sequence[str],
    start_date: date,
    end_date: date,
    user_map: Mapping[str, UUID],
) -> MeetingSyncResult:
    """Run sync_user_meetings sequentially for every email. Sequential
    on purpose — Graph rate limits per-app, and a serial loop stays
    well within them for typical company headcount. A future scheduler
    can shard by user across pods if it ever matters.

    `user_map` is the caller-built email→Hermes-user-UUID dict; we
    don't reach out to auth-service from here so the service stays
    testable without it.
    """
    result = MeetingSyncResult(
        ok=True,
        users_attempted=0,
        users_succeeded=0,
        meetings_upserted=0,
        meetings_cancelled=0,
        attendees_upserted=0,
        per_user=[],
    )
    if not user_emails:
        return result

    client = get_graph_client()
    if not client.is_configured:
        result.ok = False
        result.error = (
            "Microsoft Graph is not configured on this deployment."
        )
        return result

    for email in user_emails:
        result.users_attempted += 1
        summary = await sync_user_meetings(
            db,
            user_email=email,
            start_date=start_date,
            end_date=end_date,
            user_map=user_map,
        )
        if summary["ok"]:
            result.users_succeeded += 1
            result.meetings_upserted += summary["meetings_upserted"]
            result.meetings_cancelled += summary["meetings_cancelled"]
            result.attendees_upserted += summary["attendees_upserted"]
        result.per_user.append(summary)

    if result.users_succeeded == 0 and result.users_attempted > 0:
        # Surface the first user's error so the admin button gives
        # a useful toast instead of a silent "0 meetings".
        first_err = next(
            (u["error"] for u in result.per_user if u.get("error")),
            None,
        )
        result.ok = False
        result.error = first_err or "Sync completed but no user succeeded."

    return result


# =============================================================================
# Visibility-aware reads
# =============================================================================

def _user_can_view_meeting(
    user: CurrentUser, meeting: Meeting, viewer_uuid: UUID
) -> bool:
    if user.is_admin:
        return True
    # Walk the attendee rows to check mapping.
    for a in meeting.attendees:
        if a.hermes_user_id == viewer_uuid:
            return True
    return False


def list_meetings_for_user(
    db: Session,
    user: CurrentUser,
    *,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    target_user_id: Optional[UUID] = None,
    include_cancelled: bool = False,
) -> List[Meeting]:
    """Return meetings visible to `user`, optionally narrowed to a
    target user (admin only) and/or a date window.

    Visibility:
      - admin: every meeting; if target_user_id is set, restricted to
        meetings where that user is a mapped attendee.
      - non-admin: meetings where the CURRENT user is a mapped
        attendee. target_user_id from a non-admin is coerced to
        their own id (defense-in-depth, matches tasks).
    """
    query = db.query(Meeting).join(MeetingAttendee, MeetingAttendee.meeting_id == Meeting.id)

    if user.is_admin:
        if target_user_id is not None:
            query = query.filter(MeetingAttendee.hermes_user_id == target_user_id)
    else:
        viewer = UUID(user.id)
        query = query.filter(MeetingAttendee.hermes_user_id == viewer)

    if not include_cancelled:
        query = query.filter(Meeting.is_cancelled.is_(False))

    if start_date:
        query = query.filter(
            Meeting.start_datetime
            >= datetime.combine(start_date, time.min, tzinfo=timezone.utc)
        )
    if end_date:
        query = query.filter(
            Meeting.start_datetime
            <= datetime.combine(end_date, time.max, tzinfo=timezone.utc)
        )

    # DISTINCT on Meeting.id — the join above can multiply rows if a
    # meeting has several attendee rows for the same user (it
    # shouldn't, but defend anyway).
    return (
        query.order_by(Meeting.start_datetime.asc())
        .distinct(Meeting.id)
        .all()
    )


def get_meeting_for_user(
    db: Session, user: CurrentUser, meeting_id: UUID
) -> Meeting:
    """Fetch a single meeting with attendees, enforcing visibility.
    Unrelated users get a 404 — never a 403 — so the existence of
    other people's meetings never leaks."""
    meeting = (
        db.query(Meeting).filter(Meeting.id == meeting_id).first()
    )
    if meeting is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Meeting not found.",
        )
    viewer_uuid = UUID(user.id)
    if not _user_can_view_meeting(user, meeting, viewer_uuid):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Meeting not found.",
        )
    return meeting
