# =============================================================================
# HERMES PLATFORM - User Groups + Task Permission Models
# =============================================================================
# Generic user grouping (reusable by future modules) plus decoupled
# task-specific permission state per group / per member.
#
# Mirrors backend/sql_scripts/migrations/006_create_user_groups.sql.
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
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from .mixins import TenantOwnedMixin
from ..database import Base


# =============================================================================
# user_groups
# =============================================================================

class UserGroup(TenantOwnedMixin, Base):
    """Generic, reusable user grouping (Technical Team, Operations Team, …)."""

    __tablename__ = "user_groups"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, index=True)
    created_by_user_id = Column(UUID(as_uuid=True), nullable=True)
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
    deactivated_at = Column(DateTime(timezone=True), nullable=True)

    members = relationship(
        "UserGroupMember",
        back_populates="group",
        cascade="all, delete-orphan",
    )
    task_permission = relationship(
        "TaskGroupPermission",
        back_populates="group",
        uselist=False,
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint("name", name="uq_user_groups_name"),
    )


# =============================================================================
# user_group_members
# =============================================================================

class UserGroupMember(TenantOwnedMixin, Base):
    """User membership in a UserGroup with an optional in-group title."""

    __tablename__ = "user_group_members"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id = Column(
        UUID(as_uuid=True),
        ForeignKey("user_groups.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    title = Column(String(255), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
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

    group = relationship("UserGroup", back_populates="members")

    __table_args__ = (
        UniqueConstraint(
            "group_id",
            "user_id",
            name="uq_user_group_members_group_user",
        ),
    )


# =============================================================================
# task_group_permissions  (per UserGroup task defaults)
# =============================================================================

class TaskGroupPermission(TenantOwnedMixin, Base):
    """Per-group task access / assign defaults."""

    __tablename__ = "task_group_permissions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id = Column(
        UUID(as_uuid=True),
        ForeignKey("user_groups.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    can_access_tasks_default = Column(Boolean, nullable=False, default=False)
    can_assign_tasks_default = Column(Boolean, nullable=False, default=False)
    # Parallel defaults for the issue/suggestion scope.
    can_access_issues_default = Column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    can_assign_issues_default = Column(
        Boolean, nullable=False, default=False, server_default=text("false")
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

    group = relationship("UserGroup", back_populates="task_permission")

    __table_args__ = (
        UniqueConstraint("group_id", name="uq_task_group_permissions_group"),
    )


# =============================================================================
# task_group_member_overrides  (tri-state per user × group)
# =============================================================================

class TaskGroupMemberOverride(TenantOwnedMixin, Base):
    """Tri-state override of a member's task perm contribution.

        NULL  → inherit the group default
        TRUE  → force this membership's contribution to true
        FALSE → suppress this membership's contribution (other sources can
                still grant the permission)
    """

    __tablename__ = "task_group_member_overrides"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id = Column(
        UUID(as_uuid=True),
        ForeignKey("user_groups.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    can_access_tasks_override = Column(Boolean, nullable=True)
    can_assign_tasks_override = Column(Boolean, nullable=True)
    # Parallel tri-state overrides for the issue/suggestion scope.
    can_access_issues_override = Column(Boolean, nullable=True)
    can_assign_issues_override = Column(Boolean, nullable=True)
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
            "group_id",
            "user_id",
            name="uq_task_group_member_overrides_group_user",
        ),
    )
