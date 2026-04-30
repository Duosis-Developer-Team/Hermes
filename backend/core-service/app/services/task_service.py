# =============================================================================
# HERMES PLATFORM - Tasks Module Service Layer
# =============================================================================
# Permission helpers, sub-project CRUD, assignment relations, task CRUD.
# All permission rules are enforced here (frontend visibility is not a
# security boundary).
# =============================================================================

import logging
from datetime import date, datetime, timezone
from typing import List, Optional, Sequence
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from sqlalchemy import and_

from ..models.customer import Customer
from ..models.project import Project
from ..models.task import (
    Task,
    TaskAssignmentGroupRelation,
    TaskAssignmentRelation,
    TaskSubProject,
    TaskUserPermission,
)
from ..models.user_group import (
    TaskGroupMemberOverride,
    TaskGroupPermission,
    UserGroup,
    UserGroupMember,
)
from ..schemas.task import (
    TaskCreate,
    TaskNoteUpdate,
    TaskPermissionUpdate,
    TaskSubProjectCreate,
    TaskSubProjectUpdate,
    TaskUpdate,
)
from shared.auth import CurrentUser

logger = logging.getLogger(__name__)


# =============================================================================
# Permission helpers
# =============================================================================

def is_task_admin(user: CurrentUser) -> bool:
    return bool(user.is_admin)


def get_task_permission(db: Session, user_id: UUID) -> Optional[TaskUserPermission]:
    return (
        db.query(TaskUserPermission)
        .filter(TaskUserPermission.user_id == user_id)
        .first()
    )


def _effective_group_grant(
    db: Session,
    user_id: UUID,
    *,
    column: str,
) -> bool:
    """Returns True if any active group membership grants the given column.

    Per-membership contribution:
        override IS TRUE                                      → contributes True
        override IS FALSE                                     → contributes False (suppresses *this* group only)
        override IS NULL AND task_group_permissions default   → contributes default
        no task_group_permissions row                         → contributes False

    A FALSE override on one group does NOT block other groups' or direct
    permissions from granting True — the outer OR still wins.

    `column` must be one of 'access' or 'assign'.

    Joins:
        user_group_members (active) →
            user_groups (active) →
                task_group_permissions  (required — if missing, group does not contribute)
        LEFT JOIN task_group_member_overrides (per user × group)
    """
    if column == "access":
        override_col = TaskGroupMemberOverride.can_access_tasks_override
        default_col = TaskGroupPermission.can_access_tasks_default
    elif column == "assign":
        override_col = TaskGroupMemberOverride.can_assign_tasks_override
        default_col = TaskGroupPermission.can_assign_tasks_default
    else:
        raise ValueError("column must be 'access' or 'assign'")

    rows = (
        db.query(override_col, default_col)
        .select_from(UserGroupMember)
        .join(UserGroup, UserGroup.id == UserGroupMember.group_id)
        .join(
            TaskGroupPermission,
            TaskGroupPermission.group_id == UserGroup.id,
        )
        .outerjoin(
            TaskGroupMemberOverride,
            and_(
                TaskGroupMemberOverride.group_id == UserGroup.id,
                TaskGroupMemberOverride.user_id == UserGroupMember.user_id,
            ),
        )
        .filter(
            UserGroupMember.user_id == user_id,
            UserGroupMember.is_active.is_(True),
            UserGroup.is_active.is_(True),
        )
        .all()
    )
    for override, default in rows:
        if override is True:
            return True
        if override is None and bool(default):
            return True
    return False


def can_access_tasks(db: Session, user: CurrentUser) -> bool:
    """Effective permission: admin OR direct OR any active group membership."""
    if is_task_admin(user):
        return True
    user_uuid = UUID(user.id)
    perm = get_task_permission(db, user_uuid)
    if perm and perm.can_access_tasks:
        return True
    return _effective_group_grant(db, user_uuid, column="access")


def can_assign_tasks(db: Session, user: CurrentUser) -> bool:
    """Effective permission: admin OR direct OR any active group membership.

    Note: granting `can_assign_tasks` only means "the user can create tasks";
    the assignment hierarchy (task_assignment_relations) still controls who
    they can assign to.
    """
    if is_task_admin(user):
        return True
    user_uuid = UUID(user.id)
    perm = get_task_permission(db, user_uuid)
    if perm and perm.can_access_tasks and perm.can_assign_tasks:
        return True
    return _effective_group_grant(db, user_uuid, column="assign")


def get_assignable_user_ids(db: Session, user: CurrentUser) -> List[UUID]:
    """Return assignee IDs reachable directly via task_assignment_relations.

    Group-based reach is handled separately in get_assignable_group_ids and
    in can_assign_to — this helper purposely stays scoped to direct
    user→user mappings so callers (e.g. /permissions/me) can present the
    two columns independently.
    """
    rows = (
        db.query(TaskAssignmentRelation.assignee_user_id)
        .filter(TaskAssignmentRelation.assigner_user_id == UUID(user.id))
        .all()
    )
    return [r[0] for r in rows]


def get_assignable_group_ids(db: Session, user: CurrentUser) -> List[UUID]:
    """Return group IDs the assigner may target via Create-Task-for-Group."""
    rows = (
        db.query(TaskAssignmentGroupRelation.assignee_group_id)
        .filter(TaskAssignmentGroupRelation.assigner_user_id == UUID(user.id))
        .all()
    )
    return [r[0] for r in rows]


def get_active_group_member_ids(db: Session, group_id: UUID) -> List[UUID]:
    """Active members of a group whose group is itself active.

    Used both to fan a group-create-task out to per-member rows and to
    answer the "is target user reachable through any group I'm mapped
    to?" question in can_assign_to.
    """
    rows = (
        db.query(UserGroupMember.user_id)
        .join(UserGroup, UserGroup.id == UserGroupMember.group_id)
        .filter(
            UserGroupMember.group_id == group_id,
            UserGroupMember.is_active.is_(True),
            UserGroup.is_active.is_(True),
        )
        .all()
    )
    return [r[0] for r in rows]


def _is_target_reachable_via_group(
    db: Session,
    assigner_user_id: UUID,
    assignee_user_id: UUID,
) -> bool:
    """True if any group mapped to the assigner has the assignee as an
    active member of an active group.
    """
    return (
        db.query(TaskAssignmentGroupRelation.id)
        .join(
            UserGroup,
            UserGroup.id == TaskAssignmentGroupRelation.assignee_group_id,
        )
        .join(UserGroupMember, UserGroupMember.group_id == UserGroup.id)
        .filter(
            TaskAssignmentGroupRelation.assigner_user_id == assigner_user_id,
            UserGroup.is_active.is_(True),
            UserGroupMember.user_id == assignee_user_id,
            UserGroupMember.is_active.is_(True),
        )
        .first()
        is not None
    )


def can_assign_to(db: Session, user: CurrentUser, assignee_user_id: UUID) -> bool:
    """True if `user` can assign tasks to `assignee_user_id`.

    Allowed when:
      - admin, OR
      - direct user→user relation exists, OR
      - any group mapped to the assigner contains the target as an
        active member.
    """
    if is_task_admin(user):
        return True
    if not can_assign_tasks(db, user):
        return False
    user_uuid = UUID(user.id)
    direct = (
        db.query(TaskAssignmentRelation.id)
        .filter(
            TaskAssignmentRelation.assigner_user_id == user_uuid,
            TaskAssignmentRelation.assignee_user_id == assignee_user_id,
        )
        .first()
    )
    if direct is not None:
        return True
    return _is_target_reachable_via_group(db, user_uuid, assignee_user_id)


def can_assign_to_group(db: Session, user: CurrentUser, group_id: UUID) -> bool:
    """Admin OR direct group relation."""
    if is_task_admin(user):
        return True
    if not can_assign_tasks(db, user):
        return False
    rel = (
        db.query(TaskAssignmentGroupRelation.id)
        .filter(
            TaskAssignmentGroupRelation.assigner_user_id == UUID(user.id),
            TaskAssignmentGroupRelation.assignee_group_id == group_id,
        )
        .first()
    )
    return rel is not None


def require_task_access(db: Session, user: CurrentUser) -> None:
    if not can_access_tasks(db, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tasks module access is required.",
        )


def require_task_assigner(db: Session, user: CurrentUser) -> None:
    if not can_assign_tasks(db, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Task assignment permission is required.",
        )


# =============================================================================
# Permission persistence
# =============================================================================

def upsert_task_permission(
    db: Session,
    user_id: UUID,
    data: TaskPermissionUpdate,
) -> TaskUserPermission:
    can_access = bool(data.can_access_tasks)
    can_assign = bool(data.can_assign_tasks)

    # Auto-correct invariants:
    # - Disabling access also disables assignment
    # - Granting assignment requires access
    if not can_access:
        can_assign = False
    if can_assign:
        can_access = True

    perm = get_task_permission(db, user_id)
    if perm is None:
        perm = TaskUserPermission(
            user_id=user_id,
            can_access_tasks=can_access,
            can_assign_tasks=can_assign,
        )
        db.add(perm)
    else:
        perm.can_access_tasks = can_access
        perm.can_assign_tasks = can_assign

    if not can_assign:
        # Drop assignment relations where this user is the assigner — they no
        # longer have the capability so existing mappings are invalidated.
        db.query(TaskAssignmentRelation).filter(
            TaskAssignmentRelation.assigner_user_id == user_id
        ).delete(synchronize_session=False)

    if not can_access:
        # Also drop relations where this user is the assignee.
        db.query(TaskAssignmentRelation).filter(
            TaskAssignmentRelation.assignee_user_id == user_id
        ).delete(synchronize_session=False)

    db.commit()
    db.refresh(perm)
    return perm


def list_task_permissions(db: Session) -> List[TaskUserPermission]:
    return db.query(TaskUserPermission).all()


def list_effective_perm_data(db: Session) -> dict:
    """Returns a per-user snapshot used by the Task Access page.

    Shape:
        {
          user_id_str: {
            "direct_can_access_tasks": bool | None,
            "direct_can_assign_tasks": bool | None,
            "group_grants_access": [group_id_str, ...],
            "group_grants_assign": [group_id_str, ...],
            "is_group_member": bool,
          },
          ...
        }

    `is_group_member` is true if the user belongs to any active group
    (regardless of whether the group has a task-permission row yet),
    so the frontend can render the "Additional Users" bucket as
    "everyone who is in no group at all".
    """
    out: dict = {}

    # Direct overrides (one row per user, sparse).
    for p in db.query(TaskUserPermission).all():
        out[str(p.user_id)] = {
            "direct_can_access_tasks": bool(p.can_access_tasks),
            "direct_can_assign_tasks": bool(p.can_assign_tasks),
            "group_grants_access": [],
            "group_grants_assign": [],
            "is_group_member": False,
        }

    # Active memberships in active groups. LEFT JOIN to TaskGroupPermission
    # so users in groups that have no permission row yet still register as
    # group members — they should not show up under "Additional Users".
    rows = (
        db.query(
            UserGroupMember.user_id,
            UserGroup.id.label("group_id"),
            TaskGroupPermission.can_access_tasks_default,
            TaskGroupPermission.can_assign_tasks_default,
            TaskGroupMemberOverride.can_access_tasks_override,
            TaskGroupMemberOverride.can_assign_tasks_override,
        )
        .select_from(UserGroupMember)
        .join(UserGroup, UserGroup.id == UserGroupMember.group_id)
        .outerjoin(
            TaskGroupPermission,
            TaskGroupPermission.group_id == UserGroup.id,
        )
        .outerjoin(
            TaskGroupMemberOverride,
            and_(
                TaskGroupMemberOverride.group_id == UserGroup.id,
                TaskGroupMemberOverride.user_id == UserGroupMember.user_id,
            ),
        )
        .filter(
            UserGroupMember.is_active.is_(True),
            UserGroup.is_active.is_(True),
        )
        .all()
    )

    for user_id, group_id, def_a, def_aa, ov_a, ov_aa in rows:
        u = str(user_id)
        if u not in out:
            out[u] = {
                "direct_can_access_tasks": False,
                "direct_can_assign_tasks": False,
                "group_grants_access": [],
                "group_grants_assign": [],
                "is_group_member": False,
            }
        out[u]["is_group_member"] = True
        access_grant = ov_a if ov_a is not None else bool(def_a)
        if access_grant:
            out[u]["group_grants_access"].append(str(group_id))
        assign_grant = ov_aa if ov_aa is not None else bool(def_aa)
        if assign_grant:
            out[u]["group_grants_assign"].append(str(group_id))

    return out


# =============================================================================
# Assignment Relations
# =============================================================================

def list_assignment_relations(db: Session) -> List[TaskAssignmentRelation]:
    return (
        db.query(TaskAssignmentRelation)
        .order_by(TaskAssignmentRelation.created_at.desc())
        .all()
    )


def create_assignment_relations(
    db: Session,
    assigner_user_id: UUID,
    assignee_user_ids: Sequence[UUID],
) -> List[TaskAssignmentRelation]:
    """Idempotently create assigner -> assignee mappings.

    The assigner must already have `can_assign_tasks = true` in
    task_user_permissions. Admin's own row is set up the same way, so no
    cross-service is_admin lookup is needed.
    """
    perm = get_task_permission(db, assigner_user_id)
    if not perm or not perm.can_assign_tasks:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Selected assigner does not have task assignment permission.",
        )

    created_or_existing: List[TaskAssignmentRelation] = []
    for assignee_id in assignee_user_ids:
        if assignee_id == assigner_user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Assigner and assignee cannot be the same user.",
            )
        # Assignee must have task access — the only way to receive tasks.
        assignee_perm = get_task_permission(db, assignee_id)
        if not assignee_perm or not assignee_perm.can_access_tasks:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="All assignees must have task access enabled first.",
            )
        existing = (
            db.query(TaskAssignmentRelation)
            .filter(
                TaskAssignmentRelation.assigner_user_id == assigner_user_id,
                TaskAssignmentRelation.assignee_user_id == assignee_id,
            )
            .first()
        )
        if existing:
            created_or_existing.append(existing)
            continue
        relation = TaskAssignmentRelation(
            assigner_user_id=assigner_user_id,
            assignee_user_id=assignee_id,
        )
        db.add(relation)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            existing = (
                db.query(TaskAssignmentRelation)
                .filter(
                    TaskAssignmentRelation.assigner_user_id == assigner_user_id,
                    TaskAssignmentRelation.assignee_user_id == assignee_id,
                )
                .first()
            )
            if existing:
                created_or_existing.append(existing)
            continue
        created_or_existing.append(relation)

    db.commit()
    for r in created_or_existing:
        db.refresh(r)
    return created_or_existing


def delete_assignment_relation(db: Session, relation_id: UUID) -> None:
    relation = (
        db.query(TaskAssignmentRelation)
        .filter(TaskAssignmentRelation.id == relation_id)
        .first()
    )
    if not relation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assignment mapping not found.",
        )
    db.delete(relation)
    db.commit()


# =============================================================================
# Assignment Group Relations (assigner -> group)
# =============================================================================

def list_assignment_group_relations(
    db: Session,
) -> List[TaskAssignmentGroupRelation]:
    return (
        db.query(TaskAssignmentGroupRelation)
        .order_by(TaskAssignmentGroupRelation.created_at.desc())
        .all()
    )


def create_assignment_group_relation(
    db: Session,
    assigner_user_id: UUID,
    assignee_group_id: UUID,
) -> TaskAssignmentGroupRelation:
    """Idempotent — returns the existing row when the pair already maps."""
    perm = get_task_permission(db, assigner_user_id)
    if not perm or not perm.can_assign_tasks:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Selected assigner does not have task assignment permission.",
        )

    group = (
        db.query(UserGroup).filter(UserGroup.id == assignee_group_id).first()
    )
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found.",
        )
    if not group.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Group is inactive.",
        )

    existing = (
        db.query(TaskAssignmentGroupRelation)
        .filter(
            TaskAssignmentGroupRelation.assigner_user_id == assigner_user_id,
            TaskAssignmentGroupRelation.assignee_group_id == assignee_group_id,
        )
        .first()
    )
    if existing:
        return existing

    relation = TaskAssignmentGroupRelation(
        assigner_user_id=assigner_user_id,
        assignee_group_id=assignee_group_id,
    )
    db.add(relation)
    db.commit()
    db.refresh(relation)
    return relation


def delete_assignment_group_relation(db: Session, relation_id: UUID) -> None:
    relation = (
        db.query(TaskAssignmentGroupRelation)
        .filter(TaskAssignmentGroupRelation.id == relation_id)
        .first()
    )
    if not relation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group assignment mapping not found.",
        )
    db.delete(relation)
    db.commit()


# =============================================================================
# Customer / Project / Sub Project validation
# =============================================================================

