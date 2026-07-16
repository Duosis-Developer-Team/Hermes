# =============================================================================
# HERMES Public API - Task write endpoints (Stage 3C)
# =============================================================================
# Onayli kurallar:
#   - Write islemleri YALNIZCA user-bound client'lara aciktir. Service
#     client'lar dogru scope'lara sahip olsalar BILE 403 alir (aktor
#     kimligi belirsiz olamaz; on_behalf_of v1'de yok).
#   - Bagli Hermes kullanicisi aktordur; mevcut TUM Hermes kurallari
#     (gorunurluk, hiyerarsi, atama dogrulama, issue-scope izinleri,
#     durum gecis kurallari, activity event'leri) sentezlenmis
#     CurrentUser uzerinden AYNEN calisir — public router is kurali
#     TASIMAZ.
#   - Scope kontrolu kullanici izinlerine EK olarak uygulanir.
#   - Tum POST'lar OPSIYONEL Idempotency-Key destekler (anahtarsiz
#     retry'lar korunmaz — dokumante). Grup fan-out v1'de public'e kapali.
#   - Kapsam disi task_code = 404 (varlik ifsasi yok).
#
# Bildirim yan etkileri: internal ile AYNI gonderim zinciri, AYNI admin
# kurallariyla (notification_allowed) baglanir. Bilinen v1 sinirlamasi:
# alici e-postalari auth-service lookup'i CAGIRANIN JWT'siyle yapar;
# API token'inda JWT olmadigi icin lookup bos doner ve e-posta fiilen
# GONDERILMEZ (zincir calisir, teslimat no-op). Cozum icin S2S lookup
# credential'i gerekir — raporlandi.
# =============================================================================

import json
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Header
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from shared.auth import CurrentUser

from ...database import get_db
from ...routers.tasks import _notif_payload, _serialize_task
from ...schemas.task import TaskCreate, TaskUpdate
from ...services import api_access_service, public_resource_service as res
from ...services import task_service
from ...services.task_notifications import (
    send_assignment_notifications,
    send_status_notifications,
)
from ..deps import ApiContext, require_scopes
from ..errors import PublicAPIError
from ..idempotency import (
    begin_idempotency,
    canonical_hash,
    validate_idempotency_key,
)
from ..schemas.resources import (
    PublicCommentCreate,
    PublicStatusAction,
    PublicTaskCreate,
    PublicTaskUpdate,
    serialize_comment,
    serialize_task,
)
from ..scopes import scope_docs

router = APIRouter(prefix="/v1", tags=["Tasks"])

IDEMPOTENCY_HEADER_PARAM = Header(
    None,
    alias="Idempotency-Key",
    description=(
        "Optional idempotency key (8-128 chars of [A-Za-z0-9_-.]), scoped "
        "to your API client. Replaying the same key with the same payload "
        "within 24h returns the original response with "
        "`Idempotency-Replayed: true`; the same key with a different "
        "payload returns 409. Without the header, retries are NOT "
        "protected."
    ),
)


def _actor_of(ctx: ApiContext) -> CurrentUser:
    """Bagli Hermes kullanicisini aktor yapar. E-posta alani service
    fonksiyonlarinin sekil geregidir (hicbir is kuralinda kullanilmaz)."""
    if ctx.client.client_type != "user" or ctx.client.bound_user_id is None:
        raise PublicAPIError(
            "resource_access_denied",
            "Write operations require a user-bound API client. Service "
            "clients are read-only in v1.",
        )
    return CurrentUser(
        id=str(ctx.client.bound_user_id),
        email=f"api-client-{ctx.client.id}@hermes.internal",
        is_admin=False,
    )


def _visible_task_or_404(db: Session, ctx: ApiContext, task_code: str):
    scope = api_access_service.resolve_access(db, ctx.client)
    task = res.get_task_by_code_scoped(db, scope, task_code)
    if task is None:
        raise PublicAPIError("resource_not_found", "Task not found.")
    return task


