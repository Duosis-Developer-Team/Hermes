"""
=============================================================================
HERMES - Otomatik arsiv (retention) servisi
=============================================================================
Kapanmis (closed_at dolu) logical work item'lari, PM Configurations'taki
politika suresi dolunca Active havuzdan Archive havuzuna alir.

KALICI SILME YOKTUR: yalnizca lifecycle metadata'si yazilir. work_logs
tablosuna hicbir sekilde DOKUNULMAZ.

Mimari, mevcut `api_cleanup_service` deseninin aynisidir:
  - ayri baglanti (istek/fixture session'inin transaction'ina karismaz),
  - session-seviyesi PostgreSQL advisory lock (ikinci esZamanli kosu
    sessizce cekilir),
  - logical item bazinda batch,
  - ASLA exception firlatmaz — ana API'yi etkilemez,
  - sanitize edilmis ozet (baslik, assignee adi, SQL, secret LOGLANMAZ).

BATCH SINIRI LOGICAL GRUBU BOLMEZ: batch, logical anahtarlar uzerinden
alinir; bir grubun satirlari her zaman AYNI transaction'da arsivlenir.
Kismi arsiv olusursa transaction geri alinir.
=============================================================================
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import text as sa_text
from sqlalchemy.orm import Session

from . import task_lifecycle

logger = logging.getLogger(__name__)

#: api_cleanup'takinden FARKLI bir anahtar — iki job birbirini
#: bloklamamali.
ADVISORY_LOCK_KEY = 947_310_281

DEFAULT_BATCH_SIZE = 200

#: Arsiv adayi logical anahtarlar. Kapanis suresi dolmus, HENUZ
#: arsivlenmemis ve grubun HICBIR satiri aktif olmayan gruplar.
#:
#: `updated_at` KULLANILMAZ — runtime kararinin tek girdisi closed_at.
#
# DIKKAT — satir filtresi HAVING'den ONCE uygulanamaz. Ilk yazimda
# `WHERE closed_at IS NOT NULL` vardi; bu, karisik bir grubun HENUZ ACIK
# satirini gruplamadan ONCE eliyor ve grup tamamen terminal gorunuyordu
# (test yakaladi: mixed group arsivleniyordu). Bu yuzden gruplama TUM
# satirlar uzerinden yapilir; kosullar HAVING'de, yani grup duzeyinde
# degerlendirilir.
_CANDIDATE_SQL = """
SELECT COALESCE(assignment_batch_id::text, 'task:' || id::text) AS logical_key
FROM tasks
GROUP BY COALESCE(assignment_batch_id::text, 'task:' || id::text)
HAVING bool_and(status = 'completed')
   AND bool_and(archived_at IS NULL)
   AND bool_and(closed_at IS NOT NULL)
   AND max(closed_at) <= :cutoff
ORDER BY 1
LIMIT :limit
"""

_ARCHIVE_GROUP_SQL = """
UPDATE tasks
SET archived_at = :now,
    archive_reason = 'auto_retention',
    archived_by_user_id = NULL
WHERE COALESCE(assignment_batch_id::text, 'task:' || id::text) = :logical_key
  AND archived_at IS NULL
"""

#: Audit: her arsivlenen satir icin bir olay. Mevcut `task_deleted`
#: terminolojisi YENI islemlerde URETILMEZ; tarihsel olaylar da
#: silinmez/yeniden yazilmaz.
# WS5: `tenant_id` tasinir. Kolon NOT NULL oldugu icin eksikligi
# INSERT'i patlatirdi — ve bu, arsivin sessizce "partial_failure"
# donmesi demekti (hicbir satir arsivlenmez, hicbir istisna yukselmez).
# Tenant, ARSIVLENEN SATIRDAN alinir; boylece audit olayi her zaman
# kaynak satirla ayni tenant'a duser.
_AUDIT_SQL = """
INSERT INTO task_activity_events (id, tenant_id, task_id, actor_user_id,
                                  event_type, event_data, created_at)
