# =============================================================================
# HERMES PLATFORM - User Group Service
# =============================================================================
# CRUD for the generic UserGroup + UserGroupMember tables. Task-specific
# permission concerns are handled in services/task_service.py so other
# modules can consume groups without a tasks dependency.
# =============================================================================

from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models.user_group import (
    TaskGroupMemberOverride,
    UserGroup,
    UserGroupMember,
)
from ..schemas.user_group import (
    UserGroupCreate,
    UserGroupMemberCreate,
    UserGroupMemberUpdate,
    UserGroupUpdate,
)


# =============================================================================
# Group CRUD
# =============================================================================

def list_user_groups(db: Session, *, include_inactive: bool = False) -> List[UserGroup]:
    query = db.query(UserGroup)
    if not include_inactive:
        query = query.filter(UserGroup.is_active.is_(True))
    return query.order_by(UserGroup.name.asc()).all()


def get_member_count_map(db: Session) -> dict:
    """Return {group_id_str: count} for all groups (active members only)."""
    rows = (
        db.query(UserGroupMember.group_id, func.count(UserGroupMember.id))
        .filter(UserGroupMember.is_active.is_(True))
        .group_by(UserGroupMember.group_id)
        .all()
    )
    return {str(gid): int(c) for gid, c in rows}


def get_user_group(db: Session, group_id: UUID) -> UserGroup:
    group = db.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found.",
        )
    return group


def create_user_group(
    db: Session,
    data: UserGroupCreate,
    *,
    created_by_user_id: UUID,
) -> UserGroup:
    name = data.name.strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Group name is required.",
        )
    existing = db.query(UserGroup).filter(UserGroup.name == name).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A group with the same name already exists.",
        )
    group = UserGroup(
        name=name,
        description=data.description,
        is_active=True,
        created_by_user_id=created_by_user_id,
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


def update_user_group(
    db: Session,
    group_id: UUID,
    data: UserGroupUpdate,
) -> UserGroup:
    group = get_user_group(db, group_id)

    if data.name is not None:
        new_name = data.name.strip()
        if not new_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Group name is required.",
            )
        if new_name != group.name:
            duplicate = (
                db.query(UserGroup)
                .filter(UserGroup.name == new_name, UserGroup.id != group.id)
                .first()
            )
            if duplicate:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="A group with the same name already exists.",
                )
            group.name = new_name

    if data.description is not None:
        group.description = data.description

    if data.is_active is not None:
        group.is_active = bool(data.is_active)
        if not group.is_active and group.deactivated_at is None:
            group.deactivated_at = datetime.now(timezone.utc)
        if group.is_active and group.deactivated_at is not None:
            group.deactivated_at = None

    db.commit()
    db.refresh(group)
    return group


def deactivate_user_group(db: Session, group_id: UUID) -> UserGroup:
    """Soft "delete" — Hermes pattern: is_active=false + deactivated_at."""
    group = get_user_group(db, group_id)
    group.is_active = False
    if group.deactivated_at is None:
        group.deactivated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(group)
    return group


# =============================================================================
# Member CRUD
# =============================================================================

def list_group_members(
    db: Session,
    group_id: UUID,
    *,
    include_inactive: bool = False,
) -> List[UserGroupMember]:
    get_user_group(db, group_id)  # ensure group exists
    query = db.query(UserGroupMember).filter(UserGroupMember.group_id == group_id)
    if not include_inactive:
        query = query.filter(UserGroupMember.is_active.is_(True))
    return query.order_by(UserGroupMember.created_at.asc()).all()


def get_group_member(
    db: Session,
    group_id: UUID,
    member_id: UUID,
) -> UserGroupMember:
    member = (
        db.query(UserGroupMember)
        .filter(
            UserGroupMember.id == member_id,
            UserGroupMember.group_id == group_id,
        )
        .first()
    )
    if not member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group member not found.",
        )
    return member


def add_group_member(
    db: Session,
    group_id: UUID,
    data: UserGroupMemberCreate,
) -> UserGroupMember:
    get_user_group(db, group_id)

    duplicate = (
        db.query(UserGroupMember)
        .filter(
            UserGroupMember.group_id == group_id,
            UserGroupMember.user_id == data.user_id,
        )
        .first()
    )
    if duplicate:
        if duplicate.is_active:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This user is already a member of the group.",
            )
        # Re-activate previously removed membership rather than insert duplicate.
        duplicate.is_active = True
        if data.title is not None:
            duplicate.title = (data.title or "").strip() or None
        db.commit()
        db.refresh(duplicate)
        return duplicate

    title = (data.title or "").strip() or None
    member = UserGroupMember(
        group_id=group_id,
        user_id=data.user_id,
        title=title,
        is_active=True,
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


def update_group_member(
    db: Session,
    group_id: UUID,
    member_id: UUID,
    data: UserGroupMemberUpdate,
) -> UserGroupMember:
    member = get_group_member(db, group_id, member_id)

    if data.clear_title:
        member.title = None
    elif data.title is not None:
        title = data.title.strip()
        member.title = title or None

    db.commit()
    db.refresh(member)
    return member


def remove_group_member(db: Session, group_id: UUID, member_id: UUID) -> None:
    """Hard-deletes the membership row.

    Removing a membership row also clears any task override for that
    user × group pair (the override is meaningless without the
    membership). Neither user accounts nor business data (tasks, work
    logs, etc.) are touched.
    """
    member = get_group_member(db, group_id, member_id)
    user_id = member.user_id

    db.query(TaskGroupMemberOverride).filter(
        TaskGroupMemberOverride.group_id == group_id,
        TaskGroupMemberOverride.user_id == user_id,
    ).delete(synchronize_session=False)

    db.delete(member)
    db.commit()


# =============================================================================
# Task permission state — KALDIRILDI (RBAC cutover, 2026-08-04)
# =============================================================================
# get/upsert_task_group_permission, member-override CRUD'u ve
# effective_member_contribution legacy Task Access UI'siyla birlikte
# kaldirildi. Tablolar backfill/parity icin durur; yazma yolu yoktur.