def _ensure_customer(db: Session, customer_id: UUID) -> Customer:
    customer = (
        db.query(Customer)
        .filter(Customer.id == customer_id, Customer.is_active.is_(True))
        .first()
    )
    if not customer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Customer not found or inactive.",
        )
    return customer


def _ensure_project(db: Session, project_id: UUID, customer_id: UUID) -> Project:
    project = (
        db.query(Project)
        .filter(Project.id == project_id, Project.is_active.is_(True))
        .first()
    )
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found or inactive.",
        )
    if project.customer_id != customer_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Project does not belong to the selected customer.",
        )
    return project


def _ensure_sub_project_for_create(
    db: Session,
    sub_project_id: Optional[UUID],
    customer_id: UUID,
    project_id: UUID,
) -> Optional[TaskSubProject]:
    """Validate sub project if provided. Sub project is optional."""
    if sub_project_id is None:
        return None
    sub = (
        db.query(TaskSubProject)
        .filter(TaskSubProject.id == sub_project_id)
        .first()
    )
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sub project not found.",
        )
    if not sub.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Sub project is archived and cannot be used for new tasks.",
        )
    if sub.customer_id != customer_id or sub.project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Sub project does not belong to the selected customer/project.",
        )
    return sub


# =============================================================================
# Task Sub Projects
# =============================================================================

def list_sub_projects(
    db: Session,
    customer_id: Optional[UUID] = None,
    project_id: Optional[UUID] = None,
    include_inactive: bool = False,
) -> List[TaskSubProject]:
    query = db.query(TaskSubProject)
    if customer_id:
        query = query.filter(TaskSubProject.customer_id == customer_id)
    if project_id:
        query = query.filter(TaskSubProject.project_id == project_id)
    if not include_inactive:
        query = query.filter(TaskSubProject.is_active.is_(True))
    return query.order_by(TaskSubProject.name.asc()).all()


def create_sub_project(
    db: Session,
    data: TaskSubProjectCreate,
    created_by_user_id: UUID,
) -> TaskSubProject:
    _ensure_customer(db, data.customer_id)
    _ensure_project(db, data.project_id, data.customer_id)

    name = data.name.strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Sub project name is required.",
        )

    duplicate = (
        db.query(TaskSubProject)
        .filter(
            TaskSubProject.project_id == data.project_id,
            TaskSubProject.name == name,
        )
        .first()
    )
    if duplicate:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A sub project with the same name already exists for this project.",
        )

    sub = TaskSubProject(
        customer_id=data.customer_id,
        project_id=data.project_id,
        name=name,
        description=data.description,
        is_active=True,
        created_by_user_id=created_by_user_id,
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return sub


def update_sub_project(
    db: Session,
    sub_project_id: UUID,
    data: TaskSubProjectUpdate,
) -> TaskSubProject:
    sub = (
        db.query(TaskSubProject)
        .filter(TaskSubProject.id == sub_project_id)
        .first()
    )
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sub project not found.",
        )

    if data.name is not None:
        new_name = data.name.strip()
        if not new_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Sub project name is required.",
            )
        if new_name != sub.name:
            duplicate = (
                db.query(TaskSubProject)
                .filter(
                    TaskSubProject.project_id == sub.project_id,
                    TaskSubProject.name == new_name,
                    TaskSubProject.id != sub.id,
                )
                .first()
            )
            if duplicate:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="A sub project with the same name already exists for this project.",
                )
            sub.name = new_name

    if data.description is not None:
        sub.description = data.description

    if data.is_active is not None:
        sub.is_active = bool(data.is_active)
        if not sub.is_active and sub.archived_at is None:
            sub.archived_at = datetime.now(timezone.utc)
        if sub.is_active and sub.archived_at is not None:
            sub.archived_at = None

    db.commit()
    db.refresh(sub)
    return sub


def archive_sub_project(db: Session, sub_project_id: UUID) -> TaskSubProject:
    sub = (
        db.query(TaskSubProject)
        .filter(TaskSubProject.id == sub_project_id)
        .first()
    )
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sub project not found.",
        )
    sub.is_active = False
    sub.archived_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(sub)
    return sub


# =============================================================================
# Tasks
# =============================================================================

