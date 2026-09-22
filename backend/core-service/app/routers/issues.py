"""
=============================================================================
HERMES - Eski `issues` modulu (EMEKLI — PM rework P3.6 / A5)
=============================================================================
Karar (CTO 22.09, 10-p3-plani P3-4): eski `issues` CRUD'u emekliye
ayrildi. Issue artik bir IS KALEMI turudur (`work_items.item_type =
'issue'`; /tasks uclari `task_type=issue`). Tablo 0 kayit tasiyordu —
veri tasimasi yok; `issues` tablosu ve modeli F05'te (eski tablolarin
dusurulmesi) kaldirilir, o zamana kadar dokunulmaz.

Uclar KALDIRILMADI, 410 Gone doner: eski bir istemci sessiz 404 yerine
acik bir "modul tasindi" mesaji alir. `work_logs.issue_id` (Jira bagi)
bu modulle ilgisizdir, aynen durur.
=============================================================================
"""
from fastapi import APIRouter, Depends, HTTPException, status

from shared.auth import CurrentUser, get_current_user

router = APIRouter(prefix="/issues", tags=["Issues (retired)"])

RETIRED_DETAIL = (
    "The legacy issues module was retired (PM rework A5). Issues are work items now: "
    "use /api/v1/core/tasks with task_type=issue."
)


def _gone(current_user: CurrentUser = Depends(get_current_user)) -> None:
    # Kimlik yine dogrulanir (token'siz 401); sonra tek cevap: 410.
    raise HTTPException(status_code=status.HTTP_410_GONE, detail=RETIRED_DETAIL)


@router.api_route(
    "", methods=["GET", "POST"], include_in_schema=False, dependencies=[Depends(_gone)],
)
def issues_collection_retired():  # pragma: no cover — bagimlilik 410 firlatir
    return None


@router.api_route(
    "/{issue_id}", methods=["GET", "PUT", "PATCH", "DELETE"], include_in_schema=False,
    dependencies=[Depends(_gone)],
)
def issues_item_retired(issue_id: str):  # pragma: no cover — bagimlilik 410 firlatir
    return None
