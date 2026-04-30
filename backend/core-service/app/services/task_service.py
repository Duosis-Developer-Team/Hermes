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
    """Return assignee IDs allowed for the given user (admin handled by caller)."""
    rows = (
        db.query(TaskAssignmentRelation.assignee_user_id)
        .filter(TaskAssignmentRelation.assigner_user_id == UUID(user.id))
        .all()
    )
    return [r[0] for r in rows]


def can_assign_to(db: Session, user: CurrentUser, assignee_user_id: UUID) -> bool:
    if is_task_admin(user):
        return True
    if not can_assign_tasks(db, user):
        return False
    return assignee_user_id in get_assignable_user_ids(db, user)


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
