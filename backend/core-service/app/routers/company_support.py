# =============================================================================
# HERMES core — Sirket hesaplarinin destek ekibi (docs/tenant-platform/01, M2)
# =============================================================================
#   GET /api/v1/core/companies/support               sirket → musteri + destek ekibi
#   PUT /api/v1/core/companies/{account_id}/support  {customer_id, group_id?}
#
# Sirket hesabi auth'ta yasar (Ayarlar → Kullanicilar → Sirketler); talepleri
# saglayicinin (bu tenant'in) verisinde `company:<hesap>` musterisi olarak
# durur. Hesap bir MUSTERI KAYDINA baglanir (0027, CTO 14.10): ad ve logo
# `customers`tan gelir, is kalemi/efor varsayilan musterisi odur; musteri
# basina tek sirket hesabi. Ekip secilmeden (rota yoksa) sirket hesabi talep
# ACAMAZ. Yalniz saglayici tenant'larda.
# `users.manage` ister (sirket yonetimiyle ayni yetki); sirket hesabi bu
# uclara giremez (INTERNAL).
# =============================================================================

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from shared.auth import CurrentUser
from shared.permissions import Perm

from ..authz import require_permissions
from ..config import get_settings
from ..models.customer import Customer
from ..models.ticketing import SupportSourceTenant
from ..models.user_group import UserGroup
from ..services import authz_client, company_accounts, ticket_routing
from ..services.ticket_service import TicketValidationError
from .ticket_deps import get_support_db, http_error

router = APIRouter(prefix="/companies", tags=["Company accounts"])


class CompanySupportOut(BaseModel):
    account_id: UUID
    display_name: str
    customer_id: Optional[UUID] = None
    customer_name: Optional[str] = None
    group_id: Optional[UUID] = None
    group_name: Optional[str] = None
    configured: bool


class CompanySupportIn(BaseModel):
    customer_id: UUID
    group_id: Optional[UUID] = None


class CompanySupportList(BaseModel):
    provider: bool
    items: List[CompanySupportOut]


def _application(db: Session):
    settings = get_settings()
    app = ticket_routing.get_application(db, settings.SUPPORT_HERMES_APPLICATION_CODE)
    if app is None:
        app = ticket_routing.ensure_application(
            db, code=settings.SUPPORT_HERMES_APPLICATION_CODE, display_name="Hermes",
        )
    return app


def _out(db: Session, src: SupportSourceTenant) -> CompanySupportOut:
    route = ticket_routing.active_route(db, source_tenant_row_id=src.id)
    group = db.get(UserGroup, route.group_id) if route is not None else None
    customer = db.get(Customer, src.customer_id) if src.customer_id else None
    return CompanySupportOut(
        account_id=UUID(src.source_tenant_id[len(company_accounts.SOURCE_PREFIX):]),
        display_name=src.display_name,
        customer_id=customer.id if customer else None,
        customer_name=customer.name if customer else None,
        group_id=group.id if group else None,
        group_name=group.name if group else None,
        configured=bool(group and group.is_active and src.status == "active"),
    )


@router.get("/support", response_model=CompanySupportList)
def list_company_support(
    _: CurrentUser = Depends(require_permissions(Perm.USERS_MANAGE)),
    db: Optional[Session] = Depends(get_support_db),
):
    """Sirket hesaplarinin musteri kaydi + destek ekibi. Saglayici olmayan
    tenant'ta `provider=false` (sirket hesabi talep acamaz)."""
    if db is None:
        return CompanySupportList(provider=False, items=[])
    app = ticket_routing.get_application(db, get_settings().SUPPORT_HERMES_APPLICATION_CODE)
    if app is None:
        return CompanySupportList(provider=True, items=[])
    rows = (
        db.query(SupportSourceTenant)
        .filter(SupportSourceTenant.application_id == app.id,
                SupportSourceTenant.source_tenant_id.like(f"{company_accounts.SOURCE_PREFIX}%"))
        .order_by(SupportSourceTenant.display_name).all()
    )
    return CompanySupportList(provider=True, items=[_out(db, r) for r in rows])


@router.put("/{account_id}/support", response_model=CompanySupportOut)
def set_company_support(
    account_id: UUID,
    payload: CompanySupportIn,
    current_user: CurrentUser = Depends(require_permissions(Perm.USERS_MANAGE)),
    db: Optional[Session] = Depends(get_support_db),
):
    if db is None:
        raise http_error("forbidden", "This workspace does not receive support requests.")
    # Hedef GERCEKTEN bu tenant'in sirket hesabi mi? (auth'a sorulur; kisi
    # hesabina musteri kaydi acilmaz.)
    try:
        profile = authz_client.access_profile(str(account_id), tenant_id=current_user.tenant_id)
    except authz_client.AuthzUnavailable:
        raise http_error("support_not_configured", "Authorization service is unavailable.")
    if profile.account_kind != "company":
        raise http_error("not_found", "Company account not found.")
    customer = db.get(Customer, payload.customer_id)
    if customer is None or not customer.is_active:
        raise http_error("validation_error", "Seçilen müşteri bulunamadı ya da pasif.")
    group = None
    if payload.group_id is not None:
        group = db.get(UserGroup, payload.group_id)
        if group is None or not group.is_active:
            raise http_error("validation_error", "Seçilen ekip aktif değil.")
    application = _application(db)
    key = company_accounts.account_source_key(account_id)
    taken = (db.query(SupportSourceTenant.id)
             .filter(SupportSourceTenant.application_id == application.id,
                     SupportSourceTenant.customer_id == customer.id,
                     SupportSourceTenant.source_tenant_id != key).first())
    if taken is not None:
        raise http_error("conflict", "Bu müşteri başka bir şirket hesabına bağlı.")
    try:
        # Ad musteriden (SNAPSHOT; musteri yeniden adlandirilinca senkronlanir).
        src = ticket_routing.ensure_source_tenant(
            db, application=application, source_tenant_id=key, display_name=customer.name,
        )
        src.customer_id = customer.id
        if group is not None:
            ticket_routing.set_route(
                db, source_tenant=src, group=group,
                actor_type="tenant_user", actor_id=str(current_user.id),
            )
    except TicketValidationError as exc:
        raise http_error(exc.code if exc.code else "validation_error", str(exc))
    db.flush()
    return _out(db, src)
