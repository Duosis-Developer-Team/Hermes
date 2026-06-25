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
from ..models.task_activity import TaskActivityEvent
from ..models.task_comment import TaskComment
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


def _resolve_effective_for_user(
    db: Session,
    user_id: UUID,
    *,
    column: str,
) -> bool:
    """Single source of truth for effective Task Access / Assign Tasks
    permission resolution. Both column="access" and column="assign"
    routes through here.

    Resolution order:

      1) If the user has ANY active group membership in an active
         group, the direct task_user_permissions row is ignored.
         Group permissions own the answer (_effective_group_grant):
            - Member override TRUE  → contributes True
            - Member override FALSE → contributes False (suppresses
              this group; other group memberships can still grant)
            - Override NULL + group default TRUE → contributes True
            - Else → contributes False
         Final is OR across contributions.

         Why: the "Additional Users" panel is scoped to users with
         no group membership (the admin tab filters by
         is_group_member=False). Once a user is grouped, the group
         tab is the canonical control surface — so a stale direct
         row (left behind by an OFF cascade or a legacy bootstrap)
         must never shadow the group answer. Without this rule,
         toggling a member ON in the group panel could not undo a
         prior OFF cascade because the resolver short-circuited on
         the stale direct=false row.

      2) No active group membership → fall back to the direct
         task_user_permissions row (the "Additional Users" panel
         writes here). Both True and False are honoured:
            - For "access": perm.can_access_tasks decides outright.
            - For "assign": you can never "assign" without "access",
              so require BOTH to be true; otherwise return False.

      3) No direct row either → False.

    Admin role is handled by the CurrentUser-typed callers because
    is_task_admin needs the CurrentUser, not just a UUID.
    """
    has_active_group = (
        db.query(UserGroupMember.id)
        .join(UserGroup, UserGroup.id == UserGroupMember.group_id)
        .filter(
            UserGroupMember.user_id == user_id,
            UserGroupMember.is_active.is_(True),
            UserGroup.is_active.is_(True),
        )
        .first()
        is not None
    )
    if has_active_group:
        return _effective_group_grant(db, user_id, column=column)

    perm = get_task_permission(db, user_id)
    if perm is None:
        return False
    if column == "access":
        return bool(perm.can_access_tasks)
    # column == "assign"
    if not perm.can_access_tasks:
        return False
    return bool(perm.can_assign_tasks)


def can_access_tasks(db: Session, user: CurrentUser) -> bool:
    """Effective permission for the calling user. Admin role wins
    globally; otherwise the per-user resolver decides."""
    if is_task_admin(user):
        return True
    return _resolve_effective_for_user(
        db, UUID(user.id), column="access"
    )


def can_assign_tasks(db: Session, user: CurrentUser) -> bool:
    """Effective assign permission for the calling user.

    Note: granting `can_assign_tasks` only means "the user can create
    tasks"; the assignment hierarchy (task_assignment_relations)
    still controls WHO they can assign to. The hierarchy alone never
    grants assign permission.
    """
    if is_task_admin(user):
        return True
    return _resolve_effective_for_user(
        db, UUID(user.id), column="assign"
    )


def user_has_task_access(db: Session, user_id: UUID) -> bool:
    """Same effective resolver as can_access_tasks, but accepts a
    raw UUID. Used by the assignee-side validation (e.g. paste
    target, group fan-out filter). The admin-role shortcut isn't
    available here because we don't have a CurrentUser — admins
    still resolve True via their bootstrapped direct row.
    """
    return _resolve_effective_for_user(db, user_id, column="access")


