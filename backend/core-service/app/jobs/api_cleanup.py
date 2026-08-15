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

from ..services.api_cleanup_service import run_cleanup
from .tenant_runner import run_for_each_tenant


def main() -> int:
    """WS5/WS7: temizlik artik TENANT BASINA kosar.

    Onceden tek bir global tarama vardi; RLS altinda bu ya sifir satir
    gorurdu ya da bir tenant'in penceresi baskasinin kayitlarini
    silerdi. Kosucu aktif tenant'lari dolasir, her biri icin
    transaction-local baglam kurar ve hatalari BAGIMSIZ raporlar.
    """
    dry_run = "--dry-run" in sys.argv[1:]
    summary = run_for_each_tenant(
        "api_cleanup", run_cleanup, dry_run=dry_run, trigger="cron"
    )
    print(json.dumps(summary, default=str))
    # Herhangi bir tenant gercek hata verdiyse exit 1.
    return 0 if summary.get("ok", False) else 1


if __name__ == "__main__":
    sys.exit(main())