def _validate_assignment(
    db: Session,
    user: CurrentUser,
    assignee_user_id: UUID,
) -> None:
    """Common assignment validation used on create / reassign.

    Active-flag check on assignee is delegated to auth-service via the
    `task_user_permissions` row check (assignee must have task access, which
    admins explicitly enable only for active users).
    """
    if not is_task_admin(user) and not can_assign_to(db, user, assignee_user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not allowed to assign tasks to this user.",
        )

    assignee_perm = get_task_permission(db, assignee_user_id)
    if not assignee_perm or not assignee_perm.can_access_tasks:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Selected assignee does not have task access.",
        )


def _user_can_view_task(user: CurrentUser, task: Task) -> bool:
    if is_task_admin(user):
        return True
    user_uuid = UUID(user.id)
    return task.assignee_user_id == user_uuid or task.assigner_user_id == user_uuid


def _user_can_edit_core(user: CurrentUser, task: Task) -> bool:
    if is_task_admin(user):
        return True
    return task.assigner_user_id == UUID(user.id)


def _user_can_update_status(user: CurrentUser, task: Task) -> bool:
    if is_task_admin(user):
        return True
    user_uuid = UUID(user.id)
    return task.assignee_user_id == user_uuid or task.assigner_user_id == user_uuid


def _user_can_update_note(user: CurrentUser, task: Task) -> bool:
    if is_task_admin(user):
        return True
    return task.assignee_user_id == UUID(user.id)


def list_tasks_for_user(
    db: Session,
    user: CurrentUser,
    *,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    assignee_user_id: Optional[UUID] = None,
    assigner_user_id: Optional[UUID] = None,
    task_status: Optional[str] = None,
    priority: Optional[str] = None,
    customer_id: Optional[UUID] = None,
    project_id: Optional[UUID] = None,
    sub_project_id: Optional[UUID] = None,
    include_archived: bool = False,
) -> List[Task]:
    query = db.query(Task)

    if not include_archived:
        query = query.filter(Task.archived_at.is_(None))

    if not is_task_admin(user):
        user_uuid = UUID(user.id)
        # Defense-in-depth: even though the visibility filter below already
        # collapses any other-user filter to an empty result, explicitly
        # coerce assignee_user_id / assigner_user_id to the current user so
        # the intent is unambiguous and there is no path to leak via filters.
        if assignee_user_id is not None and assignee_user_id != user_uuid:
            assignee_user_id = user_uuid
        if assigner_user_id is not None and assigner_user_id != user_uuid:
            assigner_user_id = user_uuid
        query = query.filter(
            or_(
                Task.assignee_user_id == user_uuid,
                Task.assigner_user_id == user_uuid,
            )
        )

    if start_date:
        query = query.filter(Task.scheduled_date >= start_date)
    if end_date:
        query = query.filter(Task.scheduled_date <= end_date)
    if assignee_user_id:
        query = query.filter(Task.assignee_user_id == assignee_user_id)
    if assigner_user_id:
        query = query.filter(Task.assigner_user_id == assigner_user_id)
    if task_status:
        query = query.filter(Task.status == task_status)
    if priority:
        query = query.filter(Task.priority == priority)
    if customer_id:
        query = query.filter(Task.customer_id == customer_id)
    if project_id:
        query = query.filter(Task.project_id == project_id)
    if sub_project_id:
        query = query.filter(Task.sub_project_id == sub_project_id)

    return (
        query.order_by(Task.scheduled_date.asc(), Task.created_at.asc()).all()
    )


def get_task_for_user(db: Session, user: CurrentUser, task_id: UUID) -> Task:
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task or not _user_can_view_task(user, task):
        # Hide existence from unrelated users.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found.",
        )
    return task


