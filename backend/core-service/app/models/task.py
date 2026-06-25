# =============================================================================
# HERMES PLATFORM - Tasks Module Models (SQLAlchemy)
# =============================================================================
# All user_id columns are logical references to auth_db.users (no FK constraint).
# Mirror SQL definitions in sql_scripts/migrations/003_create_task_module.sql.
# =============================================================================

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column,
    String,
    Boolean,
    DateTime,
    Text,
    ForeignKey,
    Integer,
    BigInteger,
    Date,
    UniqueConstraint,
    CheckConstraint,
    Index,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from ..database import Base


# =============================================================================
# task_user_permissions
# =============================================================================

class TaskUserPermission(Base):
    """Per-user task module permission flags."""

    __tablename__ = "task_user_permissions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    can_access_tasks = Column(Boolean, nullable=False, default=False)
    can_assign_tasks = Column(Boolean, nullable=False, default=False)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("user_id", name="uq_task_user_permissions_user"),
        CheckConstraint(
            "can_access_tasks = TRUE OR can_assign_tasks = FALSE",
            name="chk_task_assign_requires_access",
        ),
    )


# =============================================================================
# task_assignment_relations
# =============================================================================

class TaskAssignmentRelation(Base):
    """Assigner -> assignee mapping (source of truth for non-admin assigners)."""

    __tablename__ = "task_assignment_relations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assigner_user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    assignee_user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint(
            "assigner_user_id",
            "assignee_user_id",
            name="uq_task_assignment_relation",
        ),
        CheckConstraint(
            "assigner_user_id <> assignee_user_id",
            name="chk_task_assignment_not_self",
        ),
    )


class TaskAssignmentGroupRelation(Base):
    """Assigner -> user_group mapping.

    When such a relation exists, the assigner can target the group as a
    single assignee in Create Task, OR target any active member of the
    group individually. Effective per-user assignability is computed in
    task_service.can_assign_to.
    """

    __tablename__ = "task_assignment_group_relations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assigner_user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    assignee_group_id = Column(
        UUID(as_uuid=True),
        ForeignKey("user_groups.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint(
            "assigner_user_id",
            "assignee_group_id",
            name="uq_task_assignment_group_relation",
        ),
    )


# =============================================================================
# task_sub_projects
# =============================================================================

class TaskSubProject(Base):
    """Task-only sub project under an existing customer/project pair."""

    __tablename__ = "task_sub_projects"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_id = Column(
        UUID(as_uuid=True),
        ForeignKey("customers.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, index=True)
    created_by_user_id = Column(UUID(as_uuid=True), nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    archived_at = Column(DateTime(timezone=True), nullable=True)

    customer = relationship("Customer")
    project = relationship("Project")

    __table_args__ = (
        UniqueConstraint("project_id", "name", name="uq_task_sub_projects_project_name"),
    )


# =============================================================================
# tasks
# =============================================================================

class Task(Base):
    """Task record — assigned to a user under a customer/project/sub-project."""

    __tablename__ = "tasks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Human-readable short code source. The actual code shown to users
    # ("TASK-184") is composed in the serializer. Values come from the
    # task_number_seq PostgreSQL sequence so concurrent inserts can
    # never collide, and copy/paste / group fan-out each get their
    # own number for free (no application-level logic needed).
    task_number = Column(
        BigInteger,
        server_default=text("nextval('task_number_seq')"),
        nullable=False,
        unique=True,
        index=True,
    )

    customer_id = Column(
        UUID(as_uuid=True),
        ForeignKey("customers.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    sub_project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("task_sub_projects.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )

    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)

    assignee_user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    assigner_user_id = Column(UUID(as_uuid=True), nullable=False, index=True)

    scheduled_date = Column(Date, nullable=False, index=True)
    due_date = Column(Date, nullable=True)
    estimated_duration_minutes = Column(Integer, nullable=True)

    priority = Column(String(20), nullable=False, default="medium", index=True)
    status = Column(String(20), nullable=False, default="pending", index=True)

    assignee_note = Column(Text, nullable=True)

    completed_at = Column(DateTime(timezone=True), nullable=True)
    completed_by_user_id = Column(UUID(as_uuid=True), nullable=True)

    # First-transition timestamps — set ONCE, the first time the task is
    # accepted (→ in_progress) and completed (→ completed). Drive the
    # one-time accept/complete e-mail notifications; re-accepting after a
    # reopen never re-sends because these stay populated.
    first_accepted_at = Column(DateTime(timezone=True), nullable=True)
    first_completed_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    archived_at = Column(DateTime(timezone=True), nullable=True, index=True)

    # Group-assignment tracking — populated when a single Create-Task
    # action fanned the same task out to every active member of a user
    # group. Lets the assigner see all per-member rows as one batch in
    # the UI without changing the per-row task semantics.
    assignment_batch_id = Column(UUID(as_uuid=True), nullable=True, index=True)

    customer = relationship("Customer")
    project = relationship("Project")
    sub_project = relationship("TaskSubProject")

    __table_args__ = (
        CheckConstraint(
            "estimated_duration_minutes IS NULL OR estimated_duration_minutes > 0",
            name="chk_tasks_estimated_duration",
        ),
        CheckConstraint(
            "priority IN ('low', 'medium', 'high', 'urgent')",
            name="chk_tasks_priority",
        ),
        CheckConstraint(
            "status IN ('pending', 'in_progress', 'completed', 'cancelled', 'rejected')",
            name="chk_tasks_status",
        ),
        CheckConstraint(
            "due_date IS NULL OR due_date >= scheduled_date",
            name="chk_tasks_due_after_scheduled",
        ),
        CheckConstraint(
            "(status = 'completed' AND completed_at IS NOT NULL AND completed_by_user_id IS NOT NULL) "
            "OR (status <> 'completed' AND completed_at IS NULL AND completed_by_user_id IS NULL)",
            name="chk_tasks_completion_consistency",
        ),
    )


# =============================================================================
# Legacy task_groups / task_group_members
# =============================================================================
# The TaskGroup and TaskGroupMember model classes were removed in the
# user-groups refactor. Their physical tables remain in the database for
# rollback safety but the application no longer references them. The new
# group system lives in models/user_group.py:
#   - UserGroup
#   - UserGroupMember
#   - TaskGroupPermission           (per-group task access/assign defaults)
#   - TaskGroupMemberOverride       (per-member tri-state overrides)
# =============================================================================
