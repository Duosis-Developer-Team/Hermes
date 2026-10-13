# =============================================================================
# HERMES core — Talep agi: kim kime talep acabilir?
# =============================================================================
# Saglayici (provider) = canonical talebin yasadigi tenant. Iki kaynaktan
# olur:
#   1) yapilandirilmis destek tenant'i (`HERMES_SUPPORT_TENANT_ID`; LogiSlot
#      gibi dis entegrasyonlarin da saglayicisi), ve
#   2) talep agi baglantisinin (`ticket_network_links`) saglayici ucu.
# Talep eden (requester) = baglantinin diger ucu; o tenant'in kullanicilari
# portali (Actigim talepler) gorur.
#
# KURALLAR (fail-closed):
#   - Saglayici CALISTIRILABILIR olmali (tenant_registry durumu active/grace)
#     ve `tickets` modulu acik olmali; degilse o saglayiciya gecit ACILMAZ.
#   - Talep edenin hangi saglayiciya ulasabilecegini YALNIZCA bu tablo
#     soyler; istekteki `provider` degeri bu kumeye karsi DOGRULANIR,
#     sessizce duzeltilmez.
#   - Pasif baglanti yeni talebi durdurur; gecmis talepler iki tarafta da
#     gorunur kalir (mevcut "route kapat" anlamiyla ayni).
# =============================================================================

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from shared.modules import Module

from ..models.ticket_network import TicketNetworkLink
from . import support_tenant as support

RUNNABLE_STATUSES = support.RUNNABLE_TENANT_STATUSES


def _now():
    return datetime.now(timezone.utc)


def _uuid(value) -> Optional[str]:
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        return None