def create_task(
    db: Session,
    user: CurrentUser,
    data: TaskCreate,
) -> Task:
    _ensure_customer(db, data.customer_id)
    _ensure_project(db, data.project_id, data.customer_id)
    _ensure_sub_project_for_create(
        db, data.sub_project_id, data.customer_id, data.project_id
    )
    _validate_assignment(db, user, data.assignee_user_id)

    if data.due_date and data.due_date < data.scheduled_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Due date cannot be before the scheduled date.",
        )

    description = (data.description or "").strip()
    if not description:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Description is required.",
        )

    task = Task(
        customer_id=data.customer_id,
        project_id=data.project_id,
        sub_project_id=data.sub_project_id,
        title=data.title.strip(),
        description=description,
        assignee_user_id=data.assignee_user_id,
        assigner_user_id=UUID(user.id),
        scheduled_date=data.scheduled_date,
        due_date=data.due_date,
        estimated_duration_minutes=data.estimated_duration_minutes,
        priority=data.priority,
        status="pending",
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def create_tasks_for_group(
    db: Session,
    user: CurrentUser,
    *,
    customer_id: UUID,
    project_id: UUID,
    sub_project_id: Optional[UUID],
    assignee_group_id: UUID,
    title: str,
    description: str,
    scheduled_date: date,
    due_date: Optional[date],
    estimated_duration_minutes: Optional[int],
    priority: str,
) -> tuple[UUID, List[Task]]:
    """Fan a single Create-Task-for-Group action out into one Task row per
    active group member. Returns (assignment_batch_id, created_tasks).

    Scope rules:
      - Admin: always allowed.
      - Non-admin: must have a direct task_assignment_group_relation to the
        target group.
      - Members must have task access (TaskUserPermission.can_access_tasks).
        Members without it are skipped (warning only). If the eligible set
        is empty after filtering, the call fails with 400 so nothing is
        created.

    All rows share the same assignment_batch_id so the assigner can later
    track the batch as one logical action.
    """
    _ensure_customer(db, customer_id)
    _ensure_project(db, project_id, customer_id)
    _ensure_sub_project_for_create(
        db, sub_project_id, customer_id, project_id
    )

    description = (description or "").strip()
    if not description:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Description is required.",
        )

    # Group must exist and be active.
    group = db.query(UserGroup).filter(UserGroup.id == assignee_group_id).first()
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found.",
        )
    if not group.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Group is inactive and cannot receive new tasks.",
        )

    # Permission: admin or direct group mapping.
    if not can_assign_to_group(db, user, assignee_group_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not allowed to assign tasks to this group.",
        )

    if due_date and due_date < scheduled_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Due date cannot be before the scheduled date.",
        )

    # Filter to active members WITH task access. Members without access
    # would receive a row they can't see; safer to skip them cleanly.
    candidate_ids = get_active_group_member_ids(db, assignee_group_id)
    if not candidate_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The group has no active members.",
        )
    perm_rows = (
        db.query(TaskUserPermission.user_id, TaskUserPermission.can_access_tasks)
        .filter(TaskUserPermission.user_id.in_(candidate_ids))
        .all()
    )
    perm_map = {uid: bool(allowed) for uid, allowed in perm_rows}
    eligible_ids = [uid for uid in candidate_ids if perm_map.get(uid)]
    if not eligible_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "No active member of this group has task access enabled. "
                "Grant Can Access Tasks first in Direct User Overrides "
                "or via group permissions."
            ),
        )

    import uuid as _uuid

    batch_id = _uuid.uuid4()
    assigner_uuid = UUID(user.id)
    title_clean = title.strip()
    created: List[Task] = []
    for assignee_id in eligible_ids:
        row = Task(
            customer_id=customer_id,
            project_id=project_id,
            sub_project_id=sub_project_id,
            title=title_clean,
            description=description,
            assignee_user_id=assignee_id,
            assigner_user_id=assigner_uuid,
            scheduled_date=scheduled_date,
            due_date=due_date,
            estimated_duration_minutes=estimated_duration_minutes,
            priority=priority,
            status="pending",
            assignment_batch_id=batch_id,
        )
        db.add(row)
        created.append(row)
    db.commit()
    for row in created:
        db.refresh(row)
    return batch_id, created


