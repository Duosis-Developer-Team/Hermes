# =============================================================================
# HERMES Public API - Work logs read endpoints (Stage 3B)
# =============================================================================
# AccessScope filtreli (fail-closed). Public kimlik: numerik id (WorkLog
# PK'si BigInteger — dokumantasyonda belirtilir). Internal-only alanlar
# (billable tutarlari, is tipi/platform/hat) DISARI VERILMEZ.
# =============================================================================

from datetime import date
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ...database import get_db
from ...services import api_access_service, public_resource_service as res
from ..deps import ApiContext, require_scopes
from ..errors import PublicAPIError
from ..pagination import PageParams, page_params, paginated
from ..schemas.resources import serialize_work_log
from ..scopes import scope_docs

router = APIRouter(prefix="/v1", tags=["Work Logs"])

WorkLogSortLiteral = Literal[
    "date_worked", "-date_worked", "created_at", "-created_at"
]


@router.get(
    "/work-logs",
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
