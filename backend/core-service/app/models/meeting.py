# =============================================================================
# HERMES - Meeting / MeetingAttendee Models
# =============================================================================
# Backing store for the Meetings page (Microsoft Teams / Outlook
# calendar events synced from Microsoft Graph). One row per expanded
# event instance (recurring series are pre-expanded by Graph's
# /calendarView so we never have to interpret recurrence rules
# ourselves).
#
# Privacy stance:
#   - Private / confidential events have their subject replaced and
#     body_preview nulled out at SYNC time. We never store sensitive
#     body content at rest. The `sensitivity` column is kept so the
#     UI can render an explicit "Private Meeting" label.
#
# Attendee visibility:
#   - hermes_user_id is resolved from the attendee's email at sync
#     time. Visibility checks downstream filter by this column —
#     emails that don't map to a Hermes user are stored for
#     completeness but never grant access.
# =============================================================================

import uuid
from datetime import datetime, timezone as _tz

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Index,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from ..database import Base


class Meeting(Base):
    __tablename__ = "meetings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Source identity — (source, external_event_id) is the upsert key.
    # Text rather than String because Graph instance IDs are long.
    external_event_id = Column(Text, nullable=False)
    source = Column(
        String(32),
        nullable=False,
        server_default="microsoft_graph",
    )

    # Content (subject is mandatory; we substitute "Private Meeting"
    # at write time when sensitivity says so).
    subject = Column(String(255), nullable=False)
    body_preview = Column(Text, nullable=True)

    organizer_email = Column(String(255), nullable=True, index=True)
    organizer_name = Column(String(255), nullable=True)

    start_datetime = Column(
        DateTime(timezone=True), nullable=False, index=True
    )
    end_datetime = Column(DateTime(timezone=True), nullable=False)
    timezone = Column(String(64), nullable=True)
    duration_minutes = Column(Integer, nullable=True)

    join_url = Column(Text, nullable=True)
    is_online_meeting = Column(
        Boolean, nullable=False, server_default="false"
    )
    is_cancelled = Column(
        Boolean, nullable=False, server_default="false", index=True
    )

    # 'normal' | 'personal' | 'private' | 'confidential' — mirrors
    # the Microsoft Graph event.sensitivity enum verbatim.
    sensitivity = Column(
        String(16),
        nullable=False,
        server_default="normal",
    )

    last_synced_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(_tz.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(_tz.utc),
        onupdate=lambda: datetime.now(_tz.utc),
        nullable=False,
    )

    attendees = relationship(
        "MeetingAttendee",
        back_populates="meeting",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    __table_args__ = (
        UniqueConstraint(
            "source",
            "external_event_id",
            name="uq_meetings_source_external_event_id",
        ),
    )


class MeetingAttendee(Base):
    __tablename__ = "meeting_attendees"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    meeting_id = Column(
        UUID(as_uuid=True),
        ForeignKey("meetings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    email = Column(String(255), nullable=False)
    display_name = Column(String(255), nullable=True)

    # Resolved at sync time by email match. Null when the attendee
    # is external / not a Hermes user — those attendees never grant
    # visibility, but we keep the row for analytics + display.
    hermes_user_id = Column(UUID(as_uuid=True), nullable=True, index=True)

    # 'accepted' | 'declined' | 'tentative' | 'none' | 'organizer'
    response_status = Column(String(32), nullable=True)
    # 'required' | 'optional' | 'resource' | 'organizer'
    attendee_type = Column(String(32), nullable=True)

    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(_tz.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(_tz.utc),
        onupdate=lambda: datetime.now(_tz.utc),
        nullable=False,
    )

    meeting = relationship("Meeting", back_populates="attendees")

    __table_args__ = (
        UniqueConstraint(
            "meeting_id",
            "email",
            name="uq_meeting_attendees_meeting_email",
        ),
        Index("idx_meeting_attendees_email", "email"),
    )
