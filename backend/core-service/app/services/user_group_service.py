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

from ..models.task import TaskAssignmentRelation, TaskUserPermission
from ..models.user_group import (
    TaskGroupMemberOverride,
    TaskGroupPermission,
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
# Task permission state — convenience helpers used by task_service / routers
# =============================================================================

def get_task_group_permission(db: Session, group_id: UUID) -> Optional[TaskGroupPermission]:
    return (
        db.query(TaskGroupPermission)
        .filter(TaskGroupPermission.group_id == group_id)
        .first()
    )


def upsert_task_group_permission(
    db: Session,
    group_id: UUID,
    *,
    can_access_tasks_default: bool,
    can_assign_tasks_default: bool,
    can_access_issues_default: Optional[bool] = None,
    can_assign_issues_default: Optional[bool] = None,
) -> TaskGroupPermission:
    """Upsert per-group defaults (task + issue scopes) AND cascade each
    change to existing member overrides for any column that actually
    flipped.

    Rationale (UI requirement):
        Toggling a group's "Access" OFF should make every member row
        visually OFF as well — no admin should ever see "group OFF +
        member ON" at the same time. The cascade rewrites existing
        override rows on the changed column only.

    The issue-scope params default to None ("not part of this request,
    leave as-is"); the task params are required for back-compat.
    """
    get_user_group(db, group_id)  # ensure group exists

    perm = get_task_group_permission(db, group_id)
    creating = perm is None
    if creating:
        perm = TaskGroupPermission(
            group_id=group_id,
            can_access_tasks_default=False,
            can_assign_tasks_default=False,
            can_access_issues_default=False,
            can_assign_issues_default=False,
        )
        db.add(perm)

    # One spec per scope: (access_in, assign_in, perm_access_attr,
    # perm_assign_attr, override_access_col, override_assign_col).
    specs = [
        (
            can_access_tasks_default, can_assign_tasks_default,
            "can_access_tasks_default", "can_assign_tasks_default",
            TaskGroupMemberOverride.can_access_tasks_override,
            TaskGroupMemberOverride.can_assign_tasks_override,
        ),
        (
            can_access_issues_default, can_assign_issues_default,
            "can_access_issues_default", "can_assign_issues_default",
            TaskGroupMemberOverride.can_access_issues_override,
            TaskGroupMemberOverride.can_assign_issues_override,
        ),
    ]
    for access_in, assign_in, pa_attr, pas_attr, ov_a_col, ov_as_col in specs:
        if access_in is None and assign_in is None:
            continue  # scope omitted from this request
        new_access = bool(access_in)
        new_assign = bool(assign_in)
        # Invariant — assign requires access.
        if not new_access:
            new_assign = False
        old_access = None if creating else bool(getattr(perm, pa_attr))
        old_assign = None if creating else bool(getattr(perm, pas_attr))
        setattr(perm, pa_attr, new_access)
        setattr(perm, pas_attr, new_assign)
        # Cascade only the columns that actually changed.
        if old_access is None or old_access != new_access:
            db.query(TaskGroupMemberOverride).filter(
                TaskGroupMemberOverride.group_id == group_id
            ).update({ov_a_col: new_access}, synchronize_session=False)
        if old_assign is None or old_assign != new_assign:
            db.query(TaskGroupMemberOverride).filter(
                TaskGroupMemberOverride.group_id == group_id
            ).update({ov_as_col: new_assign}, synchronize_session=False)

    db.commit()
    db.refresh(perm)
    return perm


def list_task_group_member_overrides(
    db: Session,
    group_id: UUID,
) -> List[TaskGroupMemberOverride]:
    return (
        db.query(TaskGroupMemberOverride)
        .filter(TaskGroupMemberOverride.group_id == group_id)
        .all()
    )


def get_task_group_member_override(
    db: Session,
    group_id: UUID,
    user_id: UUID,
) -> Optional[TaskGroupMemberOverride]:
    return (
        db.query(TaskGroupMemberOverride)
        .filter(
            TaskGroupMemberOverride.group_id == group_id,
            TaskGroupMemberOverride.user_id == user_id,
        )
        .first()
    )


def upsert_task_group_member_override(
    db: Session,
    group_id: UUID,
    user_id: UUID,
    *,
    access_value: Optional[bool],
    clear_access: bool,
    assign_value: Optional[bool],
    clear_assign: bool,
    access_issues_value: Optional[bool] = None,
    clear_access_issues: bool = False,
    assign_issues_value: Optional[bool] = None,
    clear_assign_issues: bool = False,
) -> TaskGroupMemberOverride:
    """Persist a per-member override for a single group.

    Two invariants are enforced server-side so a bad client can't
    leave the resolver in a contradictory state:

      1) "Assign requires access". If access is being explicitly
         turned OFF, assign goes OFF in the same write. The Access
         Tasks toggle then becomes the canonical kill switch.

      2) Denial cascade onto the direct task_user_permissions row.
         Without this, a Tasks Access UI that only edits the group
         override is unable to actually deny a user who still has
         a legacy direct row from an earlier Hermes version
         (the "direct row is final" semantics meant the override
         was silently shadowed). When access or assign is being
         turned OFF here, we also turn the matching column OFF on
         the direct row (if one exists). The opposite direction
         (turning a member ON) deliberately does NOT cascade —
         that's an additive grant within one group, not a
         platform-wide permission change.
    """
    get_user_group(db, group_id)
    override = get_task_group_member_override(db, group_id, user_id)
    if override is None:
        override = TaskGroupMemberOverride(
            group_id=group_id,
            user_id=user_id,
            can_access_tasks_override=None,
            can_assign_tasks_override=None,
            can_access_issues_override=None,
            can_assign_issues_override=None,
        )
        db.add(override)

    direct = (
        db.query(TaskUserPermission)
        .filter(TaskUserPermission.user_id == user_id)
        .first()
    )

    # One spec per scope: (access_value, clear_access, assign_value,
    # clear_assign, override_access_attr, override_assign_attr,
    # direct_access_attr, direct_assign_attr).
    specs = [
        (
            access_value, clear_access, assign_value, clear_assign,
            "can_access_tasks_override", "can_assign_tasks_override",
            "can_access_tasks", "can_assign_tasks",
        ),
        (
            access_issues_value, clear_access_issues,
            assign_issues_value, clear_assign_issues,
            "can_access_issues_override", "can_assign_issues_override",
            "can_access_issues", "can_assign_issues",
        ),
    ]
    for (
        av, clr_a, asv, clr_as, ov_a_attr, ov_as_attr, dir_a, dir_as,
    ) in specs:
        # Invariant: explicit access=False forces assign=False.
        if av is False:
            asv = False
            clr_as = False

        if clr_a:
            setattr(override, ov_a_attr, None)
        elif av is not None:
            setattr(override, ov_a_attr, bool(av))

        if clr_as:
            setattr(override, ov_as_attr, None)
        elif asv is not None:
            setattr(override, ov_as_attr, bool(asv))

        # Denial cascade onto the direct row (only when explicitly turning
        # OFF; ON is additive and stays scoped to this group). Assignment
        # relations are intentionally left intact (configuration, not grant).
        if direct is not None:
            if av is False:
                setattr(direct, dir_a, False)
                setattr(direct, dir_as, False)
            elif asv is False:
                setattr(direct, dir_as, False)

    db.commit()
    db.refresh(override)
    return override


def effective_member_contribution(
    *,
    override: Optional[TaskGroupMemberOverride],
    permission: Optional[TaskGroupPermission],
    scope: str = "task",
) -> tuple[bool, bool]:
    """Compute (effective_access_in_group, effective_assign_in_group)
    for a single membership in `scope` — used purely for display.
    """
    if scope == "issue":
        access_attr, assign_attr = (
            "can_access_issues_default", "can_assign_issues_default"
        )
        ov_access_attr, ov_assign_attr = (
            "can_access_issues_override", "can_assign_issues_override"
        )
    else:
        access_attr, assign_attr = (
            "can_access_tasks_default", "can_assign_tasks_default"
        )
        ov_access_attr, ov_assign_attr = (
            "can_access_tasks_override", "can_assign_tasks_override"
        )

    access_default = bool(getattr(permission, access_attr)) if permission else False
    assign_default = bool(getattr(permission, assign_attr)) if permission else False
    ov_access = getattr(override, ov_access_attr) if override else None
    ov_assign = getattr(override, ov_assign_attr) if override else None
    access = bool(ov_access) if ov_access is not None else access_default
    assign = bool(ov_assign) if ov_assign is not None else assign_default
    return access, assign
