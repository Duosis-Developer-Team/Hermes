# =============================================================================
# HERMES - API cleanup CronJob girisi (Stage 3F)
# =============================================================================
# K8s CronJob'i ayni core-service image'iyla calistirir:
#
#   python -m app.jobs.api_cleanup [--dry-run]
#
# Cikis kodu: 0 = success/skipped/disabled, 1 = failed. Ozet stdout'a
# JSON olarak yazilir (sanitize — SQL/veri detayi yok). Ana API surecinden
# tamamen bagimsizdir; hata API'yi etkileyemez.
# =============================================================================

import json
import sys

from ..database import SessionLocal
from ..services.api_cleanup_service import run_cleanup


def main() -> int:
    dry_run = "--dry-run" in sys.argv[1:]
    db = SessionLocal()
    try:
        summary = run_cleanup(db, dry_run=dry_run, trigger="cron")
    finally:
        db.close()
    print(json.dumps(summary, default=str))
    # ok=false (gercek calisma hatasi) → exit 1; success/skip/disabled → 0.
    return 0 if summary.get("ok", False) else 1


if __name__ == "__main__":
    sys.exit(main())
