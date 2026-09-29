# =============================================================================
# HERMES PLATFORM - Projects Router
# =============================================================================
# Proje CRUD endpoint'leri (FR 3.3). Sadece Admin erişebilir.
# =============================================================================

from typing import List, Optional
from uuid import UUID
from fastapi import (
    APIRouter, Depends, File, Header, HTTPException, Query, Response, UploadFile,
    status,
)
from sqlalchemy.orm import Session

from ..tenant_db import get_tenant_db
from ..schemas.project import (
    ProjectCreate, ProjectLogoResponse, ProjectResponse, ProjectUpdate,
)
from ..services.project_service import ProjectService
from ..services import project_logo_service as logos
from ..services.logo_image import logo_response
from ..models.project_logo import PROJECT_LOGO_MAX_BYTES
from shared.auth import CurrentUser, get_current_user
# RBAC R2: guard'lar izin-tabanli — is_admin bit'i karar mercii degil.
from ..authz import require_permissions
from shared.permissions import Perm
from shared.exceptions import NotFoundError

router = APIRouter(prefix="/projects", tags=["Projects"])


def _with_logo_meta(db: Session, service: ProjectService, projects) -> List[ProjectResponse]:
    """ORM projelerini logo metasiyla yanitlar — logo icin TEK sorgu."""
    etags = logos.etags_for(db, (p.id for p in projects))
    out = []
    for p in projects:
        etag = etags.get(p.id)
        out.append(ProjectResponse.model_validate(service.to_response(p)).model_copy(
            update={"has_logo": etag is not None, "logo_etag": etag}
        ))
    return out


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(
    data: ProjectCreate,
    admin: CurrentUser = Depends(require_permissions(Perm.PROJECTS_MANAGE)),
    db: Session = Depends(get_tenant_db)
):
    """Yeni proje oluşturur (Admin)."""
    service = ProjectService(db)
    try:
        project = service.create(data)
        return service.to_response(project)
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)


@router.get("", response_model=List[ProjectResponse])
def list_projects(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    include_inactive: bool = Query(False),
    customer_id: UUID = Query(None, description="Müşteriye göre filtrele"),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db)
):
    """Projeleri listeler (Authenticated Users)."""
    service = ProjectService(db)

    if customer_id:
        projects = service.get_by_customer(customer_id, include_inactive=include_inactive)
    else:
        projects = service.get_all(skip=skip, limit=limit, include_inactive=include_inactive)

    return _with_logo_meta(db, service, projects)


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(
    project_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db)
):
    """Proje detaylarını getirir (Authenticated Users)."""
    service = ProjectService(db)
    try:
        project = service.get_by_id_or_404(project_id)
        return _with_logo_meta(db, service, [project])[0]
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)


@router.put("/{project_id}", response_model=ProjectResponse)
def update_project(
    project_id: UUID,
    data: ProjectUpdate,
    admin: CurrentUser = Depends(require_permissions(Perm.PROJECTS_MANAGE)),
    db: Session = Depends(get_tenant_db)
):
    """Projeyi günceller (Admin)."""
    service = ProjectService(db)
    try:
        project = service.update(project_id, data)
        return _with_logo_meta(db, service, [project])[0]
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: UUID,
    admin: CurrentUser = Depends(require_permissions(Perm.PROJECTS_MANAGE)),
    db: Session = Depends(get_tenant_db)
):
    """Projeyi siler - soft delete (Admin)."""
    service = ProjectService(db)
    try:
        service.delete(project_id, soft=False)
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)


# =============================================================================
# Proje logosu (opsiyonel marka gorseli)
# =============================================================================
# Yazma = proje duzenleme yetkisi (projects.manage). Okuma = proje
# listesini gorebilen her dogrulanmis kullanici (secicilerde gosterilir).
# Proje yok / baska tenant / logo yok -> ayni 404 zarfi.
# Dogrulama ve sunum kurallari musteri logolariyla ORTAK (services/logo_image).


@router.put("/{project_id}/logo", response_model=ProjectLogoResponse)
def put_project_logo(
    project_id: UUID,
    file: UploadFile = File(...),
    admin: CurrentUser = Depends(require_permissions(Perm.PROJECTS_MANAGE)),
    db: Session = Depends(get_tenant_db),
):
    """Proje logosunu yukler / degistirir (PNG, JPEG, WEBP; en fazla 256 KB)."""
    # Tavan+1 bayt okunur: tamamini bellege almadan asimi yakalar.
    data = file.file.read(PROJECT_LOGO_MAX_BYTES + 1)
    try:
        row = logos.put_logo(
            db, project_id, data, file.content_type, actor_user_id=admin.id,
        )
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)
    except logos.LogoTooLarge:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"The logo exceeds the maximum size of {PROJECT_LOGO_MAX_BYTES // 1024} KB.",
        )
    except logos.LogoRejected as e:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=str(e),
        )
    return ProjectLogoResponse(has_logo=True, logo_etag=row.etag)


@router.delete("/{project_id}/logo", status_code=status.HTTP_204_NO_CONTENT)
def delete_project_logo(
    project_id: UUID,
    admin: CurrentUser = Depends(require_permissions(Perm.PROJECTS_MANAGE)),
    db: Session = Depends(get_tenant_db),
):
    """Proje logosunu kaldirir (logo yoksa da 204 — idempotent)."""
    try:
        logos.delete_logo(db, project_id)
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{project_id}/logo")
def get_project_logo(
    project_id: UUID,
    if_none_match: Optional[str] = Header(None),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    """Logo baytlarini dondurur; ETag + If-None-Match -> 304."""
    try:
        row = logos.get_logo(db, project_id)
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)
    return logo_response(row, if_none_match)