def user_has_task_assign(db: Session, user_id: UUID) -> bool:
    """Same effective resolver as can_assign_tasks but for an
    arbitrary user_id. Used by the admin Assignment Hierarchy
    endpoint that links assigner → assignee pairs."""
    return _resolve_effective_for_user(db, user_id, column="assign")


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

    Assignment Hierarchy is *configuration*, not a permission grant.
    The admin can pre-wire who would be allowed to assign to whom;
    whether either side is currently entitled is decided at runtime
    by the effective resolver (require_task_assigner on the assigner
    side, user_has_task_access on the target side). Doing the perm
    check here, at config time, made the modal look as if it was
    refusing valid users just because their Assign Tasks was
    currently off — and made it impossible to pre-stage a hierarchy
    for someone whose permissions hadn't been granted yet.

    Runtime enforcement is unchanged: create_task /
    create_tasks_for_group / paste still call
    _validate_assignment(), which calls user_has_task_access on the
    assignee. The router still calls require_task_assigner on the
    caller. So even if a mapping exists, a non-permitted assigner
    can't actually create tasks against it.
    """
    created_or_existing: List[TaskAssignmentRelation] = []
    for assignee_id in assignee_user_ids:
        if assignee_id == assigner_user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Assigner and assignee cannot be the same user.",
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
    """Idempotent — returns the existing row when the pair already maps.

    Same configuration-not-grant stance as create_assignment_relations:
    we don't gate the mapping on the assigner's current Assign Tasks
    permission. Runtime task creation (require_task_assigner +
    can_assign_to_group) still does that check before any task is
    actually written.
    """
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


def delete_sub_project(db: Session, sub_project_id: UUID) -> None:
    """Hard delete a sub project.

    Only ACTIVE (non-archived) tasks block deletion — archived tasks are
    soft-deleted and invisible everywhere, so they shouldn't keep a sub
    project alive. Because the FK is ON DELETE RESTRICT, archived tasks
    still referencing this sub project would otherwise block the delete at
    the DB level, so we first detach them (sub_project_id → NULL). This
    only touches archived rows, which never appear in any list/report.
    """
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

    active_in_use = (
        db.query(Task.id)
        .filter(
            Task.sub_project_id == sub_project_id,
            Task.archived_at.is_(None),
        )
        .first()
    )
    if active_in_use:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This sub project is used by active tasks and cannot be deleted.",
        )

    # Detach archived tasks so the FK (ON DELETE RESTRICT) doesn't block us.
    db.query(Task).filter(
        Task.sub_project_id == sub_project_id,
        Task.archived_at.isnot(None),
    ).update({Task.sub_project_id: None}, synchronize_session=False)

    db.delete(sub)
    db.commit()


# =============================================================================
# Tasks
# =============================================================================

def _validate_assignment(
    db: Session,
    user: CurrentUser,
    assignee_user_id: UUID,
) -> None:
    """Common assignment validation used on create / reassign / paste.

    Two distinct checks — never collapsed into one error:
      1) The CURRENT user (assigner) is authorised to assign to this
         target (admin OR reachable through assignment hierarchy /
         group mapping).
      2) The TARGET (assignee) has effective Task Access — directly,
         through group default, or through a per-member override.
         Assign Tasks is NOT required to receive a task; only access.
    """
    if not is_task_admin(user) and not can_assign_to(db, user, assignee_user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not allowed to assign tasks to this user.",
        )

    if not user_has_task_access(db, assignee_user_id):
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
    statuses: Optional[List[str]] = None,
    status_exclude: Optional[List[str]] = None,
    priority: Optional[str] = None,
    task_type: Optional[str] = None,
    customer_id: Optional[UUID] = None,
    project_id: Optional[UUID] = None,
    sub_project_id: Optional[UUID] = None,
    due_from: Optional[date] = None,
    due_to: Optional[date] = None,
    completed_from: Optional[date] = None,
    completed_to: Optional[date] = None,
    include_archived: bool = False,
    include_due_in_range: bool = False,
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

    # Date-range gating.
    #   - include_due_in_range=False (default): match by scheduled_date
    #     only, preserving the legacy List/Board behavior.
    #   - include_due_in_range=True: match if EITHER scheduled_date OR
    #     due_date falls in the window. Calendar uses this so a task
    #     scheduled in one week with a due date in another shows up
    #     as a due marker on the visible week.
    if start_date and end_date and include_due_in_range:
        query = query.filter(
            or_(
                and_(
                    Task.scheduled_date >= start_date,
                    Task.scheduled_date <= end_date,
                ),
                and_(
                    Task.due_date.isnot(None),
                    Task.due_date >= start_date,
                    Task.due_date <= end_date,
                ),
            )
        )
    else:
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
    if statuses:
        query = query.filter(Task.status.in_(statuses))
    if status_exclude:
        query = query.filter(~Task.status.in_(status_exclude))
    if priority:
        query = query.filter(Task.priority == priority)
    if task_type:
        query = query.filter(Task.task_type == task_type)
    if customer_id:
        query = query.filter(Task.customer_id == customer_id)
    if project_id:
        query = query.filter(Task.project_id == project_id)
    if sub_project_id:
        query = query.filter(Task.sub_project_id == sub_project_id)
    if due_from:
        query = query.filter(Task.due_date >= due_from)
    if due_to:
        query = query.filter(Task.due_date <= due_to)
    if completed_from:
        query = query.filter(Task.completed_at >= completed_from)
    if completed_to:
        # completed_at is a timestamp — make the inclusive upper bound the
        # end of that day so callers can pass a date.
        end_of_day = datetime.combine(
            completed_to, datetime.max.time(), tzinfo=timezone.utc
        )
        query = query.filter(Task.completed_at <= end_of_day)

    return (
        query.order_by(Task.scheduled_date.asc(), Task.created_at.asc()).all()
    )


def search_tasks_for_user(
    db: Session,
    user: CurrentUser,
    *,
    q: Optional[str],
    task_status: Optional[str] = None,
    priority: Optional[str] = None,
    task_type: Optional[str] = None,
    customer_id: Optional[UUID] = None,
    project_id: Optional[UUID] = None,
    assignee_user_id: Optional[UUID] = None,
    assigner_user_id: Optional[UUID] = None,
    due_from: Optional[date] = None,
    due_to: Optional[date] = None,
    limit: int = 50,
) -> List[Task]:
    """Free-text task search bound by the same visibility gate as
    list_tasks_for_user: a non-admin caller only ever matches tasks
    where they are the assignee or the assigner. Frontend MUST NOT be
    relied on to filter — visibility is enforced here.

    `q` matches (case-insensitive):
      - task code via numeric task_number (accepts "184" or
        "TASK-184" / "task 184")
      - title, description
      - customer.name, project.name, sub_project.name
        (sub-project is LEFT-joined so tasks without one still match)

    Assignee / assigner full-name search lives in auth-service. The
    frontend resolves names → user IDs and passes them via the
    assignee_user_id / assigner_user_id query params, which we honour
    here exactly like list_tasks_for_user does.

    Results are limited and ordered by updated_at DESC so the most
    recently touched task surfaces first.
    """
    from ..models.customer import Customer
    from ..models.project import Project

    query = (
        db.query(Task)
        .outerjoin(Customer, Customer.id == Task.customer_id)
        .outerjoin(Project, Project.id == Task.project_id)
        .outerjoin(TaskSubProject, TaskSubProject.id == Task.sub_project_id)
        .filter(Task.archived_at.is_(None))
    )

    # Same gate as list_tasks_for_user — non-admin sees only tasks
    # they are the assignee or assigner of.
    if not is_task_admin(user):
        user_uuid = UUID(user.id)
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

    if assignee_user_id:
        query = query.filter(Task.assignee_user_id == assignee_user_id)
    if assigner_user_id:
        query = query.filter(Task.assigner_user_id == assigner_user_id)
    if task_status:
        query = query.filter(Task.status == task_status)
    if priority:
        query = query.filter(Task.priority == priority)
    if task_type:
        query = query.filter(Task.task_type == task_type)
    if customer_id:
        query = query.filter(Task.customer_id == customer_id)
    if project_id:
        query = query.filter(Task.project_id == project_id)
    if due_from:
        query = query.filter(Task.due_date >= due_from)
    if due_to:
        query = query.filter(Task.due_date <= due_to)

    if q:
        needle = q.strip()
        like = f"%{needle}%"
        text_clauses = [
            Task.title.ilike(like),
            Task.description.ilike(like),
            Customer.name.ilike(like),
            Project.name.ilike(like),
            TaskSubProject.name.ilike(like),
        ]
        # If the query contains digits, also match on the task code's
        # numeric part. Accepts "184", "TASK-184", "task 184" etc.
        digits = "".join(ch for ch in needle if ch.isdigit())
        if digits:
            try:
                text_clauses.append(Task.task_number == int(digits))
            except ValueError:
                pass
        query = query.filter(or_(*text_clauses))

    return (
        query.order_by(Task.updated_at.desc(), Task.created_at.desc())
        .limit(limit)
        .all()
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
        task_type=data.task_type,
        status="pending",
    )
    db.add(task)
    db.flush()  # need task.id for the activity event below
    _record_task_event(
        db,
        task_id=task.id,
        actor_user_id=UUID(user.id),
        event_type="task_created",
        event_data={
            "title": task.title,
            "assignee_user_id": str(task.assignee_user_id),
            "scheduled_date": task.scheduled_date.isoformat()
            if task.scheduled_date else None,
            "due_date": task.due_date.isoformat() if task.due_date else None,
            "priority": task.priority,
        },
    )
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
    task_type: str = "task",
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

    # Filter to active members WITH effective task access. Members without
    # access would receive a row they can't see; safer to skip them cleanly.
    # Effective access = direct row TRUE OR any active group membership
    # grants access (group default + member override). The earlier
    # version of this filter only looked at direct rows, which silently
    # dropped members whose access came purely from a group default.
    candidate_ids = get_active_group_member_ids(db, assignee_group_id)
    if not candidate_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The group has no active members.",
        )
    # Never fan a group task out to the assigner themselves — assigning a
    # task to a group you belong to should reach the OTHER members only.
    assigner_uuid = UUID(user.id)
    eff_data = list_effective_perm_data(db)
    eligible_ids = [
        uid
        for uid in candidate_ids
        if uid != assigner_uuid
        and (
            eff_data.get(str(uid), {}).get("direct_can_access_tasks")
            or eff_data.get(str(uid), {}).get("group_grants_access")
        )
    ]
    if not eligible_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "No eligible group member to assign to. Members need "
                "Access Tasks enabled (Task Management → Task Access), and "
                "the task is never assigned back to you."
            ),
        )

    import uuid as _uuid

    batch_id = _uuid.uuid4()
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
            task_type=task_type,
            status="pending",
            assignment_batch_id=batch_id,
        )
        db.add(row)
        created.append(row)
    db.flush()  # populate task.id for event emission below
    for row in created:
        _record_task_event(
            db,
            task_id=row.id,
            actor_user_id=assigner_uuid,
            event_type="task_created",
            event_data={
                "title": row.title,
                "assignee_user_id": str(row.assignee_user_id),
                "scheduled_date": row.scheduled_date.isoformat()
                if row.scheduled_date else None,
                "due_date": row.due_date.isoformat() if row.due_date else None,
                "priority": row.priority,
                "assignment_batch_id": str(batch_id),
            },
        )
    db.commit()
    for row in created:
        db.refresh(row)
    return batch_id, created


def create_tasks_bulk(
    db: Session,
    user: CurrentUser,
    *,
    customer_id: UUID,
    project_id: UUID,
    sub_project_id: Optional[UUID],
    assignee_user_ids: Sequence[UUID],
    assignee_group_ids: Sequence[UUID],
    title: str,
    description: str,
    scheduled_date: date,
    due_date: Optional[date],
    estimated_duration_minutes: Optional[int],
    priority: str,
    task_type: str = "task",
) -> tuple[UUID, List[Task]]:
    """Create the same task for many assignees in one shot.

    Targets = explicit users ∪ active members of each selected group, with
    the assigner removed (you never assign to yourself) and duplicates
    collapsed. Ineligible targets are skipped (a user the assigner may not
    assign to, or who has no task access); if NOTHING is eligible the call
    fails with 400 so nothing is created. All rows share one batch_id.
    """
    _ensure_customer(db, customer_id)
    _ensure_project(db, project_id, customer_id)
    _ensure_sub_project_for_create(db, sub_project_id, customer_id, project_id)

    description = (description or "").strip()
    if not description:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Description is required.",
        )
    if due_date and due_date < scheduled_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Due date cannot be before the scheduled date.",
        )

    assigner_uuid = UUID(user.id)
    admin = is_task_admin(user)
    eff_data = list_effective_perm_data(db)

    def _has_access(uid: UUID) -> bool:
        d = eff_data.get(str(uid), {})
        return bool(
            d.get("direct_can_access_tasks") or d.get("group_grants_access")
        )

    eligible: list[UUID] = []
    seen: set[UUID] = set()

    def _add(uid: UUID) -> None:
        if uid == assigner_uuid or uid in seen:
            return
        if not _has_access(uid):
            return
        seen.add(uid)
        eligible.append(uid)

    # Explicit users — must be assignable by this user (admins bypass).
    for uid in assignee_user_ids:
        if not admin and not can_assign_to(db, user, uid):
            continue
        _add(uid)

    # Groups — validate the assigner→group mapping, then fan out to members.
    for gid in assignee_group_ids:
        group = db.query(UserGroup).filter(UserGroup.id == gid).first()
        if not group or not group.is_active:
            continue
        if not can_assign_to_group(db, user, gid):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not allowed to assign tasks to this group.",
            )
        for member_id in get_active_group_member_ids(db, gid):
            _add(member_id)

    if not eligible:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "No eligible assignee. Targets need Task Access enabled, "
                "and the task is never assigned back to you."
            ),
        )

    import uuid as _uuid

    batch_id = _uuid.uuid4()
    title_clean = title.strip()
    created: List[Task] = []
    for assignee_id in eligible:
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
            task_type=task_type,
            status="pending",
            assignment_batch_id=batch_id,
        )
        db.add(row)
        created.append(row)
    db.flush()
    for row in created:
        _record_task_event(
            db,
            task_id=row.id,
            actor_user_id=assigner_uuid,
            event_type="task_created",
            event_data={
                "title": row.title,
                "assignee_user_id": str(row.assignee_user_id),
                "scheduled_date": row.scheduled_date.isoformat()
                if row.scheduled_date else None,
                "due_date": row.due_date.isoformat() if row.due_date else None,
                "priority": row.priority,
                "assignment_batch_id": str(batch_id),
            },
        )
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

    # Snapshot the fields we'll diff for the activity event. status is
    # excluded — _apply_status_change emits its own dedicated event.
    def _snapshot(t: Task) -> dict:
        return {
            "title": t.title,
            "description": t.description,
            "task_type": t.task_type,
            "assignee_user_id": str(t.assignee_user_id)
            if t.assignee_user_id else None,
            "scheduled_date": t.scheduled_date.isoformat()
            if t.scheduled_date else None,
            "due_date": t.due_date.isoformat() if t.due_date else None,
            "priority": t.priority,
            "customer_id": str(t.customer_id),
            "project_id": str(t.project_id),
            "sub_project_id": str(t.sub_project_id)
            if t.sub_project_id else None,
        }
    before_snapshot = _snapshot(task)

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
    if data.task_type is not None:
        task.task_type = data.task_type

    status_notif = None
    if data.status is not None:
        status_notif = _apply_status_change(db, task, user, data.status)

    # Emit a single task_updated event for non-status field changes.
    after_snapshot = _snapshot(task)
    changes = {
        k: {"from": before_snapshot[k], "to": after_snapshot[k]}
        for k in before_snapshot
        if before_snapshot[k] != after_snapshot[k]
    }
    if changes:
        _record_task_event(
            db,
            task_id=task.id,
            actor_user_id=UUID(user.id),
            event_type="task_updated",
            event_data={"changes": changes},
        )

    db.commit()
    db.refresh(task)
    task._status_notif = status_notif
    return task


def _record_task_event(
    db: Session,
    *,
    task_id: UUID,
    actor_user_id: Optional[UUID],
    event_type: str,
    event_data: Optional[dict] = None,
) -> None:
    """Append a row to task_activity_events. Caller is responsible for
    db.commit() — we deliberately don't commit here so the event lands
    in the same transaction as the task change it describes."""
    event = TaskActivityEvent(
        task_id=task_id,
        actor_user_id=actor_user_id,
        event_type=event_type,
        event_data=event_data,
    )
    db.add(event)


def _apply_status_change(
    db: Session,
    task: Task,
    user: CurrentUser,
    new_status: str,
) -> Optional[str]:
    """Set status + completion bookkeeping AND emit the matching activity
    event (task_completed / task_rejected / task_reopened).

    Returns a one-time notification signal: "accept" the FIRST time the
    task enters in_progress, "complete" the FIRST time it is completed,
    else None. Re-accepting/re-completing after a reopen returns None
    (the first_*_at timestamps stay populated), so each e-mail fires once.
    """
    if new_status == task.status:
        return None
    old_status = task.status
    actor = UUID(user.id)
    notif: Optional[str] = None
    now = datetime.now(timezone.utc)
    if new_status == "completed":
        task.status = "completed"
        task.completed_at = now
        task.completed_by_user_id = actor
        if task.first_completed_at is None:
            task.first_completed_at = now
            notif = "complete"
        _record_task_event(
            db,
            task_id=task.id,
            actor_user_id=actor,
            event_type="task_completed",
            event_data={"from": old_status},
        )
    elif new_status == "rejected":
        task.status = "rejected"
        task.completed_at = None
        task.completed_by_user_id = None
        _record_task_event(
            db,
            task_id=task.id,
            actor_user_id=actor,
            event_type="task_rejected",
            event_data={"from": old_status},
        )
    else:
        task.status = new_status
        task.completed_at = None
        task.completed_by_user_id = None
        if new_status == "in_progress" and task.first_accepted_at is None:
            task.first_accepted_at = now
            notif = "accept"
        # Treat any move out of completed/rejected as a reopen so the
        # timeline tells a clean recovery story.
        event_type = (
            "task_reopened"
            if old_status in ("completed", "rejected")
            else "task_status_changed"
        )
        _record_task_event(
            db,
            task_id=task.id,
            actor_user_id=actor,
            event_type=event_type,
            event_data={"from": old_status, "to": new_status},
        )
    return notif


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
    notif = _apply_status_change(db, task, user, new_status)
    db.commit()
    db.refresh(task)
    # Transient flag (not a column) for the router to decide whether to
    # fire a one-time accept/complete e-mail. Set after refresh so it
    # survives the reload.
    task._status_notif = notif
    return task


def reject_task(
    db: Session,
    user: CurrentUser,
    task_id: UUID,
) -> Task:
    """Mark a task as rejected. Same permission gate as completion —
    assignee, assigner, or admin. Clears any prior completion fields
    so the row stays consistent with chk_tasks_completion_consistency.
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found.",
        )
    if not _user_can_update_status(user, task):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not allowed to reject this task.",
        )
    _apply_status_change(db, task, user, "rejected")
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
        # Workflow guard: a task must be accepted (moved to In Progress)
        # before it can be completed. This blocks a direct
        # pending -> completed jump; the assignee accepts first, then
        # completes. Already-completed is a no-op (handled below).
        if task.status not in ("in_progress", "completed"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Task must be accepted (In Progress) before it can be "
                    "completed."
                ),
            )
        notif = _apply_status_change(db, task, user, "completed")
    else:
        # Reopen — pick in_progress unless task was pending originally.
        notif = None
        if task.status == "completed":
            notif = _apply_status_change(db, task, user, "in_progress")
    db.commit()
    db.refresh(task)
    task._status_notif = notif
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
        _record_task_event(
            db,
            task_id=task.id,
            actor_user_id=UUID(user.id),
            event_type="task_deleted",
            event_data=None,
        )
        db.commit()


