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
#     retry'lar korunmaz — dokumante).
#   - Kapsam disi task_code = 404 (varlik ifsasi yok).
#   - Atama HEDEFI (assignee_user_id / assignee_group_id) data-access
#     binding'lerine karsi KONTROL EDILMEZ; hedefi ic izin modeli
#     belirler (_validate_assignment / can_assign_to_group). Binding
#     katmani "ne gorulur"u yonetir, "kime atanabilir"i degil.
#
# Bildirim yan etkileri: internal ile AYNI gonderim zinciri, AYNI admin
# kurallariyla (notification_allowed) baglanir. Alici e-postalari Stage
# 5B-2'den beri S2S dizin credential'iyle cozulur (cagiran JWT'si
# GEREKMEZ); bu yuzden token="" gecilir. S2S yapilandirilmamissa zincir
# fail-safe olarak no-op eder ve domain kaydi ASLA geri alinmaz.
# =============================================================================

from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.orm import Session

from ...database import get_db
from ...models.user_group import UserGroup
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
from ..schemas.resources import (
    PublicComment,
    PublicCommentCreate,
    PublicStatusAction,
    PublicTask,
    PublicTaskCreate,
    PublicTaskGroupCreate,
    PublicTaskGroupResult,
    PublicTaskUpdate,
    serialize_comment,
    serialize_task,
)
from ..scopes import scope_docs
from ..writes import (
    IDEMPOTENCY_HEADER_PARAM,
    actor_of as _actor_of,
    dump as _dump,
    run_idempotent as _run_idempotent,
)

router = APIRouter(prefix="/v1", tags=["Tasks"])


def _visible_task_or_404(db: Session, ctx: ApiContext, task_code: str):
    scope = api_access_service.resolve_access(db, ctx.client)
    task = res.get_task_by_code_scoped(db, scope, task_code)
    if task is None:
        raise PublicAPIError("resource_not_found", "Task not found.")
    return task


def _maybe_status_side_effects(
    db, background_tasks, task, actor_id: str, *, tenant_id
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
        tenant_id=str(tenant_id),
        task=_notif_payload(serialized),
        assigner_user_id=str(serialized.assigner_user_id),
        event=event,
    )


