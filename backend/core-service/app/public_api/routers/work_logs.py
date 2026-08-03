# =============================================================================
# HERMES Public API - Work logs endpoints (Stage 3B read + 3D create)
# =============================================================================
# Okuma: AccessScope filtreli (fail-closed). Public kimlik: numerik id
# (WorkLog PK'si BigInteger — dokumantasyonda belirtilir). Internal-only
# alanlar (billable tutarlari, is tipi/platform/hat) DISARI VERILMEZ.
#
# Yazma (Stage 3D — onayli kurallar):
#   - YALNIZCA user-bound client; log HER ZAMAN bagli kullanici adina
#     yazilir (user_id/target_user_id govdede kabul edilmez → 422).
#   - task_code/meeting_id baglantilari client'in AccessScope'undan
#     GECMEK ZORUNDADIR: kapsam disi baglanti == var olmayan baglanti
#     (ayni 404 zarfi). Internal servisin "sessizce dusur" davranisina
#     ASLA dusulmez — dogrulanmis UUID gecilir.
#   - Update/delete public'te YOK (onayli kapsam).
# =============================================================================

from datetime import date
from decimal import Decimal
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from shared.exceptions import NotFoundError

from ...database import get_db
from ...schemas.work_log import WorkLogCreate
from ...services import api_access_service, public_resource_service as res
from ...services.work_log_service import WorkLogService
from ..deps import ApiContext, require_scopes
from ..errors import PublicAPIError
from ..pagination import Page, PageParams, page_params, paginated
from ..schemas.resources import (
    PublicWorkLog,
    PublicWorkLogCreate,
    serialize_work_log,
)
from ..scopes import scope_docs
from ..writes import (
    IDEMPOTENCY_HEADER_PARAM,
    actor_of as _actor_of,
    dump as _dump,
    run_idempotent as _run_idempotent,
)

router = APIRouter(prefix="/v1", tags=["Work Logs"])

# Internal NotFoundError.resource_name → public alan adi. Aktif olmayan
# kayit da "yok" sayilir (var/yok ifsasi tek zarfta birlesir).
# Sprint 8: internal entity adlari Ingilizce'ye cevrildi — anahtarlar
# birebir onlari izler; public zarf mesaji ("Referenced X not found.")
# DEGISMEDI.
_REF_FIELD = {
    "Customer": "customer_id",
    "Project": "project_id",
    "Work type": "work_type_id",
    "Activity Type": "activity_type_id",
    "Platform": "platform_id",
    "Work Line": "work_line_id",
}


def _ref_not_found(exc: NotFoundError) -> PublicAPIError:
    """Internal Turkce mesaji public Ingilizce zarfa cevirir; ham UUID
    veya internal kaynak adi disari sizmaz."""
    name = (exc.details or {}).get("resource_name")
    field = _REF_FIELD.get(name)
    if field:
        return PublicAPIError(
            "resource_not_found", f"Referenced {field} not found."
        )
    return PublicAPIError(
        "resource_not_found", "Referenced resource not found."
    )

WorkLogSortLiteral = Literal[
    "date_worked", "-date_worked", "created_at", "-created_at"
]


@router.get(
    "/work-logs",
    response_model=Page[PublicWorkLog],
    summary="List work logs",
    description=(
        "Lists work logs visible to the client's access bindings. A "
        "user-bound token never sees logs beyond the bound Hermes user."
    ),
    openapi_extra=scope_docs("work-logs:read"),
)
async def list_work_logs(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    customer_id: Optional[UUID] = Query(None),
    project_id: Optional[UUID] = Query(None),
    user_id: Optional[UUID] = Query(None),
    task_code: Optional[str] = Query(None, max_length=32),
    meeting_id: Optional[UUID] = Query(None),
    sort: WorkLogSortLiteral = Query("-date_worked"),
    params: PageParams = Depends(page_params),
    ctx: ApiContext = Depends(require_scopes("work-logs:read")),
    db: Session = Depends(get_db),
):
    scope = api_access_service.resolve_access(db, ctx.client)
    rows = res.list_work_logs_scoped(
        db,
        scope,
        date_from=date_from,
        date_to=date_to,
        customer_id=customer_id,
        project_id=project_id,
        user_id=user_id,
        task_code=task_code,
        meeting_id=meeting_id,
        sort=sort,
        fetch_limit=params.fetch_limit,
        offset=params.offset,
    )
    code_map = res.task_codes_for(db, [r.task_id for r in rows])
    return paginated(
        [serialize_work_log(r, code_map.get(r.task_id)) for r in rows],
        params,
    )


