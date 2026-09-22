"""
=============================================================================
HERMES - Ana sayfa uclari (PM rework P3 / D3–D6)
=============================================================================
  GET /home/my-work     Islerim: gecikmis / bugun / bu hafta   tasks|issues.access

Izin basina blok (04-roller §3): her uc kendi iznini ister; istemci
izni olmayan blogu HIC cagirmaz (403 gorunmez, blok render edilmez).
=============================================================================
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from shared.auth import CurrentUser, get_current_user
from shared.permissions import Perm

from ..authz import user_has
from ..schemas.home import MyWorkResponse
from ..services import home_service
from ..services.task_service import is_task_admin
from ..tenant_db import get_tenant_db

router = APIRouter(prefix="/home", tags=["Home"])


def _require_work_access(user: CurrentUser) -> None:
    """Islerim: herhangi bir is modulune erisim yeter (task VEYA issue);
    tasks.admin de gecer. Fail-closed: cozum yoksa 403."""
    if is_task_admin(user) or user_has(user, Perm.TASKS_ACCESS) or user_has(user, Perm.ISSUES_ACCESS):
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
