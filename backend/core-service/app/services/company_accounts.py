# =============================================================================
# HERMES core — Sirket hesabinin talep yuzeyi (auth 0007, docs/tenant-platform/01)
# =============================================================================
# Sirket hesabi (ornegin Defacto'ya verilen TEK hesap) saglayici tenant'in
# ICINDE yasar ama musteridir:
#   - hub YOKTUR (saglayici yuzeyi kapali);
#   - portalda saglayicisi KENDI tenant'idir (talep agi baglantisi gerekmez;
#     kendine baglanti semada yasak oldugu icin burada sentezlenir);
#   - musteri kaydi `company:<hesap kimligi>`dir ve ancak yonetici sirketin
#     destek ekibini sectiginde olusur (ad + ekip). Kayit yoksa talep acilamaz.
# =============================================================================

from typing import Optional

from sqlalchemy import text

from . import support_tenant as support
from . import ticket_network as network
from ..module_gate import is_company_account

SOURCE_PREFIX = "company:"


def source_key(user) -> str:
    """Portal kapsaminin musteri anahtari: sirket hesabinda hesabin kendisi,
    kisilerde kullanicinin tenant'i (talep agi)."""
    if is_company_account(user):
        return f"{SOURCE_PREFIX}{user.id}"
    return str(user.tenant_id)


def account_source_key(account_id) -> str:
    return f"{SOURCE_PREFIX}{account_id}"


def self_link(user) -> network.ProviderLink:
    """Sirket hesabinin tek saglayicisi: kendi tenant'i."""
    with support.global_session() as gdb:
        slug = gdb.execute(
            text("SELECT slug FROM tenant_registry WHERE tenant_id = CAST(:t AS uuid)"),
            {"t": str(user.tenant_id)},
        ).scalar()
        available = network.provider_available(gdb, user.tenant_id)
    name: Optional[str] = (slug or "").replace("-", " ").title() or None
    return network.ProviderLink(
        provider_tenant_id=str(user.tenant_id), display_name=name,
        is_active=True, available=available,
    )
