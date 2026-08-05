# =============================================================================
# HERMES - Work item otomatik arsiv CronJob girisi
# =============================================================================
# K8s CronJob'i ayni core-service image'iyla calistirir:
#
#   python -m app.jobs.task_auto_archive [--dry-run]
#
# Cikis kodu: 0 = success/skipped/disabled, 1 = failed. Ozet stdout'a
# JSON olarak yazilir (sanitize — baslik, assignee adi, SQL, secret YOK).
# Ana API surecinden tamamen bagimsizdir; hata API'yi etkileyemez.
#
# KALICI SILME YAPMAZ: yalnizca lifecycle metadata'si yazar. work_logs
# tablosuna DOKUNMAZ.
# =============================================================================

import json
import sys

from ..database import SessionLocal
from ..services.task_archive_service import run_auto_archive


def main() -> int:
    dry_run = "--dry-run" in sys.argv[1:]
    db = SessionLocal()
    try:
        summary = run_auto_archive(db, dry_run=dry_run)
    finally:
        db.close()
    print(json.dumps(summary, default=str))
    return 0 if summary.get("ok", False) else 1


if __name__ == "__main__":
    sys.exit(main())
