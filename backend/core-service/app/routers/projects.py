# =============================================================================
# HERMES PLATFORM - Projects Router
# =============================================================================
# Proje CRUD endpoint'leri (FR 3.3). Sadece Admin erişebilir.
# =============================================================================

from typing import List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.project import ProjectCreate, ProjectUpdate, ProjectResponse
from ..services.project_service import ProjectService
from shared.auth import require_admin, CurrentUser
from shared.exceptions import NotFoundError

router = APIRouter(prefix="/projects", tags=["Projects"])


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    data: ProjectCreate,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Yeni proje oluşturur (Admin)."""
    service = ProjectService(db)
    try:
        project = service.create(data)
        return service.to_response(project)
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)


@router.get("", response_model=List[ProjectResponse])
async def list_projects(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    include_inactive: bool = Query(False),
    customer_id: UUID = Query(None, description="Müşteriye göre filtrele"),
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Projeleri listeler (Admin)."""
    service = ProjectService(db)
    
    if customer_id:
        projects = service.get_by_customer(customer_id, include_inactive=include_inactive)
    else:
        projects = service.get_all(skip=skip, limit=limit, include_inactive=include_inactive)
    
    return [service.to_response(p) for p in projects]


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: UUID,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Proje detaylarını getirir (Admin)."""
    service = ProjectService(db)
    try:
        project = service.get_by_id_or_404(project_id)
        return service.to_response(project)
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)


@router.put("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: UUID,
    data: ProjectUpdate,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Projeyi günceller (Admin)."""
    service = ProjectService(db)
    try:
        project = service.update(project_id, data)
        return service.to_response(project)
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: UUID,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Projeyi siler - soft delete (Admin)."""
    service = ProjectService(db)
    try:
        service.delete(project_id, soft=False)
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)
