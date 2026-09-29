# =============================================================================
# HERMES PLATFORM - Customers Router
# =============================================================================
# Müşteri CRUD endpoint'leri (FR 3.1). Sadece Admin erişebilir.
# =============================================================================

from typing import List, Optional
from uuid import UUID
from fastapi import (
    APIRouter, Depends, File, Header, HTTPException, Query, Response, UploadFile,
    status,
)
from sqlalchemy.orm import Session

from ..tenant_db import get_tenant_db
from ..schemas.customer import (
    CustomerCreate, CustomerLogoResponse, CustomerResponse, CustomerUpdate,
)
from ..services.customer_service import CustomerService
from ..services import customer_logo_service as logos
from ..models.customer_logo import CUSTOMER_LOGO_MAX_BYTES
from shared.auth import CurrentUser, get_current_user
# RBAC R2: guard'lar izin-tabanli — is_admin bit'i karar mercii degil.
from ..authz import require_permissions
from shared.permissions import Perm
from shared.exceptions import NotFoundError

router = APIRouter(prefix="/customers", tags=["Customers"])


def _with_logo_meta(db: Session, customers) -> List[CustomerResponse]:
    """ORM musterilerini logo metasiyla yanitlar — logo icin TEK sorgu."""
    etags = logos.etags_for(db, (c.id for c in customers))
    out = []
    for c in customers:
        etag = etags.get(c.id)
        out.append(CustomerResponse.model_validate(c).model_copy(
            update={"has_logo": etag is not None, "logo_etag": etag}
        ))
    return out


@router.post("", response_model=CustomerResponse, status_code=status.HTTP_201_CREATED)
def create_customer(
    data: CustomerCreate,
    admin: CurrentUser = Depends(require_permissions(Perm.CUSTOMERS_MANAGE)),
    db: Session = Depends(get_tenant_db)
):
    """Yeni müşteri oluşturur (Admin)."""
    service = CustomerService(db)
    return service.create(data)


@router.get("", response_model=List[CustomerResponse])
def list_customers(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    include_inactive: bool = Query(False),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db)
):
    """Müşterileri listeler (Authenticated Users)."""
    service = CustomerService(db)
    # Regular users should only see active customers unless specified otherwise (logic can be refined)
    rows = service.get_all(skip=skip, limit=limit, include_inactive=include_inactive)
    return _with_logo_meta(db, rows)


@router.get("/{customer_id}", response_model=CustomerResponse)
def get_customer(
    customer_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db)
):
    """Müşteri detaylarını getirir (Authenticated Users)."""
    service = CustomerService(db)
    try:
        return _with_logo_meta(db, [service.get_by_id_or_404(customer_id)])[0]
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)


@router.put("/{customer_id}", response_model=CustomerResponse)
def update_customer(
    customer_id: UUID,
    data: CustomerUpdate,
    admin: CurrentUser = Depends(require_permissions(Perm.CUSTOMERS_MANAGE)),
    db: Session = Depends(get_tenant_db)
):
    """Müşteriyi günceller (Admin)."""
    service = CustomerService(db)
    try:
        return _with_logo_meta(db, [service.update(customer_id, data)])[0]
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)


@router.delete("/{customer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_customer(
    customer_id: UUID,
    admin: CurrentUser = Depends(require_permissions(Perm.CUSTOMERS_MANAGE)),
    db: Session = Depends(get_tenant_db)
):
    """Müşteriyi siler - soft delete (Admin)."""
    service = CustomerService(db)
    try:
        service.delete(customer_id, soft=False)
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)
    except Exception as e:
        # Check for integrity error (foreign key constraint)
        if "integrityerror" in str(e).lower() or "foreign key constraint" in str(e).lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, 
                detail="This customer cannot be deleted because it has related records. Delete the related work logs and projects first."
            )
        raise e


# =============================================================================
# Musteri logosu (opsiyonel marka gorseli)
# =============================================================================
# Yazma = musteri duzenleme yetkisi (customers.manage). Okuma = musteri
# listesini gorebilen her dogrulanmis kullanici (secicilerde gosterilir).
# Musteri yok / baska tenant / logo yok -> ayni 404 zarfi.

_LOGO_CACHE_CONTROL = "private, max-age=86400"


@router.put("/{customer_id}/logo", response_model=CustomerLogoResponse)
def put_customer_logo(
    customer_id: UUID,
    file: UploadFile = File(...),
    admin: CurrentUser = Depends(require_permissions(Perm.CUSTOMERS_MANAGE)),
    db: Session = Depends(get_tenant_db),
):
    """Musteri logosunu yukler / degistirir (PNG, JPEG, WEBP; en fazla 256 KB)."""
    # Tavan+1 bayt okunur: tamamini bellege almadan asimi yakalar.
    data = file.file.read(CUSTOMER_LOGO_MAX_BYTES + 1)
    try:
        row = logos.put_logo(
            db, customer_id, data, file.content_type, actor_user_id=admin.id,
        )
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)
    except logos.LogoTooLarge:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"The logo exceeds the maximum size of {CUSTOMER_LOGO_MAX_BYTES // 1024} KB.",
        )
    except logos.LogoRejected as e:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=str(e),
        )
    return CustomerLogoResponse(has_logo=True, logo_etag=row.etag)


@router.delete("/{customer_id}/logo", status_code=status.HTTP_204_NO_CONTENT)
def delete_customer_logo(
    customer_id: UUID,
    admin: CurrentUser = Depends(require_permissions(Perm.CUSTOMERS_MANAGE)),
    db: Session = Depends(get_tenant_db),
):
    """Musteri logosunu kaldirir (logo yoksa da 204 — idempotent)."""
    try:
        logos.delete_logo(db, customer_id)
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{customer_id}/logo")
def get_customer_logo(
    customer_id: UUID,
    if_none_match: Optional[str] = Header(None),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    """Logo baytlarini dondurur; ETag + If-None-Match -> 304."""
    try:
        row = logos.get_logo(db, customer_id)
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)
    headers = {
        "ETag": f'"{row.etag}"',
        "Cache-Control": _LOGO_CACHE_CONTROL,
        "X-Content-Type-Options": "nosniff",
    }
    if logos.if_none_match_hits(if_none_match, row.etag):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    return Response(content=bytes(row.content), media_type=row.content_type, headers=headers)
