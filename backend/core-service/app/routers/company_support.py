# =============================================================================
# HERMES core — Sirket hesaplarinin destek ekibi (docs/tenant-platform/01, M2)
# =============================================================================
#   GET /api/v1/core/companies/support               sirket → destek ekibi
#   PUT /api/v1/core/companies/{account_id}/support  {display_name, group_id}
#
# Sirket hesabi auth'ta yasar (Ayarlar → Kullanicilar → Sirketler); talepleri
# saglayicinin (bu tenant'in) verisinde `company:<hesap>` musterisi olarak
# durur. Burada yonetici o musteriyi adlandirir ve varsayilan ekibini secer —
# kayit olusmadan sirket hesabi talep ACAMAZ. Yalniz saglayici tenant'larda.
# `users.manage` ister (sirket yonetimiyle ayni yetki); sirket hesabi bu
# uclara giremez (INTERNAL).
# =============================================================================

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from shared.auth import CurrentUser
from shared.permissions import Perm

from ..authz import require_permissions
from ..config import get_settings
from ..models.ticketing import SupportSourceTenant
from ..models.user_group import UserGroup
from ..services import authz_client, company_accounts, ticket_routing
from ..services.ticket_service import TicketValidationError
from .ticket_deps import get_support_db, http_error

router = APIRouter(prefix="/companies", tags=["Company accounts"])


class CompanySupportOut(BaseModel):
    account_id: UUID
    display_name: str
    group_id: Optional[UUID] = None
    group_name: Optional[str] = None
    configured: bool


class CompanySupportIn(BaseModel):
    display_name: str = Field(..., min_length=2, max_length=120)
    group_id: UUID


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
    return CompanySupportOut(
        account_id=UUID(src.source_tenant_id[len(company_accounts.SOURCE_PREFIX):]),
        display_name=src.display_name, group_id=group.id if group else None,
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
    group = db.get(UserGroup, payload.group_id)
    if group is None or not group.is_active:
        raise http_error("validation_error", "The selected team is not active.")
    try:
        src = ticket_routing.ensure_source_tenant(
            db, application=_application(db),
            source_tenant_id=company_accounts.account_source_key(account_id),
            display_name=payload.display_name,
        )
        ticket_routing.set_route(
            db, source_tenant=src, group=group,
            actor_type="tenant_user", actor_id=str(current_user.id),
        )
    except TicketValidationError as exc:
        raise http_error(exc.code if exc.code else "validation_error", str(exc))
    db.flush()
    return _out(db, src)
