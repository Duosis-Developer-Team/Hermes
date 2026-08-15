# =============================================================================
# HERMES core-service — Tenant is kosucusu (WS5/WS7)
# =============================================================================
# Cok-tenantli dunyada hicbir arka plan isi "tum tablolari tara" DIYEMEZ:
#
#   - RLS altinda tenant baglami olmayan bir tarama SIFIR satir gorur
#     (yani is sessizce hicbir sey yapmaz — en kotu basarisizlik bicimi);
#   - baglam kurulsa bile tek bir tenant'in penceresi baska bir tenant'in
#     kayitlarini silebilir/degistirebilirdi.
#
# Bu modul tek dogru deseni saglar: aktif tenant'lari SIRAYLA dolas, her
# biri icin AYRI bir transaction-local baglam kur, isi calistir, sonucu
# BAGIMSIZ raporla. Bir tenant'in hatasi digerlerini ATLATMAZ
# (09_API_MCP_REPORTING_JOBS §6).
# =============================================================================

from __future__ import annotations

import logging
from typing import Callable, Dict, List

from sqlalchemy import text

from ..database import SessionLocal
from ..tenant_db import bind_tenant

logger = logging.getLogger("hermes.jobs")

# Isin calisacagi tenant durumlari. Askiya alinmis/arsivlenmis tenant'ta
# normal isler CALISMAZ (08_TENANT_PROVISIONING §6).
RUNNABLE_STATUSES = ("active", "grace")


def active_tenant_ids() -> List[str]:
    """Core projeksiyonundan calistirilabilir tenant kimlikleri.

    Kaynak `tenant_registry`'dir; auth'a senkron cagri YAPILMAZ (job'in
    calismasi kontrol duzleminin ayakta olmasina bagli olmamali).
    """
    db = SessionLocal()
    try:
        rows = db.execute(text(
            "SELECT tenant_id FROM tenant_registry "
            "WHERE status = ANY(:statuses) ORDER BY provisioned_at"
        ), {"statuses": list(RUNNABLE_STATUSES)}).scalars().all()
        return [str(r) for r in rows]
    finally:
        db.close()


def run_for_each_tenant(
    job_name: str,
    work: Callable[..., dict],
    **kwargs,
) -> Dict[str, object]:
    """`work(db, tenant_id=...)` fonksiyonunu her tenant icin kosar.

    Args:
        job_name: log/ozet etiketi (tenant ADI ASLA loglanmaz).
        work: `(db, *, tenant_id, **kwargs) -> dict` imzali is.

    Returns:
        Toplam ozet: tenant sayisi, basarili/basarisiz sayilari ve
        tenant basina sanitize sonuclar.

    Bir tenant'in hatasi yakalanir ve DIGERLERI kosmaya devam eder;
    aksi halde tek bozuk tenant tum kurulumun bakimini durdururdu.
    """
    tenant_ids = active_tenant_ids()
    results: Dict[str, object] = {}
    succeeded = failed = 0

    for tenant_id in tenant_ids:
        db = SessionLocal()
        try:
            # Her tenant KENDI transaction-local baglaminda calisir.
            bind_tenant(db, tenant_id)
            summary = work(db, tenant_id=tenant_id, **kwargs)
            db.commit()
            results[tenant_id] = summary
            if summary.get("ok", True):
                succeeded += 1
            else:
                failed += 1
        except Exception as exc:  # noqa: BLE001 — bir tenant digerini durduramaz
            db.rollback()
            failed += 1
            # Sanitize: yalnizca hata SINIFI. Tenant is verisi loglanmaz.
            results[tenant_id] = {
                "ok": False,
                "status": "failed",
                "failure_class": type(exc).__name__,
            }
            logger.error(
                "%s tenant basarisiz class=%s", job_name,
                type(exc).__name__,
            )
        finally:
            db.close()

    logger.info(
        "%s tamam: tenants=%d ok=%d failed=%d",
        job_name, len(tenant_ids), succeeded, failed,
    )
    return {
        "job": job_name,
        "tenants": len(tenant_ids),
        "succeeded": succeeded,
        "failed": failed,
        "ok": failed == 0,
        "results": results,
    }
