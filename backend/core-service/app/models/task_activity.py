# =============================================================================
# HERMES - Task Activity Event Model
# =============================================================================
# Append-only audit/feed of important task lifecycle events. Powers the
# Activity tab inside the Review Task modal and gives reports a source
# of truth for "when did X happen to this task".
#
# Event types currently emitted (extend freely; the column is just a
# free-form string for forward compatibility):
#   - task_created
#   - task_updated
#   - task_completed
#   - task_rejected
#   - task_reopened
#   - task_deleted          (soft delete via archived_at)
#   - assignee_changed
#   - due_date_changed
#   - priority_changed
#   - log_time_created
#
# event_data is a JSONB blob with event-specific fields (e.g.
# {"old": "pending", "new": "completed"}). Only consumed server-side
# and by the timeline renderer; never displayed as raw JSON.
# =============================================================================

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID

from .mixins import TenantOwnedMixin
from ..database import Base


class TaskActivityEvent(TenantOwnedMixin, Base):
    __tablename__ = "task_activity_events"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        nullable=False,
    )
    task_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    actor_user_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    event_type = Column(String(64), nullable=False, index=True)
    event_data = Column(JSONB, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )
