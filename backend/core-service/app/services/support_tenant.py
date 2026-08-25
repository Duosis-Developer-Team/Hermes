# =============================================================================
# HERMES core — Duosis support tenant sinirinin TEK gecidi
# =============================================================================
# Canonical ticket'lar HER ZAMAN Duosis support tenant'ina yazilir; ama
# ticket'i acan kullanici baska bir tenant'ta (veya baska bir uruncte)
# olabilir. Bu, FORCE RLS altinda ozel bir gecis gerektirir.
#
# GECIS DAR TUTULUR (03 §6 / 00 §4):
#   - genel bir `bypass_rls` YOKTUR; burada yalnizca "support tenant'i
#     baglaminda bir oturum ac" vardir ve tenant kimligi ISTEKTEN DEGIL
#     SUNUCU KONFIGURASYONUNDAN gelir;
#   - konfigurasyon yoksa/gecersizse modul KAPALIDIR (fail-closed) —
#     "tenant yok" ASLA "tum tenant'lar" diye yorumlanmaz;
#   - startup dogrulamasi, yanlis bir UUID ile BASKA bir tenant'ta
#     ticket acilmasini engeller.
#
# Servisin geri kalani tenant_id'yi ELLE tasimaz; her zaman bu moduldeki
# `support_session()` uzerinden calisir.
# =============================================================================

from __future__ import annotations

import logging
import uuid
from contextlib import contextmanager
from typing import Optional, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..tenant_db import TenantSession

logger = logging.getLogger("hermes.support")

# Modul saglik durumu — startup dogrulamasindan sonra doldurulur.
# ("ok" | "not_configured" | "invalid_uuid" | "unknown_tenant" |
#  "inactive_tenant" | "unverified")
_state: str = "unverified"
_state_detail: Optional[str] = None

RUNNABLE_TENANT_STATUSES = ("active", "grace")


class SupportNotConfigured(RuntimeError):
    """Support tenant'i yapilandirilmamis/dogrulanmamis."""

    def __init__(self, reason: str = "not_configured"):
        self.reason = reason
        super().__init__(
            "The support ticket module is not configured on this "
            f"deployment ({reason})."
        )


def support_tenant_id() -> Optional[str]:
    """Yapilandirilmis support tenant UUID'si (normalize edilmis).

    Bicimi bozuk bir deger `None` doner: yanlis bir string'i tenant
    baglamina yazmak, RLS altinda sifir satir gormek demektir — ama daha
    kotusu, GECERLI ama YANLIS bir UUID baska bir tenant'a yazmak
    demektir. Bu yuzden dogrulama startup'ta yapilir.
    """
    raw = (get_settings().HERMES_SUPPORT_TENANT_ID or "").strip()
    if not raw:
        return None
    try:
        return str(uuid.UUID(raw))
    except (ValueError, AttributeError, TypeError):
        return None


def is_support_tenant(tenant_id) -> bool:
    """Verilen tenant, Duosis support tenant'i mi?

    Bu TEK ayrim, kullanicinin hangi yuzeyi gordugunu belirler: support
    tenant'inda agent hub'i, diger tenant'larda musteri portali. Izinler
    "ne yapabilir"i soyler; yuzeyi tenant belirler.
    """
    configured = support_tenant_id()
    if not configured or not tenant_id:
        return False
    try:
        return str(uuid.UUID(str(tenant_id))) == configured
    except (ValueError, AttributeError, TypeError):
        return False


def module_state() -> Tuple[str, Optional[str]]:
    return _state, _state_detail


def is_available() -> bool:
    return _state == "ok"


def require_available() -> str:
    """Yapilandirilmis ve dogrulanmis tenant kimligini doner."""
    if not get_settings().SUPPORT_TICKETS_ENABLED:
        raise SupportNotConfigured("disabled")
    if _state != "ok":
        raise SupportNotConfigured(_state)
    tenant = support_tenant_id()
    if not tenant:  # pragma: no cover — _state 'ok' ise dolu olmali
        raise SupportNotConfigured("not_configured")
    return tenant


def verify_support_tenant(db: Session) -> Tuple[str, Optional[str]]:
    """Startup dogrulamasi: tenant VAR MI ve CALISTIRILABILIR MI?

    Kaynak `tenant_registry` projeksiyonudur (auth'a senkron cagri YOK —
    modulun acilmasi kontrol duzleminin ayakta olmasina bagli olmamali).

    Servisi COKERTMEZ: modul kapali kalir, diger moduller etkilenmez.
    Sessiz de kalmaz — ERROR loglar ve `/tickets/admin/health` bunu
    gosterir.
    """
    global _state, _state_detail
    settings = get_settings()

    if not settings.SUPPORT_TICKETS_ENABLED:
        _state, _state_detail = "disabled", None
        return _state, _state_detail

    raw = (settings.HERMES_SUPPORT_TENANT_ID or "").strip()
    if not raw:
        _state, _state_detail = "not_configured", None
        logger.warning(
            "support module disabled: HERMES_SUPPORT_TENANT_ID is empty"
        )
        return _state, _state_detail

    tenant = support_tenant_id()
    if tenant is None:
        _state, _state_detail = "invalid_uuid", None
        logger.error(
            "support module disabled: HERMES_SUPPORT_TENANT_ID is not a "
            "valid UUID"
        )
        return _state, _state_detail

    row = db.execute(
        text(
            "SELECT status FROM tenant_registry "
            " WHERE tenant_id = CAST(:t AS uuid)"
        ),
        {"t": tenant},
    ).first()

    if row is None:
        _state, _state_detail = "unknown_tenant", None
        logger.error(
            "support module disabled: configured support tenant is not "
            "present in the core tenant projection"
        )
        return _state, _state_detail

    if row[0] not in RUNNABLE_TENANT_STATUSES:
        _state, _state_detail = "inactive_tenant", str(row[0])
        logger.error(
            "support module disabled: support tenant status=%s", row[0]
        )
        return _state, _state_detail

    _state, _state_detail = "ok", None
    logger.info("support module ready")
    return _state, _state_detail


def _force_state_for_tests(state: str, detail: Optional[str] = None) -> None:
    """YALNIZCA testler icin: dogrulama durumunu elle ayarlar."""
    global _state, _state_detail
    _state, _state_detail = state, detail


@contextmanager
def support_session():
    """Support tenant baglaminda transaction-local bir oturum.

    Bu, canonical ticket verisine ulasan TEK yoldur. `TenantSession`
    tenant'siz acilmayi zaten reddeder; buradaki ek kural, tenant
    degerinin YALNIZCA dogrulanmis sunucu konfigurasyonundan
    gelebilmesidir.
    """
    tenant = require_available()
    with TenantSession(tenant) as db:
        yield db
