# =============================================================================
# HERMES Public API - Tasks read endpoints (Stage 3A)
# =============================================================================
# Ilk gercek kaynak yuzeyi. Kurallar:
#   - require_scopes("tasks:read") + resolve_access → AccessScope; her
#     sorgu scope ile SINIRLI (fail-closed).
#   - Kapsam DISI detay = 404 resource_not_found — gercekten olmayan
#     koddan ayirt edilemez (varlik ifsasi yok).
#   - Router DB'ye dogrudan inmez: public_resource_service kullanilir.
#   - Yanitlar STABIL public semalar (schemas/resources.py).
# =============================================================================

from datetime import date, datetime
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ...database import get_db
from ...services import api_access_service, public_resource_service as res
from ..deps import ApiContext, require_scopes
from ..errors import PublicAPIError
from ..pagination import Page, PageParams, page_params, paginated
from ..schemas.resources import (
    PublicComment,
    PublicTask,
    PublicTaskActivity,
    serialize_activity,
    serialize_comment,
    serialize_task,
)
from ..scopes import scope_docs

router = APIRouter(prefix="/v1", tags=["Tasks"])

# Literal tipler GERCEK validasyon saglar (bilinmeyen deger → 422) ve
# OpenAPI'ye enum olarak islenir.
SortLiteral = Literal[
    "updated_at",
    "-updated_at",
    "created_at",
    "-created_at",
    "due_date",
    "-due_date",
]
StatusLiteral = Literal[
    "pending", "in_progress", "completed", "cancelled", "rejected"
]
PriorityLiteral = Literal["low", "medium", "high", "urgent"]
TypeLiteral = Literal["task", "issue", "suggestion"]


def _resolve_scope(db: Session, ctx: ApiContext):
    return api_access_service.resolve_access(db, ctx.client)


def _get_visible_task_or_404(db, scope, task_code: str):
    task = res.get_task_by_code_scoped(db, scope, task_code)
    if task is None:
        # Kapsam disi ve hic-var-olmayan ayni zarfi doner.
        raise PublicAPIError("resource_not_found", "Task not found.")
    return task


@router.get(
    "/tasks",
    response_model=Page[PublicTask],
    summary="List tasks",
    description=(
        "Lists tasks, issues and suggestions visible to the client's "
        "access bindings. Results are always limited to the token's data "
        "access; no bindings means an empty result."
    ),
    openapi_extra=scope_docs("tasks:read"),
)
async def list_tasks(
    status: Optional[StatusLiteral] = Query(None),
    priority: Optional[PriorityLiteral] = Query(None),
    task_type: Optional[TypeLiteral] = Query(None),
    customer_id: Optional[UUID] = Query(None),
    project_id: Optional[UUID] = Query(None),
    assignee_user_id: Optional[UUID] = Query(None),
    due_from: Optional[date] = Query(None),
    due_to: Optional[date] = Query(None),
    updated_after: Optional[datetime] = Query(None),
    sort: SortLiteral = Query("-updated_at"),
    params: PageParams = Depends(page_params),
    ctx: ApiContext = Depends(require_scopes("tasks:read")),
    db: Session = Depends(get_db),
):
    scope = _resolve_scope(db, ctx)
    rows = res.list_tasks_scoped(
        db,
        scope,
        status=status,
        priority=priority,
        task_type=task_type,
        customer_id=customer_id,
        project_id=project_id,
        assignee_user_id=assignee_user_id,
        due_from=due_from,
        due_to=due_to,
        updated_after=updated_after,
        sort=sort,
        fetch_limit=params.fetch_limit,
        offset=params.offset,
    )
    return paginated([serialize_task(t) for t in rows], params)


@router.get(
    "/tasks/{task_code}",
    response_model=PublicTask,
    summary="Get task by code",
    description=(
        "Fetches one work item by its public code (e.g. TASK-12, ISSUE-3, "
        "SUGGESTION-7). Items outside the token's data access return the "
        "same 404 as nonexistent codes."
    ),
    openapi_extra=scope_docs("tasks:read"),
)
async def get_task(
    task_code: str,
    ctx: ApiContext = Depends(require_scopes("tasks:read")),
    db: Session = Depends(get_db),
):
    scope = _resolve_scope(db, ctx)
    task = _get_visible_task_or_404(db, scope, task_code)
    return serialize_task(task)


@router.get(
    "/tasks/{task_code}/activity",
    response_model=Page[PublicTaskActivity],
    summary="Task activity feed",
    description=(
        "Sanitized, newest-first activity feed. Raw event payloads are "
        "never exposed — only the event type, a human-readable summary, "
        "the actor, and whitelisted change metadata."
    ),
    openapi_extra=scope_docs("tasks:read"),
)
async def get_task_activity(
    task_code: str,
    params: PageParams = Depends(page_params),
    ctx: ApiContext = Depends(require_scopes("tasks:read")),
    db: Session = Depends(get_db),
):
    scope = _resolve_scope(db, ctx)
    task = _get_visible_task_or_404(db, scope, task_code)
    events = res.list_activity_scoped(
        db, task, limit=params.offset + params.fetch_limit
    )
    window = events[params.offset : params.offset + params.fetch_limit]
    return paginated(
        [serialize_activity(e, task.task_type) for e in window], params
    )


@router.get(
    "/tasks/{task_code}/comments",
    response_model=Page[PublicComment],
    summary="Task comments",
    description="Oldest-first conversation feed. Deleted comments are never returned.",
    openapi_extra=scope_docs("tasks:read"),
)
async def get_task_comments(
    task_code: str,
    params: PageParams = Depends(page_params),
    ctx: ApiContext = Depends(require_scopes("tasks:read")),
    db: Session = Depends(get_db),
):
    scope = _resolve_scope(db, ctx)
    task = _get_visible_task_or_404(db, scope, task_code)
    comments = res.list_comments_scoped(db, task)
    window = comments[params.offset : params.offset + params.fetch_limit]
    return paginated([serialize_comment(c) for c in window], params)
