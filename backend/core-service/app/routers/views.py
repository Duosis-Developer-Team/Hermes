"""
=============================================================================
HERMES - Kayitli gorunum uclari (PM rework P3.5 / E2)
=============================================================================
  GET    /views            kisisel + paylasilan (sistem gorunumleri istemcide)
  POST   /views            olustur (personal | shared)
  PATCH  /views/{id}       sahibi | tasks.admin
  DELETE /views/{id}       sahibi | tasks.admin

Erisim: herhangi bir is modulu erisimi (task VEYA issue) ya da tasks.admin.
=============================================================================
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from shared.auth import CurrentUser, get_current_user

from ..schemas.saved_view import (
    SavedViewCreate, SavedViewListResponse, SavedViewResponse, SavedViewUpdate,
)
from ..services import saved_view_service as svc
from ..services.home_service import has_work_access
from ..tenant_db import get_tenant_db

router = APIRouter(prefix="/views", tags=["Saved views"])


def _require_access(user: CurrentUser) -> None:
    if not has_work_access(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tasks module access is required.")


@router.get("", response_model=SavedViewListResponse)
def list_views(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    _require_access(current_user)
    return SavedViewListResponse(items=[svc.to_dict(current_user, v) for v in svc.list_for_user(db, current_user)])


@router.post("", response_model=SavedViewResponse, status_code=status.HTTP_201_CREATED)
def create_view(
    payload: SavedViewCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    _require_access(current_user)
    return svc.to_dict(current_user, svc.create(db, current_user, payload))


@router.patch("/{view_id}", response_model=SavedViewResponse)
def update_view(
    view_id: UUID,
    payload: SavedViewUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    _require_access(current_user)
    return svc.to_dict(current_user, svc.update(db, current_user, view_id, payload))


@router.delete("/{view_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_view(
    view_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    _require_access(current_user)
    svc.delete(db, current_user, view_id)
    return None
