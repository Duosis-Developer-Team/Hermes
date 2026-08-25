# =============================================================================
# HERMES — Giden ticket event dispatcher'i (CronJob girisi)
# =============================================================================
#   python -m app.jobs.ticket_dispatcher [--once]
#
# Cikis kodu: 0 = basarili/atlandi, 1 = hata. Ozet stdout'a JSON olarak
# yazilir (sanitize — payload/ticket icerigi YOK).
#
# TEK-CALISAN: `pg_try_advisory_lock`. Iki dispatcher ayni anda kosarsa
# `FOR UPDATE SKIP LOCKED` zaten ayni satiri iki kez islemez; advisory
# lock, gereksiz baglanti/HTTP yukunu de onler ve "kim calisiyor"
# sorusunu netlestirir.
#
# Ana API surecinden BAGIMSIZ: burada olusan bir hata API pod'unu
# etkilemez (Blueprint §5).
# =============================================================================

from __future__ import annotations

import json
import logging
import sys

from sqlalchemy import text as sa_text

from ..services import support_tenant as support
from ..services import ticket_delivery_service as delivery

logger = logging.getLogger("hermes.ticket.dispatcher")

# Bu ise ozgu sabit advisory lock anahtari.
LOCK_KEY = 8_140_2251


def run_once() -> dict:
    if not support.is_available():
        # Modul yapilandirilmamis: is YOKTUR, HATA da yoktur.
        state, _ = support.module_state()
        return {"ok": True, "status": "skipped", "reason": state}

    with support.support_session() as db:
        acquired = db.execute(
            sa_text("SELECT pg_try_advisory_lock(:k)"), {"k": LOCK_KEY}
        ).scalar()
        if not acquired:
            return {"ok": True, "status": "skipped",
                    "reason": "another_dispatcher_running"}
        try:
            # Cokmus bir kosunun birakligi `in_flight` satirlari once
            # kurtar: aksi halde o olaylar sessizce hic gonderilmez.
            reclaimed = delivery.reclaim_stuck(db)
            summary = delivery.dispatch_pending(db)
            summary["reclaimed"] = reclaimed
            summary["status"] = "completed"
            return summary
        finally:
            db.execute(
                sa_text("SELECT pg_advisory_unlock(:k)"), {"k": LOCK_KEY}
            )


def main() -> int:
    try:
        summary = run_once()
    except Exception as exc:  # noqa: BLE001 — sanitize edilmis rapor
        logger.error("dispatcher failed class=%s", type(exc).__name__)
        print(json.dumps({
            "ok": False, "status": "failed",
            "failure_class": type(exc).__name__,
        }))
        return 1
    print(json.dumps(summary, default=str))
    return 0 if summary.get("ok", False) else 1


if __name__ == "__main__":
    sys.exit(main())