def list_task_activity(
    db: Session,
    user: CurrentUser,
    task_id: UUID,
    *,
    limit: int = 200,
) -> List[TaskActivityEvent]:
    """Newest-first feed of events for a task. Visibility mirrors the
    rest of the task surface: admin, the assignee, or the assigner can
    read; everyone else gets 403."""
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found.",
        )
    user_uuid = UUID(user.id)
    if not (
        is_task_admin(user)
        or task.assignee_user_id == user_uuid
        or task.assigner_user_id == user_uuid
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not allowed to view this task's activity.",
        )
    return (
        db.query(TaskActivityEvent)
        .filter(TaskActivityEvent.task_id == task_id)
        .order_by(TaskActivityEvent.created_at.desc())
        .limit(limit)
        .all()
    )


# =============================================================================
# Task Comments
# =============================================================================
# Visibility rule: a user can view comments only if they can view the
# task (admin / assignee / assigner). Edit + delete additionally
# require author-of-comment OR admin. Soft delete via deleted_at; the
# body is never returned once deleted.

def _get_task_for_comment(
    db: Session, user: CurrentUser, task_id: UUID
) -> Task:
    """Load the task and enforce visibility. Hide 'task exists' from
    unrelated users with a 404, matching get_task_for_user."""
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task or not _user_can_view_task(user, task):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found.",
        )
    return task


