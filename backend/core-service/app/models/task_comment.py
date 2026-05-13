# =============================================================================
# HERMES - Task Comment Model
# =============================================================================
# Human-written messages on a task. Distinct from task_activity_events
# (those are automatic system records). A user can view comments
# whenever they can view the task; only the author or an admin can
# edit/delete a comment. Soft-deleted via deleted_at — the row is
# preserved for audit but the body is never returned to the UI.
# =============================================================================

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID

from ..database import Base


class TaskComment(Base):
    __tablename__ = "task_comments"

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
    author_user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    body = Column(Text, nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )
    updated_at = Column(DateTime(timezone=True), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)
