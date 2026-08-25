# =============================================================================
# HERMES — Ticket bakim isi (CronJob girisi)
# =============================================================================
#   python -m app.jobs.ticket_maintenance
#
# Uc is, hepsi DAR kapsamli:
#   1) auto-close  — dogrulama penceresi dolmus `resolved` ticket'lari
#                    kapatir (D-007). Baska hicbir durum degismez.
#   2) attachments — suresi dolmus ve HICBIR ticket'a baglanmamis
#                    staging nesnelerini bosaltir. Ticket EKI ASLA
#                    SILINMEZ.
#   3) idempotency — suresi dolmus anahtarlari budar (operasyonel tablo).
#
# Ticket, mesaj, cozum ve audit kayitlari HICBIR kosulda silinmez
# (02 §10: v1 otomatik silme yapmaz).
# =============================================================================

from __future__ import annotations

import json
import logging
import sys

from sqlalchemy import text as sa_text

from ..services import support_tenant as support
from ..services import ticket_attachment_service
from ..services import ticket_idempotency as idem
from ..services import ticket_service

logger = logging.getLogger("hermes.ticket.maintenance")

LOCK_KEY = 8_140_2252


def run_once() -> dict:
    if not support.is_available():
        state, _ = support.module_state()
        return {"ok": True, "status": "skipped", "reason": state}

    with support.support_session() as db:
        acquired = db.execute(
            sa_text("SELECT pg_try_advisory_lock(:k)"), {"k": LOCK_KEY}
        ).scalar()
        if not acquired:
            return {"ok": True, "status": "skipped",
                    "reason": "another_run_in_progress"}
        try:
            closed = ticket_service.auto_close_due_tickets(db)
            expired = ticket_attachment_service.expire_orphaned_uploads(db)
            purged = idem.purge_expired(db)
            return {
                "ok": True, "status": "completed",
                "auto_closed": closed.get("closed", 0),
                "auto_close_window_days": closed.get("window_days"),
                "expired_uploads": expired.get("expired", 0),
                "purged_idempotency_keys": purged,
            }
        finally:
            db.execute(
                sa_text("SELECT pg_advisory_unlock(:k)"), {"k": LOCK_KEY}
            )


def main() -> int:
    try:
        summary = run_once()
    except Exception as exc:  # noqa: BLE001
        logger.error("maintenance failed class=%s", type(exc).__name__)
        print(json.dumps({
            "ok": False, "status": "failed",
            "failure_class": type(exc).__name__,
        }))
        return 1
    print(json.dumps(summary, default=str))
    return 0 if summary.get("ok", False) else 1


if __name__ == "__main__":
    sys.exit(main())
