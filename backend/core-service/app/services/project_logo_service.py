# =============================================================================
# HERMES - Proje logosu servisi
# =============================================================================
# customer_logo_service'in aynasi. Dogrulama/sunum kurallari ORTAK
# (services/logo_image); burada yalnizca proje cozumu ve satir islemleri var.
#   - Proje cozumu tenant'a ACIKCA baglidir (RLS'e ek savunma):
#     baska tenant'in projesi = var olmayan proje (404).
# =============================================================================

import hashlib
from typing import Dict, Iterable, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from shared.exceptions import NotFoundError

from ..models.project import Project
from ..models.project_logo import ProjectLogo
from ..tenant_db import SESSION_TENANT_KEY
from .logo_image import (  # noqa: F401
    LogoRejected, LogoTooLarge, if_none_match_hits, validate,
)


def _tenant_of(db: Session) -> Optional[UUID]:
    value = db.info.get(SESSION_TENANT_KEY)
    return UUID(str(value)) if value else None


def get_project_or_404(db: Session, project_id: UUID) -> Project:
    """Projeyi OTURUMUN tenant'inda cozer; baglam yoksa fail-closed."""
    tenant_id = _tenant_of(db)
    project = None
    if tenant_id:
        project = (
            db.query(Project)
            .filter(Project.id == project_id, Project.tenant_id == tenant_id)
            .first()
        )
    if project is None:
        raise NotFoundError("Proje", project_id)
    return project


def _logo_row(db: Session, project: Project) -> Optional[ProjectLogo]:
    return (
        db.query(ProjectLogo)
        .filter(
            ProjectLogo.project_id == project.id,
            ProjectLogo.tenant_id == project.tenant_id,
        )
        .first()
    )


def put_logo(
    db: Session, project_id: UUID, data: bytes, declared_type: Optional[str],
    actor_user_id: Optional[str],
) -> ProjectLogo:
    """Logoyu yaratir ya da degistirir (proje basina tek satir)."""
    project = get_project_or_404(db, project_id)
    content_type = validate(data, declared_type)
    etag = hashlib.sha256(data).hexdigest()
    actor = UUID(str(actor_user_id)) if actor_user_id else None

    row = _logo_row(db, project)
    if row is None:
        row = ProjectLogo(
            tenant_id=project.tenant_id, project_id=project.id,
            content=data, content_type=content_type, etag=etag, updated_by=actor,
        )
        db.add(row)
    else:
        row.content = data
        row.content_type = content_type
        row.etag = etag
        row.updated_by = actor
    db.flush()
    return row


def delete_logo(db: Session, project_id: UUID) -> None:
    """Logoyu kaldirir; logo yoksa sessizce gecer (idempotent)."""
    project = get_project_or_404(db, project_id)
    row = _logo_row(db, project)
    if row is not None:
        db.delete(row)
        db.flush()


def get_logo(db: Session, project_id: UUID) -> ProjectLogo:
    """Proje yok / baska tenant / logo yok -> ayni NotFoundError."""
    project = get_project_or_404(db, project_id)
    row = _logo_row(db, project)
    if row is None:
        raise NotFoundError("Proje logosu", project_id)
    return row


def etags_for(db: Session, project_ids: Iterable[UUID]) -> Dict[UUID, str]:
    """Liste yanitlari icin TEK sorgu: {project_id: etag}. Baytlar okunmaz."""
    ids = list({pid for pid in project_ids if pid is not None})
    if not ids:
        return {}
    query = db.query(ProjectLogo.project_id, ProjectLogo.etag).filter(
        ProjectLogo.project_id.in_(ids)
    )
    tenant_id = _tenant_of(db)
    if tenant_id:
        query = query.filter(ProjectLogo.tenant_id == tenant_id)
    return {pid: etag for pid, etag in query.all()}
