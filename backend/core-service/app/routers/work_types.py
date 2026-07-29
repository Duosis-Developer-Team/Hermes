# =============================================================================
# HERMES PLATFORM - Work Types Router
# =============================================================================
# İş Tipi CRUD endpoint'leri (FR 3.2). Sadece Admin erişebilir.
# =============================================================================

from typing import List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.work_type import WorkTypeCreate, WorkTypeUpdate, WorkTypeResponse
from ..services.work_type_service import WorkTypeService
from shared.auth import CurrentUser, get_current_user
# RBAC R2: guard'lar izin-tabanli — is_admin bit'i karar mercii degil.
from ..authz import require_permissions
from shared.permissions import Perm
from shared.exceptions import NotFoundError

router = APIRouter(prefix="/work-types", tags=["Work Types"])


@router.post("", response_model=WorkTypeResponse, status_code=status.HTTP_201_CREATED)
async def create_work_type(
    data: WorkTypeCreate,
    admin: CurrentUser = Depends(require_permissions(Perm.REFERENCE_MANAGE)),
    db: Session = Depends(get_db)
):
    """Yeni iş tipi oluşturur (Admin)."""
    service = WorkTypeService(db)
    return service.create(data)


@router.get("", response_model=List[WorkTypeResponse])
async def list_work_types(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    include_inactive: bool = Query(False),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """İş tiplerini listeler (Authenticated Users)."""
    service = WorkTypeService(db)
    return service.get_all(skip=skip, limit=limit, include_inactive=include_inactive)


@router.get("/{work_type_id}", response_model=WorkTypeResponse)
async def get_work_type(
    work_type_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """İş tipi detaylarını getirir (Authenticated Users)."""
    service = WorkTypeService(db)
    try:
        return service.get_by_id_or_404(work_type_id)
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)


@router.put("/{work_type_id}", response_model=WorkTypeResponse)
async def update_work_type(
    work_type_id: UUID,
    data: WorkTypeUpdate,
    admin: CurrentUser = Depends(require_permissions(Perm.REFERENCE_MANAGE)),
    db: Session = Depends(get_db)
):
    """İş tipini günceller (Admin)."""
    service = WorkTypeService(db)
    try:
        return service.update(work_type_id, data)
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)


@router.delete("/{work_type_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_work_type(
    work_type_id: UUID,
    admin: CurrentUser = Depends(require_permissions(Perm.REFERENCE_MANAGE)),
    db: Session = Depends(get_db)
):
    """İş tipini siler - soft delete (Admin)."""
    service = WorkTypeService(db)
    try:
        service.delete(work_type_id, soft=False)
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)