def list_task_comments(
    db: Session, user: CurrentUser, task_id: UUID
) -> List[TaskComment]:
    """Oldest-first conversation feed of non-deleted comments."""
    _get_task_for_comment(db, user, task_id)
    return (
        db.query(TaskComment)
        .filter(
            TaskComment.task_id == task_id,
            TaskComment.deleted_at.is_(None),
        )
        .order_by(TaskComment.created_at.asc())
        .all()
    )


def create_task_comment(
    db: Session, user: CurrentUser, task_id: UUID, body: str
) -> TaskComment:
    _get_task_for_comment(db, user, task_id)
    actor = UUID(user.id)
    comment = TaskComment(
        task_id=task_id,
        author_user_id=actor,
        body=body,
    )
    db.add(comment)
    db.flush()
    _record_task_event(
        db,
        task_id=task_id,
        actor_user_id=actor,
        event_type="comment_added",
        event_data={"comment_id": str(comment.id)},
    )
    db.commit()
    db.refresh(comment)
    return comment


def update_task_comment(
    db: Session,
    user: CurrentUser,
    task_id: UUID,
    comment_id: UUID,
    body: str,
) -> TaskComment:
    _get_task_for_comment(db, user, task_id)
    comment = (
        db.query(TaskComment)
        .filter(
            TaskComment.id == comment_id,
            TaskComment.task_id == task_id,
            TaskComment.deleted_at.is_(None),
        )
        .first()
    )
    if not comment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comment not found.",
        )
    actor = UUID(user.id)
    if comment.author_user_id != actor and not is_task_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only edit your own comments.",
        )
    comment.body = body
    comment.updated_at = datetime.now(timezone.utc)
    _record_task_event(
        db,
        task_id=task_id,
        actor_user_id=actor,
        event_type="comment_updated",
        event_data={"comment_id": str(comment.id)},
    )
    db.commit()
    db.refresh(comment)
    return comment


