"""
=============================================================================
HERMES - Otomatik arsiv (retention) servisi
=============================================================================
Kapanmis (closed_at dolu) is kalemlerini, PM Configurations'taki politika
suresi dolunca Active havuzdan Archive havuzuna alir.

PM rework P1.2: is kalemi = `work_items` satiri (eski `tasks` fan-out'u
tek satira indi; katilimcilar `work_item_participants`). Grup butunlugu
artik yapisal: bir is kaleminin "yarisi" arsivlenemez.

KALICI SILME YOKTUR: yalnizca lifecycle metadata'si yazilir. work_logs
tablosuna hicbir sekilde DOKUNULMAZ.

Mimari, mevcut `api_cleanup_service` deseninin aynisidir:
  - ayri baglanti (istek/fixture session'inin transaction'ina karismaz),
  - session-seviyesi PostgreSQL advisory lock (ikinci esZamanli kosu
    sessizce cekilir),
  - is kalemi bazinda batch,
  - ASLA exception firlatmaz — ana API'yi etkilemez,
  - sanitize edilmis ozet (baslik, kisi adi, SQL, secret LOGLANMAZ).
=============================================================================
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import text as sa_text
from sqlalchemy.orm import Session

from . import task_lifecycle
from .work_item_service import TERMINAL_CATEGORIES

logger = logging.getLogger(__name__)

#: api_cleanup'takinden FARKLI bir anahtar — iki job birbirini
#: bloklamamali.
ADVISORY_LOCK_KEY = 947_310_281

DEFAULT_BATCH_SIZE = 200

#: Arsiv adayi is kalemleri: durumu terminal kategoride, kapanis suresi
#: dolmus ve HENUZ arsivlenmemis olanlar.
#:
#: `updated_at` KULLANILMAZ — runtime kararinin tek girdisi closed_at.
#: Kapanis (closed_at) `work_item_service.recompute_closure` ile
#: katilimci durumlarindan turetilir; karisik (bir katilimcisi acik)
#: kalem hicbir zaman terminal kategoriye dusmez, dolayisiyla aday olmaz.
_CANDIDATE_SQL = """
SELECT w.id
FROM work_items w
JOIN workflow_states s ON s.id = w.state_id
WHERE (:tenant_id IS NULL OR w.tenant_id = CAST(:tenant_id AS uuid))
  AND s.category = ANY(:categories)
  AND w.archived_at IS NULL
  AND w.closed_at IS NOT NULL
  AND w.closed_at <= :cutoff
ORDER BY w.closed_at, w.id
LIMIT :limit
"""

_ARCHIVE_ITEM_SQL = """
UPDATE work_items
SET archived_at = :now,
    archive_reason = 'auto_retention',
    archived_by_user_id = NULL
WHERE id = CAST(:item_id AS uuid)
  AND archived_at IS NULL
  AND (:tenant_id IS NULL OR tenant_id = CAST(:tenant_id AS uuid))
"""

#: Audit: arsivlenen her is kalemi icin bir olay. Mevcut `task_deleted`
#: terminolojisi YENI islemlerde URETILMEZ; tarihsel olaylar da
#: silinmez/yeniden yazilmaz. `tenant_id` ARSIVLENEN SATIRDAN alinir;
#: `sequence` kalem icindeki son olayin bir fazlasidir (record_event ile
#: ayni kural).
_AUDIT_SQL = """
INSERT INTO work_item_events (id, tenant_id, work_item_id, actor_user_id,
                              event_type, event_data, sequence, created_at)
SELECT gen_random_uuid(), w.tenant_id, w.id, NULL, 'task_archived_auto',
       jsonb_build_object('reason', 'auto_retention'),
       COALESCE((SELECT MAX(e.sequence) FROM work_item_events e
                 WHERE e.work_item_id = w.id), 0) + 1,
       :now
FROM work_items w
WHERE w.id = CAST(:item_id AS uuid)
  AND w.archived_at = :now
  AND (:tenant_id IS NULL OR w.tenant_id = CAST(:tenant_id AS uuid))
"""


def run_auto_archive(
    db: Session,
    *,
    tenant_id=None,
    dry_run: bool = False,
    batch_size: int = DEFAULT_BATCH_SIZE,
    now: Optional[datetime] = None,
) -> dict:
    """Otomatik arsivi calistirir ve sanitize ozet dondurur.

    ASLA exception firlatmaz.

    WS7: `tenant_id` verildiginde is O TENANT ile sinirlidir — aday
    secimi, arsivleme ve audit yazimi acikca tenant'a baglanir. Job
    yolu her zaman verir (bkz. app/jobs/tenant_runner.py); verilmezse
    cagiranin session'indaki tenant baglami (RLS) sinirlar.

    Ozet anahtarlari job cikti sozlesmesidir (degismez):
    `assignment_rows_updated` artik guncellenen is kalemi satiri
    sayisidir (P1.2 oncesi: fan-out satiri sayisi).
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
    # WS7: is KENDI baglantisinda kosar; tenant baglami o baglantida da
    # kurulmalidir. Aksi halde RLS altinda aday sorgusu sifir satir
    # gorur ve is sessizce "hicbir sey yapilmadi" doner.
    if tenant_id is not None:
        with conn.begin():
            conn.execute(
                sa_text("SELECT set_config('app.tenant_id', :t, false)"),
                {"t": str(tenant_id)},
            )
    tenant_param = str(tenant_id) if tenant_id else None
    categories = sorted(TERMINAL_CATEGORIES)
    locked = False
    scanned = archived_items = rows_updated = batches = 0
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
                ids = [
                    r[0]
                    for r in conn.execute(
                        sa_text(_CANDIDATE_SQL),
                        {"cutoff": cutoff, "limit": batch_size,
                         "tenant_id": tenant_param,
                         "categories": categories},
                    ).fetchall()
                ]
            if not ids:
                break
            scanned += len(ids)
            batches += 1

            if dry_run:
                # HICBIR satir degistirilmez. Dry-run'da ayni adaylar
                # tekrar gelir; tek tur yeter.
                archived_items += len(ids)
                break

            for item_id in ids:
                # Bir is kalemi TEK transaction'da arsivlenir; hata
                # olursa o kalem icin kismi degisiklik geri alinir.
                try:
                    with conn.begin():
                        n = conn.execute(
                            sa_text(_ARCHIVE_ITEM_SQL),
                            {"now": now, "item_id": str(item_id),
                             "tenant_id": tenant_param},
                        ).rowcount
                        conn.execute(
                            sa_text(_AUDIT_SQL),
                            {"now": now, "item_id": str(item_id),
                             "tenant_id": tenant_param},
                        )
                    if n:
                        archived_items += 1
                        rows_updated += n
                except Exception as exc:  # noqa: BLE001
                    status = "partial_failure"
                    logger.error(
                        "task_auto_archive item failed class=%s",
                        type(exc).__name__,
                    )
            if len(ids) < batch_size:
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
        logical_items_archived=archived_items,
        assignment_rows_updated=rows_updated,
        batches=batches,
        duration_ms=_ms(started),
    )
    return base


def _ms(started: datetime) -> int:
    return int(
        (datetime.now(timezone.utc) - started).total_seconds() * 1000
    )
