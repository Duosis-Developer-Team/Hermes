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

from ..services.task_archive_service import run_auto_archive
from .tenant_runner import run_for_each_tenant


def main() -> int:
    """WS7: arsiv artik TENANT BASINA kosar.

    Onceden tek bir global tarama vardi. Cok-tenantli dunyada bu iki
    turlu de yanlisti: RLS altinda tenant baglamsiz tarama sifir satir
    gorur (is sessizce hicbir sey yapmaz), baglam kurulsa bile bir
    tenant'in saklama politikasi baska bir tenant'in kayitlarini
    arsivlerdi. Saklama suresi tenant'a ozgu bir ayardir.
    """
    dry_run = "--dry-run" in sys.argv[1:]
    summary = run_for_each_tenant(
        "task_auto_archive", run_auto_archive, dry_run=dry_run
    )
    print(json.dumps(summary, default=str))
    return 0 if summary.get("ok", False) else 1


if __name__ == "__main__":
    sys.exit(main())
