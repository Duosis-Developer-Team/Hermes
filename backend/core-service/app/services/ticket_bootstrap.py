# =============================================================================
# HERMES core — Ticket modulu startup dogrulamasi + idempotent seed
# =============================================================================
# Blueprint §6: "Startup validation support tenant'in active oldugunu ve
# core projection'in bulundugunu dogrular. Yanlis ID ile baska tenant'ta
# ticket olusturulmasina izin verilmez."
#
# Iki adim:
#   1) DOGRULAMA — support tenant yapilandirilmis, projeksiyonda var ve
#      calistirilabilir mi? Degilse modul KAPALI kalir (fail-closed);
#      servis yine acilir, diger moduller etkilenmez.
#   2) SEED — `hermes` (kendi portalimiz) application kaydi IDEMPOTENT
#      upsert edilir. Var olan bir kaydin operatorce ayarlanmis
#      alanlari (callback, ad, durum) EZILMEZ.
#
# `logislot` gibi dis uygulamalar BURADA seed EDILMEZ: onboarding
# bilincli bir yonetim islemidir (callback URL, imza anahtari,
# credential ve route ile birlikte). Bos bir kayit yaratmak, "yapilandi"
# gorunen ama calismayan bir entegrasyon uretirdi.
# =============================================================================

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from ..config import get_settings
from . import support_tenant as support
from . import ticket_routing

logger = logging.getLogger("hermes.support")


def run_startup(db: Session) -> dict:
    """Startup'ta cagrilir. HICBIR kosulda exception SIZDIRMAZ."""
    settings = get_settings()
    if not settings.SUPPORT_TICKETS_ENABLED:
        support._force_state_for_tests("disabled")
        return {"state": "disabled", "seeded": False}

    try:
        state, detail = support.verify_support_tenant(db)
    except Exception as exc:  # noqa: BLE001 — startup'i asla dusurme
        logger.error(
            "support tenant verification failed class=%s",
            type(exc).__name__,
        )
        return {"state": "unverified", "seeded": False}

    if state != "ok":
        return {"state": state, "detail": detail, "seeded": False}

    seeded = False
    try:
        with support.support_session() as support_db:
            app = ticket_routing.ensure_application(
                support_db,
                code=settings.SUPPORT_HERMES_APPLICATION_CODE,
                display_name="Hermes",
                description=(
                    "Support requests raised from Hermes workspaces."
                ),
            )
            seeded = app is not None
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "support application seed failed class=%s",
            type(exc).__name__,
        )
        return {"state": state, "seeded": False}

    return {"state": state, "seeded": seeded}