@router.post(
    "/tasks",
    status_code=201,
    response_model=PublicTask,
    summary="Create task",
    description=(
        "Creates a work item as the bound Hermes user (user-bound clients "
        "only; exactly one assignee). All internal assignment rules apply: "
        "the bound user needs assignment permission in the item's scope and "
        "a hierarchy mapping to the assignee; the assignee needs access. To "
        "assign to every active member of a group in one call, use POST "
        "/v1/task-groups instead."
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
                tenant_id=str(ctx.client.tenant_id),
                tasks=[_notif_payload(serialized)],
                assigner_user_id=actor.id,
                assignment_context={
                    "direct_user_ids": [str(serialized.assignee_user_id)],
                    "group_names": [],
                },
            )
        return 201, _dump(serialize_task(task))

    return _run_idempotent(
        db, ctx, idempotency_key, "/v1/tasks", _dump(payload), run
    )


@router.post(
    "/task-groups",
    status_code=201,
    response_model=PublicTaskGroupResult,
    summary="Create tasks for a group",
    description=(
        "Fans a single create action out to the active members of a user "
        "group as the bound Hermes user (user-bound clients only), one "
        "work item per member, all sharing one assignment_batch_id. This "
        "mirrors the group assignment available in the Hermes web app; "
        "POST /v1/tasks remains the single-assignee endpoint and is "
        "unchanged.\n\n"
        "Recipients are DERIVED from the group — callers never supply a "
        "member list. The bound user needs assignment permission for the "
        "target group in the item's scope. Members without access in that "
        "scope are skipped, and the bound user is never included even when "
        "they belong to the group, so `created_count` may be lower than the "
        "group's member count; `skipped_count` reports the difference. If "
        "no member is eligible, nothing is created and the call fails."
    ),
    openapi_extra=scope_docs("tasks:write"),
)
async def create_task_group(
    payload: PublicTaskGroupCreate,
    background_tasks: BackgroundTasks,
    idempotency_key: Optional[str] = IDEMPOTENCY_HEADER_PARAM,
    ctx: ApiContext = Depends(require_scopes("tasks:write")),
    db: Session = Depends(get_db),
):
    actor = _actor_of(ctx)

    def run():
        # Ic web router'in (routers/tasks.py, create_tasks_for_group ucu)
        # sirasi BIREBIR: iki modul guard'i, sonra servisin kendisi. Is
        # kurali burada YOK — grup aktifligi, can_assign_to_group, aktif
        # uye filtresi, atayanin haric tutulmasi ve batch id tamamen
        # task_service'e aittir.
        scope = task_service.perm_scope_for_type(payload.task_type)
        task_service.require_task_access(db, actor, scope)
        task_service.require_task_assigner(db, actor, scope)

        # skipped_count icin fan-out ONCESI aktif uye kumesi (grup yoksa
        # bos doner; yetkili hata yine servisten gelir).
        member_ids = task_service.get_active_group_member_ids(
            db, payload.assignee_group_id
        )

        batch_id, tasks = task_service.create_tasks_for_group(
            db,
            actor,
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

        # Servis 404 yukselttigi icin bu noktada grup kesinlikle vardir.
        # (Sprint 8: sorgu bildirimden ONCE alinir — ad hem e-posta ekip
        # baglaminda hem response'ta kullanilir; IKINCI sorgu yok.)
        group = (
            db.query(UserGroup)
            .filter(UserGroup.id == payload.assignee_group_id)
            .first()
        )

        # Ic grup ucuyla ayni bildirim zinciri: her uyeye atama e-postasi,
        # atayana tek grup ozeti. Fan-out satirlarinin tipi/onceligi/
        # termini ayni oldugu icin tek gate kontrolu yeterli.
        if serialized and task_service.notification_allowed(
            db,
            task_type=serialized[0].task_type,
            priority=serialized[0].priority,
            due_date=serialized[0].due_date,
            event="assignment",
        ):
            background_tasks.add_task(
                send_assignment_notifications,
                token="",
                tenant_id=str(ctx.client.tenant_id),
                tasks=[_notif_payload(s) for s in serialized],
                assigner_user_id=actor.id,
                assignment_context={
                    "direct_user_ids": [],
                    "group_names": [group.name] if group else [],
                },
            )
        result = PublicTaskGroupResult(
            assignment_batch_id=batch_id,
            group_id=payload.assignee_group_id,
            group_name=group.name if group else "",
            created_count=len(tasks),
            skipped_count=max(0, len(member_ids) - len(tasks)),
            created_tasks=[serialize_task(t) for t in tasks],
        )
        return 201, _dump(result)

    return _run_idempotent(
        db, ctx, idempotency_key, "/v1/task-groups", _dump(payload), run
    )


@router.patch(
    "/tasks/{task_code}",
    response_model=PublicTask,
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
    response_model=PublicComment,
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
    response_model=PublicTask,
    summary="Complete task",
    description=(
        "Marks a visible work item as completed as the bound user (the "
        "internal assignee/assigner rule applies). Emits the same activity "
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
        _maybe_status_side_effects(
            db, background_tasks, updated, actor.id,
            tenant_id=ctx.client.tenant_id,
        )
        return 200, _dump(serialize_task(updated))

    return _run_idempotent(
        db, ctx, idempotency_key, f"/v1/tasks/{task_code}/complete", {}, run
    )


@router.post(
    "/tasks/{task_code}/status",
    response_model=PublicTask,
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
        _maybe_status_side_effects(
            db, background_tasks, updated, actor.id,
            tenant_id=ctx.client.tenant_id,
        )
        return 200, _dump(serialize_task(updated))

    return _run_idempotent(
        db,
        ctx,
        idempotency_key,
        f"/v1/tasks/{task_code}/status",
        _dump(payload),
        run,
    )