@router.get(
    "/work-logs/{log_id}",
    response_model=PublicWorkLog,
    summary="Get work log",
    description=(
        "Fetches one work log by its numeric id. Logs outside the token's "
        "data access return the same 404 as nonexistent ids."
    ),
    openapi_extra=scope_docs("work-logs:read"),
)
async def get_work_log(
    log_id: int,
    ctx: ApiContext = Depends(require_scopes("work-logs:read")),
    db: Session = Depends(get_db),
):
    scope = api_access_service.resolve_access(db, ctx.client)
    log = res.get_work_log_scoped(db, scope, log_id)
    if log is None:
        raise PublicAPIError("resource_not_found", "Work log not found.")
    code_map = res.task_codes_for(db, [log.task_id])
    return serialize_work_log(log, code_map.get(log.task_id))


@router.post(
    "/work-logs",
    status_code=201,
    response_model=PublicWorkLog,
    summary="Create work log",
    description=(
        "Creates a time entry as the bound Hermes user (user-bound clients "
        "only — service clients are read-only). The entry is always "
        "recorded for the bound user; logging time on behalf of another "
        "user is not possible. Optionally links the entry to a task (by "
        "`task_code`, case-insensitive) or a meeting (by `meeting_id`) — "
        "at most one of the two. Linked items must be visible to this "
        "client; items outside its data access return the same 404 as "
        "nonexistent ones. Internal validation rules (active customer/"
        "project/work type, 0.25-24h duration) apply unchanged."
    ),
    openapi_extra=scope_docs("work-logs:write"),
)
async def create_work_log(
    payload: PublicWorkLogCreate,
    idempotency_key: Optional[str] = IDEMPOTENCY_HEADER_PARAM,
    ctx: ApiContext = Depends(require_scopes("work-logs:write")),
    db: Session = Depends(get_db),
):
    actor = _actor_of(ctx)
    scope = api_access_service.resolve_access(db, ctx.client)

    # Baglanti cozumlemesi IS MANTIGINDAN ONCE: kapsam disi/var olmayan
    # baglanti ayni 404 zarfini alir; internal servisin sessizce-dusurme
    # yoluna hic girilmez.
    task_id = None
    if payload.task_code is not None:
        task = res.get_task_by_code_scoped(db, scope, payload.task_code)
        if task is None:
            raise PublicAPIError("resource_not_found", "Task not found.")
        task_id = task.id
    if payload.meeting_id is not None:
        meeting = res.get_meeting_scoped(db, scope, payload.meeting_id)
        if meeting is None:
            raise PublicAPIError("resource_not_found", "Meeting not found.")

    def run():
        internal = WorkLogCreate(
            customer_id=payload.customer_id,
            project_id=payload.project_id,
            work_type_id=payload.work_type_id,
            date_worked=payload.date_worked,
            # str() uzerinden Decimal: float artifakti tasinmaz.
            duration_hours=Decimal(str(payload.duration_hours)),
            description=payload.description,
            activity_type_id=payload.activity_type_id,
            platform_id=payload.platform_id,
            work_line_id=payload.work_line_id,
            task_id=task_id,
            meeting_id=payload.meeting_id,
        )
        try:
            log = WorkLogService(db).create(internal, UUID(actor.id))
        except NotFoundError as exc:
            raise _ref_not_found(exc) from exc
        code_map = res.task_codes_for(db, [log.task_id])
        return 201, _dump(serialize_work_log(log, code_map.get(log.task_id)))

    return _run_idempotent(
        db, ctx, idempotency_key, "/v1/work-logs", _dump(payload), run
    )
