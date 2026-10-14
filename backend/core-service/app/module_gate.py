# =============================================================================
# HERMES core — Tenant modul kapisi (docs/tenant-platform/00-plan.md §2.3)
# =============================================================================
# Iki katmanin SUNUCU tarafi:
#   1. Izin tabanli uclar (raporlar, talepler, isler...) zaten korunur: auth
#      efektif izinleri ACIK modullerle kesistirir (rbac_service).
#   2. Izinsiz-acik uclar (zaman girisi, toplantilar, ana sayfa bloklari,
#      gelistirici portali) bu kapidan gecer: modul kapaliysa 404 — uc yokmus
#      gibi (kapsam disi kayit = var olmayan kayit ilkesiyle ayni).
#
# Kaynak: `tenant_registry.enabled_modules` (auth projeksiyonu). Pod basina
# kisa omurlu onbellek; projeksiyon geldiginde ilgili kayit hemen dusurulur.
# Okunamayan tenant = BOS kume (fail-closed).
#
# auth 0007: tenant tavaninin ALTINDA kullanici bazli modul erisimi ve
# sirket hesabi kapisi (asagida).
# =============================================================================

import time
from typing import Callable, Dict, FrozenSet, Optional, Tuple

from fastapi import Depends, HTTPException
from sqlalchemy import text

from shared.auth import CurrentUser, get_current_user
from shared.modules import ALL_MODULES, coerce

from .database import SessionLocal

TTL_SECONDS = 30.0
_cache: Dict[str, Tuple[float, FrozenSet[str]]] = {}


def forget_tenant_modules(tenant_id=None) -> None:
    """Onbellegi temizle (tek tenant ya da hepsi)."""
    if tenant_id is None:
        _cache.clear()
    else:
        _cache.pop(str(tenant_id), None)


def read_tenant_modules(db, tenant_id) -> FrozenSet[str]:
    """Verilen oturumla `tenant_registry`'den okur (fail-closed)."""
    try:
        value = db.execute(
            text("SELECT enabled_modules FROM tenant_registry WHERE tenant_id = CAST(:t AS uuid)"),
            {"t": str(tenant_id)},
        ).scalar()
    except Exception:  # noqa: BLE001 — gecersiz uuid / DB hatasi → kapali
        value = None
    return coerce(value)


def _resolve_from_db(tenant_id) -> FrozenSet[str]:
    db = SessionLocal()
    try:
        return read_tenant_modules(db, tenant_id)
    finally:
        db.close()


# Testler cozucuyu degistirir (authz_client.set_client_factory deseni):
# conftest varsayilani "tum moduller", modul testleri kendi secimini kurar.
# None = veritabanindan oku (cagiranin oturumu varsa onunla).
_resolver: Optional[Callable[[str], FrozenSet[str]]] = None


def set_resolver(fn: Optional[Callable[[str], FrozenSet[str]]]) -> None:
    global _resolver
    _resolver = fn
    _cache.clear()


def tenant_modules(tenant_id, db=None) -> FrozenSet[str]:
    """Tenant'in acik modulleri. `db` verilirse (orn. Public API'nin istek
    oturumu) okuma onunla yapilir — ek baglanti acilmaz."""
    key = str(tenant_id or "")
    if not key:
        return frozenset()
    now = time.monotonic()
    hit = _cache.get(key)
    if hit and hit[0] > now:
        return hit[1]
    if _resolver is not None:
        modules = _resolver(key)
    elif db is not None:
        modules = read_tenant_modules(db, key)
    else:
        modules = _resolve_from_db(key)
    _cache[key] = (now + TTL_SECONDS, modules)
    return modules


def module_enabled(tenant_id, module: str) -> bool:
    """Tenant duzeyi (tavan). Kullaniciya ozel karar icin `user_has_module`."""
    return module in tenant_modules(tenant_id)


# =============================================================================
# Kullanici bazli modul erisimi + sirket hesabi kapisi (auth 0007)
# =============================================================================
# Etkin moduller auth'ta cozulur (modul erisimi kurallari + sirket hesabi)
# ve izin sorgusunun yanitiyla gelir (authz_client, 60 sn onbellek).
#   - Profil alinamazsa: KISI → tenant tavani (ic kullanici; izinli uclar
#     zaten auth'a bagli, izinsiz uclar tenant tavaninda kalir);
#     SIRKET HESABI → BOS kume (fail-closed).
#   - Public API'nin sentezlenmis aktorleri icin profil SORULMAZ (kendi
#     kapsam/modul eslemesi vardir) → tenant tavani.

def _profile(current_user):
    if not getattr(current_user, "allow_rbac_resolution", True):
        return None
    from .services import authz_client

    try:
        return authz_client.access_profile(current_user.id, tenant_id=current_user.tenant_id)
    except authz_client.AuthzUnavailable:
        return None


def is_company_account(current_user, profile=None) -> bool:
    if getattr(current_user, "account_kind", "person") == "company":
        return True
    return profile is not None and profile.account_kind == "company"


def user_modules(current_user) -> FrozenSet[str]:
    ceiling = tenant_modules(current_user.tenant_id)
    profile = _profile(current_user)
    if profile is None or profile.modules is None:
        return frozenset() if is_company_account(current_user, profile) else ceiling
    return ceiling & profile.modules


def user_has_module(current_user, module: str) -> bool:
    return module in user_modules(current_user)


def require_module(module: str):
    """Router/uc bagimliligi: modul tenant'ta kapali YA DA kullaniciya acik
    degilse 404."""
    if module not in ALL_MODULES:
        raise ValueError(f"unknown module: {module}")

    def _dependency(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if not module_enabled(current_user.tenant_id, module) or module not in user_modules(current_user):
            raise HTTPException(status_code=404, detail="Not Found")
        return current_user

    _dependency.__name__ = f"require_module_{module}"
    return _dependency


def require_any_module(*modules: str):
    """En az biri acik olmali (orn. ana sayfa haftasi: toplanti VEYA is)."""
    for m in modules:
        if m not in ALL_MODULES:
            raise ValueError(f"unknown module: {m}")

    def _dependency(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        enabled = user_modules(current_user)
        if not any(m in enabled for m in modules):
            raise HTTPException(status_code=404, detail="Not Found")
        return current_user

    _dependency.__name__ = "require_any_module_" + "_".join(modules)
    return _dependency


def require_internal_account(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Sirket hesabi (dis musteriye verilen tek hesap) tenant'in IC
    yuzeylerine giremez: uc yokmus gibi 404. Sirket hesabinin acik
    yuzeyleri yalniz talep portali, yardim merkezi ve /tickets/context'tir
    (main.py; route-walk testiyle kilitli). Token claim'i auth'a sormadan
    yeter; profil yalniz savunma derinligi."""
    if is_company_account(current_user) or is_company_account(current_user, _profile(current_user)):
        raise HTTPException(status_code=404, detail="Not Found")
    return current_user