def _dump(model) -> dict:
    return json.loads(model.model_dump_json())


def _run_idempotent(db, ctx, key, route, payload, run):
    """POST akisinin ortak sarmali: rezervasyon → is mantigi → anlik.
    `run()` (status_code, body_dict) dondurur."""
    key = validate_idempotency_key(key)
    req_hash = canonical_hash(ctx.client.id, "POST", route, payload)
    guard = begin_idempotency(db, ctx.client.id, key, req_hash)
    if guard.replay is not None:
        return guard.replay
    try:
        status_code, body = run()
    except Exception:
        guard.release()
        raise
    guard.commit(status_code, body)
    return JSONResponse(status_code=status_code, content=body)


def _maybe_status_side_effects(
    db, background_tasks, task, actor_id: str
) -> None:
    """Internal ile ayni ilk-kabul/ilk-tamamlama bildirim zinciri (admin
    notification kurallari dahil). token="" → lookup bos doner, e-posta
    fiilen gonderilmez (bilinen v1 sinirlamasi, dosya basligina bakin)."""
    event = getattr(task, "_status_notif", None)
    if event not in ("accept", "complete"):
        return
    serialized = _serialize_task(task)
    if not task_service.notification_allowed(
        db,
        task_type=serialized.task_type,
        priority=serialized.priority,
        due_date=serialized.due_date,
        event=event,
    ):
        return
    background_tasks.add_task(
        send_status_notifications,
        token="",
        task=_notif_payload(serialized),
        assigner_user_id=str(serialized.assigner_user_id),
        event=event,
    )


@router.post(
    "/tasks",
    status_code=201,
    summary="Create task",
    description=(
        "Creates a work item as the bound Hermes user (user-bound clients "
        "only; single assignee — group fan-out is not part of the Public "
        "API). All internal assignment rules apply: the bound user needs "
        "assignment permission in the item's scope and a hierarchy mapping "
        "to the assignee; the assignee needs access."
    ),
    openapi_extra=scope_docs("tasks:write"),
)
async def create_task(
    payload: PublicTaskCreate,
    background_tasks: BackgroundTasks,
    idempotency_key: Optional[str] = IDEMPOTENCY_HEADER_PARAM,
    ctx: ApiContext = Depends(require_scopes("tasks:write")),
    db: Session = Depends(get_db),
):
    actor = _actor_of(ctx)

    def run():
        internal = TaskCreate(
            title=payload.title,
            description=payload.description,
            customer_id=payload.customer_id,
            project_id=payload.project_id,
            sub_project_id=payload.sub_project_id,
            assignee_user_id=payload.assignee_user_id,
            scheduled_date=payload.scheduled_date,
            due_date=payload.due_date,
            priority=payload.priority,
            task_type=payload.task_type,
        )
        task = task_service.create_task(db, actor, internal)
        serialized = _serialize_task(task)
        # Internal create ile ayni atama-bildirimi zinciri + admin kurallari.
        if task_service.notification_allowed(
            db,
            task_type=serialized.task_type,
            priority=serialized.priority,
            due_date=serialized.due_date,
            event="assignment",
        ):
            background_tasks.add_task(
                send_assignment_notifications,
                token="",
                tasks=[_notif_payload(serialized)],
                assigner_user_id=actor.id,
            )
        return 201, _dump(serialize_task(task))

    return _run_idempotent(
        db, ctx, idempotency_key, "/v1/tasks", _dump(payload), run
    )


@router.patch(
    "/tasks/{task_code}",
    summary="Update task",
    description=(
        "Partial update of a visible work item as the bound user. Internal "
        "edit and reassignment rules apply unchanged; task_code, internal "
        "ids, completion metadata and archive state cannot be mutated."
    ),
    openapi_extra=scope_docs("tasks:write"),
)
async def update_task(
    task_code: str,
    payload: PublicTaskUpdate,
    ctx: ApiContext = Depends(require_scopes("tasks:write")),
    db: Session = Depends(get_db),
):
    actor = _actor_of(ctx)
    task = _visible_task_or_404(db, ctx, task_code)
    internal = TaskUpdate(
        title=payload.title,
        description=payload.description,
        priority=payload.priority,
        scheduled_date=payload.scheduled_date,
        due_date=payload.due_date,
        sub_project_id=payload.sub_project_id,
        assignee_user_id=payload.assignee_user_id,
    )
    updated = task_service.update_task(db, actor, task.id, internal)
    return serialize_task(updated)


