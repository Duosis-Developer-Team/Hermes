# =============================================================================
# HERMES PLATFORM - Tasks Router (user-facing endpoints)
# =============================================================================
# Implements:
#   GET    /tasks/permissions/me
#   GET    /tasks/sub-projects
#   GET    /tasks
#   POST   /tasks
#   GET    /tasks/{task_id}
#   PUT    /tasks/{task_id}
#   PATCH  /tasks/{task_id}/note
#   PATCH  /tasks/{task_id}/status
#   PATCH  /tasks/{task_id}/complete
#
# User name/email enrichment is delegated to the frontend (which calls
# auth-service /users/lookup directly). Backend returns only IDs.
# =============================================================================

from datetime import date
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.task import Task, TaskSubProject
from ..schemas.task import (
    TaskActivityEventResponse,
    TaskCommentCreate,
    TaskCommentResponse,
    TaskCommentUpdate,
    TaskCompleteUpdate,
    TaskCreate,
    TaskCreateBulk,
    TaskCreateForGroup,
    TaskGroupCreateResponse,
    TaskNoteUpdate,
    TaskPermissionMeResponse,
    TaskResponse,
    TaskStatusUpdate,
    TaskSubProjectCreate,
    TaskSubProjectResponse,
    TaskUpdate,
)
from ..services import task_service
from ..services.task_notifications import (
    send_assignment_notifications,
    send_status_notifications,
)
from shared.auth import CurrentUser, get_current_user


def _maybe_status_notify(task, serialized, background_tasks, request) -> None:
    """If the status change was the FIRST accept/complete (service set the
    transient _status_notif flag), schedule the one-time e-mail to the
    assignee + assigner. No-op otherwise."""
    event = getattr(task, "_status_notif", None)
    if event in ("accept", "complete"):
        background_tasks.add_task(
            send_status_notifications,
            token=_extract_token(request),
            task=_notif_payload(serialized),
            assigner_user_id=str(serialized.assigner_user_id),
            event=event,
        )


def _extract_token(request: Request) -> str:
    """Pull the caller's JWT for the notification's service-to-service
    auth lookup. The frontend authenticates via an `access_token` cookie
    (the Authorization header is usually absent), so check the cookie
    first, then fall back to the bearer header. Returns the RAW token
    (no 'Bearer ' prefix)."""
    cookie = request.cookies.get("access_token")
    if cookie:
        return cookie
    auth = request.headers.get("authorization") or request.headers.get(
        "Authorization"
    )
    if auth:
        return auth.replace("Bearer ", "").strip()
    return ""


def _notif_payload(resp) -> dict:
    """Flatten a serialized task into the small, session-free dict the
    e-mail templates consume (dates → DD.MM.YYYY strings)."""

    def _d(value):
        return value.strftime("%d.%m.%Y") if value else None

    return {
        "task_code": resp.task_code,
        "title": resp.title,
        "description": resp.description,
        "customer_name": resp.customer_name,
        "project_name": resp.project_name,
        "sub_project_name": resp.sub_project_name,
        "priority": resp.priority,
        "scheduled_date": _d(resp.scheduled_date),
        "due_date": _d(resp.due_date),
        "assignee_user_id": str(resp.assignee_user_id),
        "assigner_user_id": str(resp.assigner_user_id),
    }


router = APIRouter(prefix="/tasks", tags=["Tasks"])


# =============================================================================
# Helpers
# =============================================================================

def _serialize_sub_project(sub: TaskSubProject) -> TaskSubProjectResponse:
    return TaskSubProjectResponse(
        id=sub.id,
        customer_id=sub.customer_id,
        customer_name=sub.customer.name if sub.customer else None,
        project_id=sub.project_id,
        project_name=sub.project.name if sub.project else None,
        name=sub.name,
        description=sub.description,
        is_active=sub.is_active,
        created_by_user_id=sub.created_by_user_id,
        created_at=sub.created_at,
        updated_at=sub.updated_at,
        archived_at=sub.archived_at,
    )


