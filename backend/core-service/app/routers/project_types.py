# =============================================================================
# HERMES - Proje turleri (Destek, Talep, Proje...)
# =============================================================================
# Okuma: her dogrulanmis kullanici (efor girisinde projeler ture gore
# gruplanir, jenerik logolar tur renginde cizilir).
# Yazma: projects.manage — turu proje yoneticisi tanimlar (yeni izin kodu
# EKLENMEDI; katalog donmus).
# Silme: tur kullanimdaysa 409 (projeler sessizce turusuz kalmasin); once
# projeler baska ture tasinir. Bos tur silinir.
# =============================================================================

from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from shared.auth import CurrentUser, get_current_user
from shared.permissions import Perm

from ..authz import require_permissions
from ..models.project import Project
from ..models.project_type import ProjectType
from ..schemas.project_type import (
    ProjectTypeCreate, ProjectTypeResponse, ProjectTypeUpdate,
)
from ..tenant_db import get_tenant_db

router = APIRouter(prefix="/project-types", tags=["Project Types"])

DUPLICATE = "A project type with this name already exists."
NOT_FOUND = "Project type not found."


def _counts(db: Session) -> dict:
    rows = (
        db.query(Project.project_type_id, func.count(Project.id))
        .filter(Project.project_type_id.isnot(None))
        .group_by(Project.project_type_id)
        .all()
    )
    return {type_id: n for type_id, n in rows}


def _response(item: ProjectType, count: int) -> ProjectTypeResponse:
    return ProjectTypeResponse.model_validate(item).model_copy(update={"project_count": count})


def _get_or_404(db: Session, type_id: UUID) -> ProjectType:
    item = db.query(ProjectType).filter(ProjectType.id == type_id).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    return item


def _name_taken(db: Session, name: str, exclude: UUID = None) -> bool:
    q = db.query(ProjectType.id).filter(func.lower(ProjectType.name) == name.lower())
    if exclude:
        q = q.filter(ProjectType.id != exclude)
    return q.first() is not None


@router.get("", response_model=List[ProjectTypeResponse])
def list_project_types(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    """Proje turleri (ada gore) ve her birindeki proje sayisi."""
    counts = _counts(db)
    items = db.query(ProjectType).order_by(func.lower(ProjectType.name)).all()
    return [_response(i, counts.get(i.id, 0)) for i in items]


@router.post(
    "", response_model=ProjectTypeResponse, status_code=status.HTTP_201_CREATED,
)
def create_project_type(
    data: ProjectTypeCreate,
    admin: CurrentUser = Depends(require_permissions(Perm.PROJECTS_MANAGE)),
    db: Session = Depends(get_tenant_db),
):
    if _name_taken(db, data.name):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=DUPLICATE)
    item = ProjectType(name=data.name, color=data.color)
    db.add(item)
    try:
        db.flush()
    except IntegrityError:
        # Es zamanli ayni ad: benzersiz index son savunma hatti.
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=DUPLICATE)
    db.refresh(item)
    return _response(item, 0)


@router.put("/{type_id}", response_model=ProjectTypeResponse)
def update_project_type(
    type_id: UUID,
    data: ProjectTypeUpdate,
    admin: CurrentUser = Depends(require_permissions(Perm.PROJECTS_MANAGE)),
    db: Session = Depends(get_tenant_db),
):
    """Ad ve/veya renk. Renk degisince bu turdeki TUM jenerik logolar yeni
    renge gecer (logo istemcide tur renginden cizilir)."""
    item = _get_or_404(db, type_id)
    values = data.model_dump(exclude_unset=True, exclude_none=True)
    if "name" in values and _name_taken(db, values["name"], exclude=item.id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=DUPLICATE)
    for key, value in values.items():
        setattr(item, key, value)
    try:
        db.flush()
    except IntegrityError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=DUPLICATE)
    db.refresh(item)
    return _response(item, _counts(db).get(item.id, 0))


@router.delete("/{type_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project_type(
    type_id: UUID,
    admin: CurrentUser = Depends(require_permissions(Perm.PROJECTS_MANAGE)),
    db: Session = Depends(get_tenant_db),
):
    item = _get_or_404(db, type_id)
    in_use = _counts(db).get(item.id, 0)
    if in_use:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This project type is used by {in_use} project(s). Move them to another type first.",
        )
    db.delete(item)
    db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
