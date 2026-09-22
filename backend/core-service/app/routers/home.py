"""
=============================================================================
HERMES - Ana sayfa uclari (PM rework P3 / D3–D6)
=============================================================================
  GET /home/my-work     Islerim: gecikmis / bugun / bu hafta   tasks|issues.access
  GET /home/week?start= Takvimim: toplanti + plan + termin     herkes (termin
                        satirlari yalniz is erisimi olana)

Izin basina blok (04-roller §3): her uc kendi iznini ister; istemci
izni olmayan blogu HIC cagirmaz (403 gorunmez, blok render edilmez).
=============================================================================
"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from shared.auth import CurrentUser, get_current_user

from ..schemas.home import MyWeekResponse, MyWorkResponse
from ..services import home_service
from ..tenant_db import get_tenant_db

router = APIRouter(prefix="/home", tags=["Home"])


def _require_work_access(user: CurrentUser) -> None:
    """Islerim: herhangi bir is modulune erisim yeter (task VEYA issue);
    tasks.admin de gecer. Fail-closed: cozum yoksa 403."""
    if home_service.has_work_access(user):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Tasks module access is required.",
    )


@router.get("/my-work", response_model=MyWorkResponse)
def my_work(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    _require_work_access(current_user)
    return home_service.my_work(db, current_user)


@router.get("/week", response_model=MyWeekResponse)
def my_week(
    start: Optional[date] = Query(None, description="Any day of the wanted week (defaults to this week)."),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    return home_service.my_week(db, current_user, start=start)