def _serialize_task(task: Task) -> TaskResponse:
    task_code = (
        f"TASK-{task.task_number}" if task.task_number is not None else None
    )
    return TaskResponse(
        id=task.id,
        task_number=task.task_number,
        task_code=task_code,
        customer_id=task.customer_id,
        customer_name=task.customer.name if task.customer else None,
        project_id=task.project_id,
        project_name=task.project.name if task.project else None,
        sub_project_id=task.sub_project_id,
        sub_project_name=task.sub_project.name if task.sub_project else None,
        title=task.title,
        description=task.description,
        assignee_user_id=task.assignee_user_id,
        assigner_user_id=task.assigner_user_id,
        scheduled_date=task.scheduled_date,
        due_date=task.due_date,
        estimated_duration_minutes=task.estimated_duration_minutes,
        priority=task.priority,
        status=task.status,
        task_type=task.task_type,
        assignee_note=task.assignee_note,
        completed_at=task.completed_at,
        completed_by_user_id=task.completed_by_user_id,
        created_at=task.created_at,
        updated_at=task.updated_at,
        archived_at=task.archived_at,
        assignment_batch_id=task.assignment_batch_id,
    )


# =============================================================================
# Permissions — current user
# =============================================================================

@router.get("/permissions/me", response_model=TaskPermissionMeResponse)
async def get_my_task_permissions(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Returns task capability flags + assignable user IDs for the current user.

    The frontend resolves names by calling auth-service /users/lookup directly.
    """
    is_admin = task_service.is_task_admin(current_user)
    can_access = task_service.can_access_tasks(db, current_user)
    can_assign = task_service.can_assign_tasks(db, current_user)

    assignable_user_ids: List[UUID] = []
    assignable_group_ids: List[UUID] = []
    if can_assign and not is_admin:
        # Admins can target anyone — frontend fetches all active users
        # / groups directly. Non-admins are scoped to their explicit
        # mappings.
        assignable_user_ids = task_service.get_assignable_user_ids(db, current_user)
        assignable_group_ids = task_service.get_assignable_group_ids(
            db, current_user
        )

    return TaskPermissionMeResponse(
        can_access_tasks=can_access,
        can_assign_tasks=can_assign,
        is_admin=is_admin,
        assignable_user_ids=assignable_user_ids,
        assignable_group_ids=assignable_group_ids,
    )


# =============================================================================
# Assignable groups (read-only minimal info for task users)
# =============================================================================

@router.get("/assignable-groups")
async def list_assignable_groups(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Returns minimal info for groups the current user may target with
    Create-Task-for-Group:
        - admin: every active user_group
        - non-admin assigner: only groups with a direct
          task_assignment_group_relations row.

    Shape: [{ id, name, member_count }]. Used by Create Task modal so
    non-admins can see group names without needing the /admin/user-groups
    endpoint.
    """
    task_service.require_task_access(db, current_user)

    from ..models.user_group import UserGroup

    if task_service.is_task_admin(current_user):
        groups = (
            db.query(UserGroup)
            .filter(UserGroup.is_active.is_(True))
            .order_by(UserGroup.name.asc())
            .all()
        )
    else:
        if not task_service.can_assign_tasks(db, current_user):
            return []
        ids = task_service.get_assignable_group_ids(db, current_user)
        if not ids:
            return []
        groups = (
            db.query(UserGroup)
            .filter(UserGroup.id.in_(ids), UserGroup.is_active.is_(True))
            .order_by(UserGroup.name.asc())
            .all()
        )

    # Compute active member counts in a single grouped query.
    from sqlalchemy import func as _func
    from ..models.user_group import UserGroupMember

    rows = (
        db.query(UserGroupMember.group_id, _func.count(UserGroupMember.id))
        .filter(UserGroupMember.is_active.is_(True))
        .group_by(UserGroupMember.group_id)
        .all()
    )
    counts = {str(gid): int(c) for gid, c in rows}

    return [
        {
            "id": str(g.id),
            "name": g.name,
            "member_count": counts.get(str(g.id), 0),
        }
        for g in groups
    ]


# =============================================================================
# Sub Projects (read-only for task users)
# =============================================================================

@router.get("/sub-projects", response_model=List[TaskSubProjectResponse])
async def list_sub_projects(
    customer_id: Optional[UUID] = Query(None),
    project_id: Optional[UUID] = Query(None),
    include_inactive: bool = Query(False),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task_service.require_task_access(db, current_user)
    effective_include_inactive = bool(include_inactive) and current_user.is_admin
    subs = task_service.list_sub_projects(
        db,
        customer_id=customer_id,
        project_id=project_id,
        include_inactive=effective_include_inactive,
    )
    return [_serialize_sub_project(s) for s in subs]


@router.post(
    "/sub-projects",
    response_model=TaskSubProjectResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_sub_project_as_assigner(
    data: TaskSubProjectCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a sub project at task-assignment time.

    Mirrors the Create Task permission gate (Task Access + Assign Tasks)
    so a non-admin assigner can add a missing sub project inline from the
    Create Task modal without an admin round-trip. Editing/deleting sub
    projects stays admin-only (admin/tasks/sub-projects)."""
    task_service.require_task_access(db, current_user)
    task_service.require_task_assigner(db, current_user)
    sub = task_service.create_sub_project(db, data, UUID(current_user.id))
    return _serialize_sub_project(sub)


# =============================================================================
# Tasks — list / get / create / update
# =============================================================================

@router.get("", response_model=List[TaskResponse])
async def list_tasks(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    assignee_user_id: Optional[UUID] = Query(None),
    assigner_user_id: Optional[UUID] = Query(None),
    task_status: Optional[str] = Query(None, alias="status"),
    statuses: Optional[List[str]] = Query(None, alias="statuses"),
    status_exclude: Optional[List[str]] = Query(None, alias="status_exclude"),
    priority: Optional[str] = Query(None),
    task_type: Optional[str] = Query(None),
    customer_id: Optional[UUID] = Query(None),
    project_id: Optional[UUID] = Query(None),
    sub_project_id: Optional[UUID] = Query(None),
    due_from: Optional[date] = Query(None),
    due_to: Optional[date] = Query(None),
    completed_from: Optional[date] = Query(None),
    completed_to: Optional[date] = Query(None),
    include_archived: bool = Query(False),
    include_due_in_range: bool = Query(
        False,
        description=(
            "Calendar opt-in: also return tasks whose due_date "
            "(not just scheduled_date) falls in [start_date, end_date]."
        ),
    ),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task_service.require_task_access(db, current_user)
    effective_include_archived = bool(include_archived) and current_user.is_admin
    tasks = task_service.list_tasks_for_user(
        db,
        current_user,
        start_date=start_date,
        end_date=end_date,
        assignee_user_id=assignee_user_id,
        assigner_user_id=assigner_user_id,
        task_status=task_status,
        statuses=statuses,
        status_exclude=status_exclude,
        priority=priority,
        task_type=task_type,
        customer_id=customer_id,
        project_id=project_id,
        sub_project_id=sub_project_id,
        due_from=due_from,
        due_to=due_to,
        completed_from=completed_from,
        completed_to=completed_to,
        include_archived=effective_include_archived,
        include_due_in_range=bool(include_due_in_range),
    )
    return [_serialize_task(t) for t in tasks]


@router.post("", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_task(
    payload: TaskCreate,
    background_tasks: BackgroundTasks,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task_service.require_task_access(db, current_user)
    task_service.require_task_assigner(db, current_user)
    task = task_service.create_task(db, current_user, payload)
    serialized = _serialize_task(task)
    # Fire-and-forget e-mail notification (assignee + assigner). Runs
    # after the response; failures are logged, never surfaced.
    background_tasks.add_task(
        send_assignment_notifications,
        token=_extract_token(request),
        tasks=[_notif_payload(serialized)],
        assigner_user_id=str(current_user.id),
    )
    return serialized


@router.post(
    "/group",
    response_model=TaskGroupCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_tasks_for_group(
    payload: TaskCreateForGroup,
    background_tasks: BackgroundTasks,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Fan a single create-task action out to every active member of a
    group. One Task row per member; all rows share the same
    assignment_batch_id so the assigner can track them as one batch.
    """
    task_service.require_task_access(db, current_user)
    task_service.require_task_assigner(db, current_user)
    batch_id, tasks = task_service.create_tasks_for_group(
        db,
        current_user,
        customer_id=payload.customer_id,
        project_id=payload.project_id,
        sub_project_id=payload.sub_project_id,
        assignee_group_id=payload.assignee_group_id,
        title=payload.title,
        description=payload.description,
        scheduled_date=payload.scheduled_date,
        due_date=payload.due_date,
        estimated_duration_minutes=payload.estimated_duration_minutes,
        priority=payload.priority,
        task_type=payload.task_type,
    )
    serialized = [_serialize_task(t) for t in tasks]
    # One notification batch: each member gets an assignee e-mail and the
    # assigner gets a single group summary (see task_notifications).
    background_tasks.add_task(
        send_assignment_notifications,
        token=_extract_token(request),
        tasks=[_notif_payload(s) for s in serialized],
        assigner_user_id=str(current_user.id),
    )
    return TaskGroupCreateResponse(
        assignment_batch_id=batch_id,
        assignee_group_id=payload.assignee_group_id,
        tasks=serialized,
    )


@router.post(
    "/bulk",
    response_model=List[TaskResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_tasks_bulk(
    payload: TaskCreateBulk,
    background_tasks: BackgroundTasks,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create the same task for multiple assignees (users and/or groups) in
    one action. Returns the created task rows; fires a single notification
    batch (each assignee an individual e-mail, the assigner one summary)."""
    task_service.require_task_access(db, current_user)
    task_service.require_task_assigner(db, current_user)
    _batch_id, tasks = task_service.create_tasks_bulk(
        db,
        current_user,
        customer_id=payload.customer_id,
        project_id=payload.project_id,
        sub_project_id=payload.sub_project_id,
        assignee_user_ids=payload.assignee_user_ids,
        assignee_group_ids=payload.assignee_group_ids,
        title=payload.title,
        description=payload.description,
        scheduled_date=payload.scheduled_date,
        due_date=payload.due_date,
        estimated_duration_minutes=payload.estimated_duration_minutes,
        priority=payload.priority,
        task_type=payload.task_type,
    )
    serialized = [_serialize_task(t) for t in tasks]
    background_tasks.add_task(
        send_assignment_notifications,
        token=_extract_token(request),
        tasks=[_notif_payload(s) for s in serialized],
        assigner_user_id=str(current_user.id),
    )
    return serialized


# NOTE: /search MUST be declared before /{task_id} below — FastAPI
# matches in declaration order and would otherwise treat "search" as
# a task_id and 422 the request.
@router.get("/search", response_model=List[TaskResponse])
async def search_tasks(
    q: Optional[str] = Query(None, description="Free-text search."),
    task_status: Optional[str] = Query(None, alias="status"),
    priority: Optional[str] = Query(None),
    task_type: Optional[str] = Query(None),
    customer_id: Optional[UUID] = Query(None),
    project_id: Optional[UUID] = Query(None),
    assignee_user_id: Optional[UUID] = Query(None),
    assigner_user_id: Optional[UUID] = Query(None),
    due_from: Optional[date] = Query(None),
    due_to: Optional[date] = Query(None),
    limit: int = Query(50, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Visibility-bound free-text task search.

    Non-admin callers can ONLY match tasks where they are the
    assignee or the assigner — same gate as list_tasks_for_user.
    """
    task_service.require_task_access(db, current_user)
    tasks = task_service.search_tasks_for_user(
        db,
        current_user,
        q=q,
        task_status=task_status,
        priority=priority,
        task_type=task_type,
        customer_id=customer_id,
        project_id=project_id,
        assignee_user_id=assignee_user_id,
        assigner_user_id=assigner_user_id,
        due_from=due_from,
        due_to=due_to,
        limit=limit,
    )
    return [_serialize_task(t) for t in tasks]


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(
    task_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task_service.require_task_access(db, current_user)
    task = task_service.get_task_for_user(db, current_user, task_id)
    return _serialize_task(task)


@router.put("/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: UUID,
    payload: TaskUpdate,
    background_tasks: BackgroundTasks,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task_service.require_task_access(db, current_user)
    task = task_service.update_task(db, current_user, task_id, payload)
    serialized = _serialize_task(task)
    _maybe_status_notify(task, serialized, background_tasks, request)
    return serialized


@router.patch("/{task_id}/note", response_model=TaskResponse)
async def update_task_note(
    task_id: UUID,
    payload: TaskNoteUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task_service.require_task_access(db, current_user)
    task = task_service.update_task_note(db, current_user, task_id, payload)
    return _serialize_task(task)


@router.patch("/{task_id}/status", response_model=TaskResponse)
async def update_task_status(
    task_id: UUID,
    payload: TaskStatusUpdate,
    background_tasks: BackgroundTasks,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task_service.require_task_access(db, current_user)
    task = task_service.update_task_status(db, current_user, task_id, payload.status)
    serialized = _serialize_task(task)
    _maybe_status_notify(task, serialized, background_tasks, request)
    return serialized


@router.patch("/{task_id}/complete", response_model=TaskResponse)
async def complete_task(
    task_id: UUID,
    payload: TaskCompleteUpdate,
    background_tasks: BackgroundTasks,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task_service.require_task_access(db, current_user)
    task = task_service.update_task_completion(
        db, current_user, task_id, payload.completed
    )
    serialized = _serialize_task(task)
    _maybe_status_notify(task, serialized, background_tasks, request)
    return serialized


@router.patch("/{task_id}/reject", response_model=TaskResponse)
async def reject_task(
    task_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark a task as rejected (assignee/assigner/admin)."""
    task_service.require_task_access(db, current_user)
    task = task_service.reject_task(db, current_user, task_id)
    return _serialize_task(task)


@router.delete("/{task_id}", status_code=200)
async def delete_task(
    task_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Soft delete — sets archived_at, the row is preserved."""
    task_service.require_task_access(db, current_user)
    task_service.delete_task(db, current_user, task_id)
    return {"deleted": True}


@router.get(
    "/{task_id}/activity",
    response_model=List[TaskActivityEventResponse],
)
async def list_task_activity(
    task_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Newest-first activity feed for a task. Visible to admin, the
    assignee, or the assigner."""
    task_service.require_task_access(db, current_user)
    events = task_service.list_task_activity(db, current_user, task_id)
    return [
        TaskActivityEventResponse(
            id=e.id,
            task_id=e.task_id,
            actor_user_id=e.actor_user_id,
            event_type=e.event_type,
            event_data=e.event_data,
            created_at=e.created_at,
        )
        for e in events
    ]


# =============================================================================
# Comments
# =============================================================================

def _serialize_comment(c) -> TaskCommentResponse:
    return TaskCommentResponse(
        id=c.id,
        task_id=c.task_id,
        author_user_id=c.author_user_id,
        body=c.body,
        created_at=c.created_at,
        updated_at=c.updated_at,
    )


@router.get(
    "/{task_id}/comments",
    response_model=List[TaskCommentResponse],
)
async def list_comments(
    task_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task_service.require_task_access(db, current_user)
    comments = task_service.list_task_comments(db, current_user, task_id)
    return [_serialize_comment(c) for c in comments]


@router.post(
    "/{task_id}/comments",
    response_model=TaskCommentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_comment(
    task_id: UUID,
    payload: TaskCommentCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task_service.require_task_access(db, current_user)
    comment = task_service.create_task_comment(
        db, current_user, task_id, payload.body
    )
    return _serialize_comment(comment)


@router.put(
    "/{task_id}/comments/{comment_id}",
    response_model=TaskCommentResponse,
)
async def update_comment(
    task_id: UUID,
    comment_id: UUID,
    payload: TaskCommentUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task_service.require_task_access(db, current_user)
    comment = task_service.update_task_comment(
        db, current_user, task_id, comment_id, payload.body
    )
    return _serialize_comment(comment)


@router.delete("/{task_id}/comments/{comment_id}", status_code=200)
async def delete_comment(
    task_id: UUID,
    comment_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task_service.require_task_access(db, current_user)
    task_service.delete_task_comment(db, current_user, task_id, comment_id)
    return {"deleted": True}