@router.post(
    "/tasks/{task_code}/comments",
    status_code=201,
    summary="Add comment",
    description="Adds a comment as the bound user (task visibility required).",
    openapi_extra=scope_docs("tasks:comment"),
)
async def add_comment(
    task_code: str,
    payload: PublicCommentCreate,
    idempotency_key: Optional[str] = IDEMPOTENCY_HEADER_PARAM,
    ctx: ApiContext = Depends(require_scopes("tasks:comment")),
    db: Session = Depends(get_db),
):
    actor = _actor_of(ctx)
    task = _visible_task_or_404(db, ctx, task_code)

    def run():
        comment = task_service.create_task_comment(
            db, actor, task.id, payload.body
        )
        return 201, _dump(serialize_comment(comment))

    return _run_idempotent(
        db,
        ctx,
        idempotency_key,
        f"/v1/tasks/{task_code}/comments",
        _dump(payload),
        run,
    )


@router.post(
    "/tasks/{task_code}/complete",
    summary="Complete task",
    description=(
        "Marks a visible work item as completed as the bound user (the "
        "internal assignee-only rule applies). Emits the same activity "
        "event and first-completion notification chain as the internal "
        "app. Does not create a work log."
    ),
    openapi_extra=scope_docs("tasks:complete"),
)
async def complete_task(
    task_code: str,
    background_tasks: BackgroundTasks,
    idempotency_key: Optional[str] = IDEMPOTENCY_HEADER_PARAM,
    ctx: ApiContext = Depends(require_scopes("tasks:complete")),
    db: Session = Depends(get_db),
):
    actor = _actor_of(ctx)
    task = _visible_task_or_404(db, ctx, task_code)

    def run():
        updated = task_service.update_task_completion(
            db, actor, task.id, True
        )
        _maybe_status_side_effects(db, background_tasks, updated, actor.id)
        return 200, _dump(serialize_task(updated))

    return _run_idempotent(
        db, ctx, idempotency_key, f"/v1/tasks/{task_code}/complete", {}, run
    )


@router.post(
    "/tasks/{task_code}/status",
    summary="Change task status",
    description=(
        "accept → in progress; reject → rejected; reopen → back to in "
        "progress (from completed) or pending (from rejected). Internal "
        "transition rules apply unchanged."
    ),
    openapi_extra=scope_docs("tasks:complete"),
)
async def change_status(
    task_code: str,
    payload: PublicStatusAction,
    background_tasks: BackgroundTasks,
    idempotency_key: Optional[str] = IDEMPOTENCY_HEADER_PARAM,
    ctx: ApiContext = Depends(require_scopes("tasks:complete")),
    db: Session = Depends(get_db),
):
    actor = _actor_of(ctx)
    task = _visible_task_or_404(db, ctx, task_code)

    if payload.action == "accept":
        new_status = "in_progress"
    elif payload.action == "reject":
        new_status = "rejected"
    else:  # reopen
        if task.status == "completed":
            new_status = "in_progress"
        elif task.status == "rejected":
            new_status = "pending"
        else:
            raise PublicAPIError(
                "invalid_request",
                "Only completed or rejected items can be reopened.",
            )

    def run():
        updated = task_service.update_task_status(
            db, actor, task.id, new_status
        )
        _maybe_status_side_effects(db, background_tasks, updated, actor.id)
        return 200, _dump(serialize_task(updated))

    return _run_idempotent(
        db,
        ctx,
        idempotency_key,
        f"/v1/tasks/{task_code}/status",
        _dump(payload),
        run,
    )