def update_task(
    db: Session,
    user: CurrentUser,
    task_id: UUID,
    data: TaskUpdate,
) -> Task:
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found.",
        )
    if not _user_can_edit_core(user, task):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not allowed to edit this task.",
        )

    new_customer_id = data.customer_id or task.customer_id
    new_project_id = data.project_id or task.project_id

    # Sub project semantics:
    # - clear_sub_project=True  → null it out (regardless of sub_project_id)
    # - sub_project_id provided → use new value (validated below)
    # - omitted                 → keep existing
    if data.clear_sub_project:
        new_sub_project_id: Optional[UUID] = None
    elif data.sub_project_id is not None:
        new_sub_project_id = data.sub_project_id
    else:
        new_sub_project_id = task.sub_project_id

    relationship_changed = (
        data.customer_id is not None
        or data.project_id is not None
        or data.sub_project_id is not None
        or data.clear_sub_project is True
    )

    if relationship_changed:
        _ensure_customer(db, new_customer_id)
        _ensure_project(db, new_project_id, new_customer_id)
        if new_sub_project_id is not None:
            sub = (
                db.query(TaskSubProject)
                .filter(TaskSubProject.id == new_sub_project_id)
                .first()
            )
            if not sub:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Sub project not found.",
                )
            if (
                sub.customer_id != new_customer_id
                or sub.project_id != new_project_id
            ):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Sub project does not belong to the selected customer/project.",
                )
            # Allow keeping an archived sub project on existing tasks, but if
            # the user is moving to a different sub project it must be active.
            if sub.id != task.sub_project_id and not sub.is_active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Sub project is archived and cannot be used for new tasks.",
                )

    if data.assignee_user_id is not None and data.assignee_user_id != task.assignee_user_id:
        _validate_assignment(db, user, data.assignee_user_id)
        task.assignee_user_id = data.assignee_user_id

    new_scheduled = data.scheduled_date or task.scheduled_date
    new_due = data.due_date if data.due_date is not None else task.due_date
    if new_due and new_due < new_scheduled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Due date cannot be before the scheduled date.",
        )

    if data.customer_id is not None:
        task.customer_id = data.customer_id
    if data.project_id is not None:
        task.project_id = data.project_id
    if data.clear_sub_project:
        task.sub_project_id = None
    elif data.sub_project_id is not None:
        task.sub_project_id = data.sub_project_id
    if data.title is not None:
        title = data.title.strip()
        if not title:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Title is required.",
            )
        task.title = title
    if data.description is not None:
        new_description = data.description.strip()
        if not new_description:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Description is required.",
            )
        task.description = new_description
    if data.scheduled_date is not None:
        task.scheduled_date = data.scheduled_date
    if data.due_date is not None:
        task.due_date = data.due_date
    if data.estimated_duration_minutes is not None:
        task.estimated_duration_minutes = data.estimated_duration_minutes
    if data.priority is not None:
        task.priority = data.priority

    if data.status is not None:
        _apply_status_change(task, user, data.status)

    db.commit()
    db.refresh(task)
    return task


def _apply_status_change(task: Task, user: CurrentUser, new_status: str) -> None:
    if new_status == task.status:
        return
    if new_status == "completed":
        task.status = "completed"
        task.completed_at = datetime.now(timezone.utc)
        task.completed_by_user_id = UUID(user.id)
    else:
        task.status = new_status
        task.completed_at = None
        task.completed_by_user_id = None


def update_task_status(
    db: Session,
    user: CurrentUser,
    task_id: UUID,
    new_status: str,
) -> Task:
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found.",
        )
    if not _user_can_update_status(user, task):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not allowed to update this task status.",
        )
    _apply_status_change(task, user, new_status)
    db.commit()
    db.refresh(task)
    return task


def update_task_completion(
    db: Session,
    user: CurrentUser,
    task_id: UUID,
    completed: bool,
) -> Task:
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found.",
        )
    if not _user_can_update_status(user, task):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not allowed to change this task completion state.",
        )
    if completed:
        _apply_status_change(task, user, "completed")
    else:
        # Reopen — pick in_progress unless task was pending originally.
        if task.status == "completed":
            _apply_status_change(task, user, "in_progress")
    db.commit()
    db.refresh(task)
    return task


def update_task_note(
    db: Session,
    user: CurrentUser,
    task_id: UUID,
    data: TaskNoteUpdate,
) -> Task:
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found.",
        )
    if not _user_can_update_note(user, task):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the assignee can edit the task note.",
        )
    task.assignee_note = data.assignee_note
    db.commit()
    db.refresh(task)
    return task


def delete_task(db: Session, user: CurrentUser, task_id: UUID) -> None:
    """Soft delete via archived_at — task disappears from default list but
    the row is preserved (no destructive deletion).

    Permission: admin OR the task's assigner. Assignees cannot delete.
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found.",
        )
    if not _user_can_edit_core(user, task):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not allowed to delete this task.",
        )
    if task.archived_at is None:
        task.archived_at = datetime.now(timezone.utc)
        db.commit()
