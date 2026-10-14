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
#   4) e-posta     — sonuclanmis e-posta kuyrugu (30 gun) ve gelen ileti
#                    kaydi (90 gun) budanir (operasyonel tablolar).
#
# Ticket, mesaj, cozum ve audit kayitlari HICBIR kosulda silinmez
# (02 §10: v1 otomatik silme yapmaz).
#
# Talep agi: isler HER SAGLAYICIDA kosar (yapilandirilmis destek tenant'i
# + baglantilarin saglayici ucu). Modulu kapali/askidaki saglayici
# atlanir (gecit acilmaz) ve sayilir.
# =============================================================================

from __future__ import annotations

import json
import logging
import sys

from sqlalchemy import text as sa_text

from ..services import support_tenant as support
from ..services import ticket_attachment_service
from ..services import ticket_idempotency as idem
from ..services import ticket_automation
from ..services import ticket_mail
from ..services import ticket_service

logger = logging.getLogger("hermes.ticket.maintenance")

LOCK_KEY = 8_140_2252


def provider_ids() -> list:
    """Bakim gereken saglayicilar — destek tenant'i ONCE, sonra baglantilar."""
    ids = [support.support_tenant_id()]
    with support.global_session() as gdb:
        rows = gdb.execute(sa_text(
            "SELECT DISTINCT provider_tenant_id FROM ticket_network_links"
        )).all()
    ids.extend(str(r[0]) for r in rows)
    seen, out = set(), []
    for tid in ids:
        if tid and tid not in seen:
            seen.add(tid)
            out.append(tid)
    return out


def _maintain(db) -> dict:
    # Zamanli otomasyonlar (Dalga D2) otomatik kapatmadan ONCE: "7 gun yanit
    # yoksa coz" gibi kurallar ayni turda sonuc versin.
    automations = ticket_automation.run_schedules(db)
    closed = ticket_service.auto_close_due_tickets(db)
    expired = ticket_attachment_service.expire_orphaned_uploads(db)
    purged = idem.purge_expired(db)
    # E-posta kuyrugu operasyoneldir (talep kaydi degil): sonuclanmis
    # satirlar 30 gun, gelen ileti kaydi 90 gun tutulur.
    mail_purged = ticket_mail.purge_finished(db)
    inbound_purged = ticket_mail.purge_inbound_log(db)
    return {
        "auto_closed": closed.get("closed", 0),
        "auto_close_window_days": closed.get("window_days"),
        "expired_uploads": expired.get("expired", 0),
        "purged_idempotency_keys": purged,
        "automations_applied": automations["applied"],
        "automation_errors": automations["errors"],
        "purged_mail": mail_purged + inbound_purged,
    }


def run_once() -> dict:
    # Bu AYRI bir surectir: API'nin startup dogrulamasi burada
    # KOSMAMISTIR. Once dogrula, sonra karar ver — aksi halde is her
    # seferinde sessizce "skipped" olur.
    support.ensure_verified()
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
            summary = {
                "ok": True, "status": "completed", "providers": 0,
                "providers_skipped": 0, "auto_closed": 0,
                "auto_close_window_days": None, "expired_uploads": 0,
                "purged_idempotency_keys": 0, "automations_applied": 0,
                "automation_errors": 0, "purged_mail": 0,
            }
            for tenant_id in provider_ids():
                try:
                    with support.provider_session(tenant_id) as pdb:
                        part = _maintain(pdb)
                except support.SupportNotConfigured:
                    summary["providers_skipped"] += 1
                    continue
                summary["providers"] += 1
                for key in ("auto_closed", "expired_uploads",
                            "purged_idempotency_keys", "automations_applied",
                            "automation_errors", "purged_mail"):
                    summary[key] += int(part[key] or 0)
                summary["auto_close_window_days"] = part["auto_close_window_days"]
            return summary
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