def delete_task_comment(
    db: Session, user: CurrentUser, task_id: UUID, comment_id: UUID
) -> None:
    _get_task_for_comment(db, user, task_id)
    comment = (
        db.query(TaskComment)
        .filter(
            TaskComment.id == comment_id,
            TaskComment.task_id == task_id,
            TaskComment.deleted_at.is_(None),
        )
        .first()
    )
    if not comment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comment not found.",
        )
    actor = UUID(user.id)
    if comment.author_user_id != actor and not is_task_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only delete your own comments.",
        )
    comment.deleted_at = datetime.now(timezone.utc)
    _record_task_event(
        db,
        task_id=task_id,
        actor_user_id=actor,
        event_type="comment_deleted",
        event_data={"comment_id": str(comment.id)},
    )
    db.commit()


def record_log_time_event(
    db: Session,
    *,
    task_id: UUID,
    actor_user_id: UUID,
    work_log_id: UUID,
    duration_hours: float,
    date_worked,
) -> None:
    """Append a log_time_created event. Called by the work-log service
    when a freshly created work log is linked to a task. Caller commits."""
    _record_task_event(
        db,
        task_id=task_id,
        actor_user_id=actor_user_id,
        event_type="log_time_created",
        event_data={
            "work_log_id": str(work_log_id),
            "duration_hours": float(duration_hours),
            "date_worked": date_worked.isoformat() if date_worked else None,
        },
    )