class NetworkError(ValueError):
    """Baglanti islemi reddedildi; `code` makine-okur."""

    def __init__(self, message: str, *, code: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class ProviderLink:
    """Talep edenin gozunden bir saglayici."""

    provider_tenant_id: str
    display_name: Optional[str]
    is_active: bool          # baglanti acik mi (yeni talep)
    available: bool          # saglayici calisir + tickets modulu acik
    requester_display_name: Optional[str] = None

    @property
    def can_create(self) -> bool:
        return self.is_active and self.available


# =============================================================================
# Okuma (global tablolar — herhangi bir oturumla okunabilir)
# =============================================================================

def provider_available(db: Session, tenant_id) -> bool:
    """Saglayici calistirilabilir mi ve `tickets` modulu acik mi?"""
    tid = _uuid(tenant_id)
    if tid is None:
        return False
    row = db.execute(text(
        "SELECT status, enabled_modules FROM tenant_registry "
        " WHERE tenant_id = CAST(:t AS uuid)"
    ), {"t": tid}).first()
    if row is None or row[0] not in RUNNABLE_STATUSES:
        return False
    modules = row[1] if isinstance(row[1], list) else []
    return Module.TICKETS in modules


def requester_links(db: Session, requester_tenant_id) -> List[ProviderLink]:
    """Talep edenin TUM baglantilari (pasifler dahil — gecmis gorunur)."""
    tid = _uuid(requester_tenant_id)
    if tid is None:
        return []
    rows = db.execute(text(
        "SELECT l.provider_tenant_id, "
        "       COALESCE(l.provider_display_name, r.slug), l.is_active, "
        "       r.status, r.enabled_modules, l.requester_display_name "
        "  FROM ticket_network_links l "
        "  JOIN tenant_registry r ON r.tenant_id = l.provider_tenant_id "
        " WHERE l.requester_tenant_id = CAST(:t AS uuid) "
        " ORDER BY COALESCE(l.provider_display_name, r.slug)"
    ), {"t": tid}).all()
    out = []
    for provider, name, active, status, modules, requester_name in rows:
        mods = modules if isinstance(modules, list) else []
        out.append(ProviderLink(
            provider_tenant_id=str(provider),
            display_name=name,
            is_active=bool(active),
            available=status in RUNNABLE_STATUSES and Module.TICKETS in mods,
            requester_display_name=requester_name,
        ))
    return out


def is_provider(db: Session, tenant_id) -> bool:
    """Bu tenant'in gelen talep kutusu (hub) var mi?

    Yapilandirilmis destek tenant'i HER ZAMAN saglayicidir (dis
    entegrasyonlar); digerleri en az bir baglantinin saglayici ucu
    olduklarinda. Baglanti pasif olsa da hub kalir: gecmis talepler
    kapanana kadar islenebilmeli.
    """
    if support.is_support_tenant(tenant_id):
        return True
    tid = _uuid(tenant_id)
    if tid is None:
        return False
    return db.execute(text(
        "SELECT 1 FROM ticket_network_links "
        " WHERE provider_tenant_id = CAST(:t AS uuid) LIMIT 1"
    ), {"t": tid}).first() is not None


def resolve_provider(
    links: List[ProviderLink], requested: Optional[str]
) -> ProviderLink:
    """Istekteki saglayiciyi baglanti kumesine karsi cozer.

    - `requested` verilmisse: kumede OLMALI (degilse 404 — baska bir
      tenant'in varligini sizdirmayiz).
    - verilmemisse: tek baglanti varsa o; birden fazlaysa istemci SECMELI
      (`provider_required`) — tahmin yurutulmez.
    """
    if requested:
        wanted = _uuid(requested)
        for link in links:
            if link.provider_tenant_id == wanted:
                return link
        raise NetworkError(
            "This support provider is not available to your workspace.",
            code="not_found", status=404,
        )
    if not links:
        raise NetworkError(
            "Your workspace is not connected to a support provider.",
            code="route_missing", status=409,
        )
    if len(links) > 1:
        raise NetworkError(
            "Choose the support provider for this request.",
            code="provider_required", status=422,
        )
    return links[0]


# =============================================================================
# Konsol (S2S) — baglanti yonetimi
# =============================================================================

def get_link(db: Session, requester, provider) -> Optional[TicketNetworkLink]:
    return (
        db.query(TicketNetworkLink)
        .filter(
            TicketNetworkLink.requester_tenant_id == _uuid(requester),
            TicketNetworkLink.provider_tenant_id == _uuid(provider),
        )
        .first()
    )


def list_links(db: Session) -> List[TicketNetworkLink]:
    return (
        db.query(TicketNetworkLink)
        .order_by(TicketNetworkLink.created_at)
        .all()
    )


def check_link_version(link: TicketNetworkLink, expected: Optional[int]) -> None:
    if expected is not None and int(expected) != int(link.version):
        raise NetworkError(
            "This connection was changed by someone else. Reload and try again.",
            code="version_conflict", status=409,
        )


def upsert_link(
    db: Session,
    *,
    requester,
    provider,
    active: bool,
    actor: Optional[str],
    requester_name: Optional[str] = None,
    provider_name: Optional[str] = None,
) -> TicketNetworkLink:
    """Global indeks satirini yazar. Cagiran, saglayici tarafindaki route'u
    AYNI transaction'da yazar (bkz. routers/internal_support)."""
    link = get_link(db, requester, provider)
    if link is None:
        link = TicketNetworkLink(
            requester_tenant_id=_uuid(requester),
            provider_tenant_id=_uuid(provider),
            is_active=active,
            requester_display_name=requester_name,
            provider_display_name=provider_name,
            version=1,
            created_by=actor,
            updated_by=actor,
        )
        db.add(link)
        db.flush()
        return link
    changed = False
    if link.is_active != active:
        link.is_active = active
        changed = True
    if requester_name and link.requester_display_name != requester_name:
        link.requester_display_name = requester_name
        changed = True
    if provider_name and link.provider_display_name != provider_name:
        link.provider_display_name = provider_name
        changed = True
    if changed:
        link.version = int(link.version) + 1
        link.updated_by = actor
        link.updated_at = _now()
        db.flush()
    return link
