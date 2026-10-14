# =============================================================================
# HERMES core — Sirket hesabi logosu (docs/tenant-platform/01)
# =============================================================================
#   GET    /api/v1/core/companies/logos              {account_id: etag}
#   PUT    /api/v1/core/companies/{account_id}/logo   multipart `file` (users.manage)
#   DELETE /api/v1/core/companies/{account_id}/logo   (users.manage; idempotent)
#   GET    /api/v1/core/companies/{account_id}/logo   bayt + ETag/304
#
# Musteri logosuyla AYNI kurallar (services/logo_image). Hedefin GERCEKTEN bu
# tenant'in sirket hesabi oldugu auth'a sorulur (kisi hesabina logo yazilmaz).
# Sirket hesabi bu uclara giremez (INTERNAL).
# =============================================================================

import hashlib
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Header, HTTPException, Response, UploadFile, status
from sqlalchemy.orm import Session

from shared.auth import CurrentUser, get_current_user
from shared.permissions import Perm

from ..authz import require_permissions
from ..models.company_logo import CompanyLogo
from ..models.logo_image import LOGO_MAX_BYTES
from ..services import authz_client
from ..services.logo_image import LogoRejected, LogoTooLarge, logo_response, validate
from ..tenant_db import get_tenant_db

router = APIRouter(prefix="/companies", tags=["Company accounts"])


def _require_company(account_id: UUID, tenant_id) -> None:
    try:
        profile = authz_client.access_profile(str(account_id), tenant_id=tenant_id)
    except authz_client.AuthzUnavailable:
        raise HTTPException(status_code=503, detail="Authorization service is unavailable.")
    if profile.account_kind != "company":
        raise HTTPException(status_code=404, detail="Company account not found.")


def _row(db: Session, account_id: UUID) -> Optional[CompanyLogo]:
    return db.query(CompanyLogo).filter(CompanyLogo.account_id == account_id).first()


@router.get("/logos")
def company_logos(
    _: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    """Liste ekranlari icin TEK sorgu: {account_id: etag} (baytlar okunmaz)."""
    return {"logos": {str(a): e for a, e in db.query(CompanyLogo.account_id, CompanyLogo.etag).all()}}


@router.put("/{account_id}/logo")
def put_company_logo(
    account_id: UUID,
    file: UploadFile = File(...),
    admin: CurrentUser = Depends(require_permissions(Perm.USERS_MANAGE)),
    db: Session = Depends(get_tenant_db),
):
    _require_company(account_id, admin.tenant_id)
    data = file.file.read(LOGO_MAX_BYTES + 1)
    try:
        content_type = validate(data, file.content_type)
    except LogoTooLarge:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            detail=f"The logo exceeds the maximum size of {LOGO_MAX_BYTES // 1024} KB.")
    except LogoRejected as exc:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=str(exc))
    etag = hashlib.sha256(data).hexdigest()
    row = _row(db, account_id)
    if row is None:
        row = CompanyLogo(account_id=account_id)
        db.add(row)
    row.content, row.content_type, row.etag = data, content_type, etag
    row.updated_by = UUID(str(admin.id))
    db.flush()
    return {"has_logo": True, "logo_etag": etag}


@router.delete("/{account_id}/logo", status_code=status.HTTP_204_NO_CONTENT)
def delete_company_logo(
    account_id: UUID,
    admin: CurrentUser = Depends(require_permissions(Perm.USERS_MANAGE)),
    db: Session = Depends(get_tenant_db),
):
    row = _row(db, account_id)
    if row is not None:
        db.delete(row)
        db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{account_id}/logo")
def get_company_logo(
    account_id: UUID,
    if_none_match: Optional[str] = Header(None),
    _: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    row = _row(db, account_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Logo not found.")
    return logo_response(row, if_none_match)
