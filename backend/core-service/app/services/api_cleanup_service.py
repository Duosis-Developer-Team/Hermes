# =============================================================================
# HERMES - Public API retention / cleanup servisi (Stage 3F)
# =============================================================================
# YALNIZCA su iki tablonun yasam dongusunu yonetir (onayli kapsam):
#   - api_request_logs     : created_at < now - 90 gun (default)
#   - api_idempotency_keys : created_at < now - 25 saat (default;
#                            24 saatlik TTL + 1 saat guvenlik payi —
#                            TTL'i dolmus anahtar okuma aninda zaten
#                            yeniden kullanilabilir, temizlik hicbir
#                            otoriter kaydi SILEMEZ)
#
# Guvenlik garantileri:
#   - Tablo adlari SABIT katalogdan gelir (_TARGETS) — is verisi
#     (task/work_log/meeting/customer/...) veya api_clients/api_tokens'a
#     dokunmak YAPISAL olarak imkansizdir; testler bunu kilitler.
#   - Batch delete (default 5000) — tek dev transaction yok; her batch
#     kendi transaction'inda commit edilir. Yarim kalan calisma guvenlidir
#     (idempotent: kalan satirlar sonraki calismada silinir).
#   - pg_try_advisory_lock ile tek-calisan guard: cakisan iki scheduler
#     ornegi ayni anda silme yapamaz; kilidi alamayan "skipped" doner.
#   - Hata ana API'yi ETKILEMEZ: exception yutulur, sonuc kaydina yalnizca
#     hata SINIFI yazilir (SQL/mesaj detayi yok), cagirana ozet doner.
#   - dry_run=True hicbir sey silmez; yalnizca aday satirlari sayar.
# =============================================================================

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import text as sa_text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models.api_client import ApiCleanupRun

logger = logging.getLogger("hermes.api_cleanup")

# Rastgele secilmis sabit uygulama kilidi anahtari (yalnizca bu is icin).
ADVISORY_LOCK_KEY = 815_243_777

# Temizlenebilir tablolarin SABIT katalogu. Buraya tablo eklemek bilincli
# bir urun karari gerektirir (test kilidi: test_stage3f_cleanup).
_TARGETS = ("api_request_logs", "api_idempotency_keys")


@dataclass(frozen=True)
class CleanupSettings:
    enabled: bool
    request_log_retention_days: int
    idempotency_retention_hours: int
    batch_size: int

    @classmethod
    def from_app_settings(cls) -> "CleanupSettings":
        s = get_settings()
        return cls(
            enabled=s.API_CLEANUP_ENABLED,
            request_log_retention_days=s.API_REQUEST_LOG_RETENTION_DAYS,
            idempotency_retention_hours=s.API_IDEMPOTENCY_RETENTION_HOURS,
            batch_size=s.API_CLEANUP_BATCH_SIZE,
        )


def _cutoffs(settings: CleanupSettings, now: datetime) -> dict:
    return {
        "api_request_logs": now
        - timedelta(days=settings.request_log_retention_days),
        "api_idempotency_keys": now
        - timedelta(hours=settings.idempotency_retention_hours),
    }


def _count_candidates(conn, table: str, cutoff: datetime) -> int:
    assert table in _TARGETS
    # Her islem kendi kisa transaction'inda: SQLAlchemy 2.x'te ciplak
    # execute implicit transaction acar ve sonraki begin()'i kirar.
    with conn.begin():
        return conn.execute(
            sa_text(
                f"SELECT count(*) FROM {table} WHERE created_at < :cutoff"
            ),
            {"cutoff": cutoff},
        ).scalar()


def _delete_batch(conn, table: str, cutoff: datetime, limit: int) -> int:
    """Tek batch siler ve HEMEN commit eder (kendi transaction'i)."""
    assert table in _TARGETS
    with conn.begin():
        result = conn.execute(
            sa_text(
                f"DELETE FROM {table} WHERE id IN ("
                f"  SELECT id FROM {table}"
                f"  WHERE created_at < :cutoff LIMIT :lim)"
            ),
            {"cutoff": cutoff, "lim": limit},
        )
        return result.rowcount or 0


