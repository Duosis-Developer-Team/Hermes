# =============================================================================
# HERMES - Musteri logosu servisi
# =============================================================================
# Kurallar (tek kapi: services/logo_image — proje logolariyla ORTAK; DB
# CHECK'leri ikinci savunma hattidir):
#   - Boyut: 1 bayt .. CUSTOMER_LOGO_MAX_BYTES (256 KB).
#   - Tip: yalnizca PNG / JPEG / WEBP; SVG ve digerleri REDDEDILIR.
#   - Beyan edilen Content-Type ile sihirli baytlarin tespit ettigi tip
#     AYNI olmali (uzanti/beyan yalanina karsi).
#   - Musteri cozumu tenant'a ACIKCA baglidir (RLS'e ek savunma):
#     baska tenant'in musterisi = var olmayan musteri (404).
# =============================================================================

import hashlib
from typing import Dict, Iterable, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from shared.exceptions import NotFoundError

from ..models.customer import Customer
from ..models.customer_logo import CustomerLogo
from ..tenant_db import SESSION_TENANT_KEY
# Ortak dogrulama; eski cagri noktalari (logos.sniff, logos.LogoTooLarge ...)
# icin bu modulden de disa verilir.
from .logo_image import (  # noqa: F401
    LogoRejected, LogoTooLarge, if_none_match_hits, normalize_content_type,
    sniff, validate,
)


def _tenant_of(db: Session) -> Optional[UUID]:
    value = db.info.get(SESSION_TENANT_KEY)
    return UUID(str(value)) if value else None


def get_customer_or_404(db: Session, customer_id: UUID) -> Customer:
    """Musteriyi OTURUMUN tenant'inda cozer; baglam yoksa fail-closed."""
    tenant_id = _tenant_of(db)
    customer = None
    if tenant_id:
        customer = (
            db.query(Customer)
            .filter(Customer.id == customer_id, Customer.tenant_id == tenant_id)
            .first()
        )
    if customer is None:
        raise NotFoundError("Müşteri", customer_id)
    return customer


def _logo_row(db: Session, customer: Customer) -> Optional[CustomerLogo]:
    return (
        db.query(CustomerLogo)
        .filter(
            CustomerLogo.customer_id == customer.id,
            CustomerLogo.tenant_id == customer.tenant_id,
        )
        .first()
    )


def put_logo(
    db: Session, customer_id: UUID, data: bytes, declared_type: Optional[str],
    actor_user_id: Optional[str],
) -> CustomerLogo:
    """Logoyu yaratir ya da degistirir (musteri basina tek satir)."""
    customer = get_customer_or_404(db, customer_id)
    content_type = validate(data, declared_type)
    etag = hashlib.sha256(data).hexdigest()
    actor = UUID(str(actor_user_id)) if actor_user_id else None

    row = _logo_row(db, customer)
    if row is None:
        row = CustomerLogo(
            tenant_id=customer.tenant_id, customer_id=customer.id,
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


def delete_logo(db: Session, customer_id: UUID) -> None:
    """Logoyu kaldirir; logo yoksa sessizce gecer (idempotent)."""
    customer = get_customer_or_404(db, customer_id)
    row = _logo_row(db, customer)
    if row is not None:
        db.delete(row)
        db.flush()


def get_logo(db: Session, customer_id: UUID) -> CustomerLogo:
    """Musteri yok / baska tenant / logo yok -> ayni NotFoundError."""
    customer = get_customer_or_404(db, customer_id)
    row = _logo_row(db, customer)
    if row is None:
        raise NotFoundError("Müşteri logosu", customer_id)
    return row


def etags_for(db: Session, customer_ids: Iterable[UUID]) -> Dict[UUID, str]:
    """Liste yanitlari icin TEK sorgu: {customer_id: etag}. Baytlar okunmaz."""
    ids = list({cid for cid in customer_ids if cid is not None})
    if not ids:
        return {}
    query = db.query(CustomerLogo.customer_id, CustomerLogo.etag).filter(
        CustomerLogo.customer_id.in_(ids)
    )
    tenant_id = _tenant_of(db)
    if tenant_id:
        query = query.filter(CustomerLogo.tenant_id == tenant_id)
    return {cid: etag for cid, etag in query.all()}
