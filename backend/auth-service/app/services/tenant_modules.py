# =============================================================================
# HERMES auth — Tenant modulleri (okuma + guncelleme + core'a yansima)
# =============================================================================
# Katalog: shared/modules.py. Bu modul auth'un TEK okuma/yazma noktasidir:
#   - `enabled_modules(db, tenant_id)` efektif izin hesabinda kullanilir
#     (rbac_service) — kapali modulun izni rol uzerinden sizamaz.
#   - `set_modules(...)` Platform Admin'den gelir: dogrular, yazar, surumu
#     artirir; projeksiyon (core tenant_registry) cagiranin isidir.
# Okunamayan/bozuk deger = BOS kume (fail-closed; cekirdek kalir).
# =============================================================================

from typing import FrozenSet, List
from uuid import UUID

from sqlalchemy.orm import Session

from shared.modules import coerce, normalize

from ..models.tenancy import Tenant


def enabled_modules(db: Session, tenant_id) -> FrozenSet[str]:
    try:
        tid = UUID(str(tenant_id))
    except (ValueError, TypeError):
        return frozenset()
    value = db.query(Tenant.enabled_modules).filter(Tenant.id == tid).scalar()
    return coerce(value)


def modules_list(tenant: Tenant) -> List[str]:
    """Yanitlarda katalog sirasinda liste (frontend `tenant.modules`)."""
    return normalize(coerce(tenant.enabled_modules)) if tenant is not None else []


def set_modules(db: Session, tenant: Tenant, codes) -> List[str]:
    """Secimi dogrular (bilinmeyen kod / eksik bagimlilik → ModuleSelectionError)
    ve yazar. Degisiklik yoksa surum ARTMAZ."""
    selection = normalize(codes)
    if selection == modules_list(tenant):
        return selection
    tenant.enabled_modules = selection
    tenant.version = (tenant.version or 0) + 1
    db.flush()
    return selection