def run_cleanup(
    db: Session,
    settings: Optional[CleanupSettings] = None,
    *,
    dry_run: bool = False,
    trigger: str = "manual",
) -> dict:
    """Temizligi calistirir ve sanitize edilmis ozet dondurur. ASLA
    exception firlatmaz (cagiran ana API olabilir)."""
    settings = settings or CleanupSettings.from_app_settings()
    now = datetime.now(timezone.utc)

    if not settings.enabled:
        return {"ok": True, "status": "disabled", "dry_run": dry_run}

    # Batch commit'leri fixture/istek session'inin transaction'ina
    # karismasin diye AYRI baglanti kullanilir. Advisory lock bu
    # baglantinin omrune baglidir (unlock finally'de).
    engine = db.get_bind()
    conn = engine.connect()
    locked = False
    deleted = {t: 0 for t in _TARGETS}
    batches = 0
    status = "success"
    failure_class = None
    try:
        # Session(=baglanti)-seviyesi advisory lock: transaction commit'i
        # kilidi BIRAKMAZ; unlock/baglanti kapanisi birakir. Kisa
        # transaction yalnizca SQLAlchemy 2.x implicit-tx tuzagi icin.
        with conn.begin():
            locked = bool(
                conn.execute(
                    sa_text("SELECT pg_try_advisory_lock(:k)"),
                    {"k": ADVISORY_LOCK_KEY},
                ).scalar()
            )
        if not locked:
            # Baska bir calisan var — o kaydeder, biz sessizce cekiliriz.
            return {
                "ok": True,
                "status": "skipped_already_running",
                "dry_run": dry_run,
            }

        cutoffs = _cutoffs(settings, now)
        try:
            for table in _TARGETS:
                if dry_run:
                    deleted[table] = _count_candidates(
                        conn, table, cutoffs[table]
                    )
                    continue
                while True:
                    n = _delete_batch(
                        conn, table, cutoffs[table], settings.batch_size
                    )
                    if n == 0:
                        break
                    batches += 1
                    deleted[table] += n
        except Exception as exc:  # noqa: BLE001 — ana API'yi koru
            status = "failed"
            failure_class = type(exc).__name__
            # Sanitize log: SQL/parametre/mesaj detayi YOK.
            logger.error(
                "api_cleanup failed class=%s trigger=%s", failure_class,
                trigger,
            )

        completed = datetime.now(timezone.utc)
        _record_run(
            conn,
            started_at=now,
            completed_at=completed,
            dry_run=dry_run,
            trigger=trigger,
            status=status,
            deleted=deleted,
            batches=batches,
            failure_class=failure_class,
        )
        summary = {
            "ok": status == "success",
            "status": status,
            "dry_run": dry_run,
            "started_at": now.isoformat(),
            "completed_at": completed.isoformat(),
            "duration_ms": int((completed - now).total_seconds() * 1000),
            "request_logs_deleted": deleted["api_request_logs"],
            "idempotency_keys_deleted": deleted["api_idempotency_keys"],
            "batches": batches,
            "failure_class": failure_class,
        }
        logger.info(
            "api_cleanup %s trigger=%s dry_run=%s request_logs=%s "
            "idempotency_keys=%s batches=%s duration_ms=%s",
            status,
            trigger,
            dry_run,
            deleted["api_request_logs"],
            deleted["api_idempotency_keys"],
            batches,
            summary["duration_ms"],
        )
        return summary
    except Exception as exc:  # noqa: BLE001 — kilit/kayit hatasi dahil
        logger.error("api_cleanup aborted class=%s", type(exc).__name__)
        return {
            "ok": False,
            "status": "failed",
            "dry_run": dry_run,
            "failure_class": type(exc).__name__,
        }
    finally:
        if locked:
            try:
                with conn.begin():
                    conn.execute(
                        sa_text("SELECT pg_advisory_unlock(:k)"),
                        {"k": ADVISORY_LOCK_KEY},
                    )
            except Exception:  # noqa: BLE001
                pass  # baglanti kapaninca kilit zaten duser
        conn.close()


def _record_run(
    conn,
    *,
    started_at,
    completed_at,
    dry_run,
    trigger,
    status,
    deleted,
    batches,
    failure_class,
) -> None:
    """Sonuc kaydi kendi kisa transaction'inda yazilir (silme hatasi
    kaydi engellemez)."""
    with conn.begin():
        conn.execute(
            ApiCleanupRun.__table__.insert().values(
                started_at=started_at,
                completed_at=completed_at,
                dry_run=dry_run,
                trigger=trigger,
                status=status,
                request_logs_deleted=deleted["api_request_logs"],
                idempotency_keys_deleted=deleted["api_idempotency_keys"],
                batches=batches,
                failure_class=failure_class,
            )
        )


def last_run(db: Session) -> Optional[ApiCleanupRun]:
    return (
        db.query(ApiCleanupRun)
        .order_by(ApiCleanupRun.started_at.desc())
        .first()
    )