SELECT gen_random_uuid(), tenant_id, id, NULL, 'task_archived_auto',
       jsonb_build_object('reason', 'auto_retention'), :now
FROM tasks
WHERE COALESCE(assignment_batch_id::text, 'task:' || id::text) = :logical_key
  AND archived_at = :now
"""


def run_auto_archive(
    db: Session,
    *,
    dry_run: bool = False,
    batch_size: int = DEFAULT_BATCH_SIZE,
    now: Optional[datetime] = None,
) -> dict:
    """Otomatik arsivi calistirir ve sanitize ozet dondurur.

    ASLA exception firlatmaz.
    """
    started = datetime.now(timezone.utc)
    now = now or started

    policy = task_lifecycle.get_policy(db)
    db.commit()
    cutoff = task_lifecycle.retention_cutoff(policy, now)

    base = {
        "ok": True,
        "dry_run": dry_run,
        "policy_days": policy.retention_days,
        "logical_items_scanned": 0,
        "logical_items_archived": 0,
        "assignment_rows_updated": 0,
        "batches": 0,
    }

    if cutoff is None:
        # "Never" — otomatik arsiv KAPALI. Basarili ve acik sonuc.
        base.update(status="disabled", duration_ms=_ms(started))
        return base

    engine = db.get_bind()
    conn = engine.connect()
    locked = False
    scanned = archived_groups = rows_updated = batches = 0
    status = "success"
    try:
        with conn.begin():
            locked = bool(
                conn.execute(
                    sa_text("SELECT pg_try_advisory_lock(:k)"),
                    {"k": ADVISORY_LOCK_KEY},
                ).scalar()
            )
        if not locked:
            # Baska bir kosu var — sessizce cekiliriz (CronJob
            # concurrencyPolicy: Forbid ile birlikte ikinci savunma).
            base.update(status="skipped_already_running",
                        duration_ms=_ms(started))
            return base

        while True:
            with conn.begin():
                keys = [
                    r[0]
                    for r in conn.execute(
                        sa_text(_CANDIDATE_SQL),
                        {"cutoff": cutoff, "limit": batch_size},
                    ).fetchall()
                ]
            if not keys:
                break
            scanned += len(keys)
            batches += 1

            if dry_run:
                # HICBIR satir degistirilmez.
                archived_groups += len(keys)
                if batches * batch_size >= scanned + batch_size:
                    break
                # Dry-run'da ayni adaylar tekrar gelir; tek tur yeter.
                break

            for key in keys:
                # Bir logical grup TEK transaction'da arsivlenir; hata
                # olursa o grup icin kismi degisiklik geri alinir.
                try:
                    with conn.begin():
                        n = conn.execute(
                            sa_text(_ARCHIVE_GROUP_SQL),
                            {"now": now, "logical_key": key},
                        ).rowcount
                        conn.execute(
                            sa_text(_AUDIT_SQL),
                            {"now": now, "logical_key": key},
                        )
                    if n:
                        archived_groups += 1
                        rows_updated += n
                except Exception as exc:  # noqa: BLE001
                    status = "partial_failure"
                    logger.error(
                        "task_auto_archive group failed class=%s",
                        type(exc).__name__,
                    )
            if len(keys) < batch_size:
                break
    except Exception as exc:  # noqa: BLE001 — ana API'yi koru
        status = "failed"
        logger.error("task_auto_archive failed class=%s", type(exc).__name__)
    finally:
        if locked:
            try:
                with conn.begin():
                    conn.execute(
                        sa_text("SELECT pg_advisory_unlock(:k)"),
                        {"k": ADVISORY_LOCK_KEY},
                    )
            except Exception:  # noqa: BLE001
                pass
        conn.close()

    base.update(
        ok=status in ("success", "skipped_already_running", "disabled"),
        status=status,
        logical_items_scanned=scanned,
        logical_items_archived=archived_groups,
        assignment_rows_updated=rows_updated,
        batches=batches,
        duration_ms=_ms(started),
    )
    return base


def _ms(started: datetime) -> int:
    return int(
        (datetime.now(timezone.utc) - started).total_seconds() * 1000
    )
