# =============================================================================
# HERMES - Uygulama ici bildirim temizligi (PM rework P2.2)
# =============================================================================
# K8s CronJob'i ayni core-service image'iyla calistirir:
#
#   python -m app.jobs.notification_cleanup [--dry-run]
#
# OKUNMUS ve 90 gunden eski bildirimleri siler; okunmamislara ve is
# verisine dokunmaz. api_cleanup'in donmus katalogundan AYRI bir job
# (09 §3). Tenant basina kosar (tenant_runner), exit 0/1.
# =============================================================================
import json
import sys

from ..services.notification_service import purge_read
from .tenant_runner import run_for_each_tenant


def main() -> int:
    dry_run = "--dry-run" in sys.argv[1:]
    summary = run_for_each_tenant(
        "notification_cleanup", purge_read, dry_run=dry_run, trigger="cron"
    )
    print(json.dumps(summary, default=str))
    return 0 if summary.get("ok", False) else 1


if __name__ == "__main__":
    sys.exit(main())
