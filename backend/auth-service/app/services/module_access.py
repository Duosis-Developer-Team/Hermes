# =============================================================================
# HERMES auth — Modul erisimi + sirket hesaplari (auth 0007)
# =============================================================================
# Efektif izin hesabinin TEK noktasi (rbac_service.effective_permissions
# buraya devreder). core, reporting ve frontend ayni sonucu gorur.
#
#   Etkin moduller = tenant modulleri (super-admin; tavan) ∩
#     - yonetici (person, system-admin) → hepsi                     [K6.4]
#     - person  → `everyone` olan moduller ∪ kendine/gruplarina verilen
#     - company → YALNIZ kendine verilen ("Herkes" sirketi KAPSAMAZ)
#   Etkin izinler:
#     - person  → rol izinleri ∩ katalog, etkin modul disindakiler duser
#                 (cekirdek izinler kalir)
#     - company → rol yok; CEKIRDEK izin HIC verilmez (users.manage vb.
#                 role yazilsa bile duser); Talepler aciksa
#                 tickets.access + tickets.create ORTUK gelir    [K6.2]
#
# Gruplar core_db'dedir: core izin sorarken kullanicinin aktif grup
# kimliklerini iletir; auth'un kendi uclari icin core'dan S2S okunur
# (kisa onbellek). Tenant'ta hic grup kurali yoksa cagri YAPILMAZ.
# Grup okunamazsa grup kurallari SAYILMAZ (fail-closed).
# =============================================================================

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Dict, FrozenSet, Iterable, List, Optional, Sequence
from uuid import UUID

import httpx
from sqlalchemy.orm import Session

from shared.modules import ALL_MODULES, MODULE_REQUIRES, PERMISSION_MODULE, Module, filter_permissions
from shared.permissions import ALL_PERMISSIONS, Perm

from ..config import get_settings
from ..models.access import TenantModuleGrant, TenantModulePolicy
from ..models.rbac import RbacRole, RbacUserRole
from ..models.user import User

logger = logging.getLogger("hermes.module_access")

PERSON = "person"
COMPANY = "company"
ACCOUNT_KINDS = (PERSON, COMPANY)
SYSTEM_ADMIN_CODE = "system-admin"

# Sirket hesabinin Talepler modulu varken ORTUK izinleri (K6.2).
COMPANY_IMPLIED = {Module.TICKETS: frozenset({Perm.TICKETS_ACCESS, Perm.TICKETS_CREATE})}

_GROUP_TTL_SECONDS = 30
_group_cache: Dict[tuple, tuple] = {}


@dataclass(frozen=True)
class AccessProfile:
    kind: str
    modules: FrozenSet[str]
    permissions: FrozenSet[str]
    is_admin: bool = False

    def modules_list(self) -> List[str]:
        return [m for m in ALL_MODULES if m in self.modules]


EMPTY = AccessProfile(kind=PERSON, modules=frozenset(), permissions=frozenset())


def _uuid(value) -> Optional[UUID]:
    try:
        return UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None


# ── Grup uyeligi (core_db) ─────────────────────────────────────────────


def clear_group_cache() -> None:
    _group_cache.clear()


def _has_group_grants(db: Session, tid: UUID) -> bool:
    return db.query(TenantModuleGrant.id).filter(
        TenantModuleGrant.tenant_id == tid, TenantModuleGrant.principal_type == "group",
    ).first() is not None


def fetch_group_ids(tenant_id, user_id) -> FrozenSet[str]:
    """Kullanicinin core'daki AKTIF grup kimlikleri (S2S, 30 sn onbellek).
    Hata → bos kume (grup kurallari sayilmaz)."""
    key = (str(tenant_id), str(user_id))
    now = time.monotonic()
    hit = _group_cache.get(key)
    if hit and hit[0] > now:
        return hit[1]
    settings = get_settings()
    token = getattr(settings, "HERMES_S2S_TOKEN_CURRENT", "")
    groups: FrozenSet[str] = frozenset()
    if token:
        base = str(settings.HERMES_CORE_INTERNAL_BASE).rstrip("/")
        try:
            resp = httpx.post(
                f"{base}/internal/access/groups",
                json={"tenant_id": key[0], "user_ids": [key[1]]},
                headers={"Authorization": f"Bearer {token}"}, timeout=5.0,
            )
            if resp.status_code == 200:
                groups = frozenset((resp.json().get("users") or {}).get(key[1]) or [])
            else:
                logger.warning("group lookup status=%s", resp.status_code)
        except Exception as exc:  # noqa: BLE001 — fail-closed
            logger.warning("group lookup error class=%s", type(exc).__name__)
    if len(_group_cache) > 5000:
        _group_cache.clear()
    _group_cache[key] = (now + _GROUP_TTL_SECONDS, groups)
    return groups


# ── Cozum ──────────────────────────────────────────────────────────────


def effective_modules(
    db: Session, *, tenant_id: UUID, user_id: UUID, kind: str, is_admin: bool,
    group_ids: Optional[Iterable] = None,
) -> FrozenSet[str]:
    from .tenant_modules import enabled_modules

    ceiling = enabled_modules(db, tenant_id)
    if kind == PERSON and is_admin:
        return ceiling
    if not ceiling:
        return frozenset()
    closed = {
        p.module for p in db.query(TenantModulePolicy)
        .filter(TenantModulePolicy.tenant_id == tenant_id, TenantModulePolicy.everyone.is_(False)).all()
    }
    granted = {
        m for (m,) in db.query(TenantModuleGrant.module).filter(
            TenantModuleGrant.tenant_id == tenant_id, TenantModuleGrant.principal_type == "user",
            TenantModuleGrant.principal_id == user_id,
        ).all()
    }
    if group_ids is None and _has_group_grants(db, tenant_id):
        group_ids = fetch_group_ids(tenant_id, user_id)
    gids = [g for g in (_uuid(x) for x in (group_ids or ())) if g is not None]
    if gids:
        granted |= {
            m for (m,) in db.query(TenantModuleGrant.module).filter(
                TenantModuleGrant.tenant_id == tenant_id, TenantModuleGrant.principal_type == "group",
                TenantModuleGrant.principal_id.in_(gids),
            ).all()
        }
    if kind == COMPANY:
        out = {m for m in ceiling if m in granted}
    else:
        out = {m for m in ceiling if m not in closed or m in granted}
    # Bagimlilik (ornegin raporlar → zaman girisi) kullanici duzeyinde de gecerli.
    return frozenset(m for m in out if all(dep in out for dep in MODULE_REQUIRES.get(m, ())))


def access_profile(db: Session, user_id, *, tenant_id, group_ids: Optional[Iterable] = None) -> AccessProfile:
    """Aktif kullanicinin, o tenant'taki AKTIF uyeligi uzerinden profili.
    Bilinmeyen/pasif kullanici ya da uyelik yok → bos profil."""
    uid, tid = _uuid(user_id), _uuid(tenant_id)
    if uid is None or tid is None:
        return EMPTY
    if not db.query(User.is_active).filter(User.id == uid).scalar():
        return EMPTY
    from .membership_service import get_active_membership

    membership = get_active_membership(db, tenant_id=tid, user_id=uid)
    if membership is None:
        return EMPTY
    kind = membership.account_kind if membership.account_kind in ACCOUNT_KINDS else PERSON

    rows = (
        db.query(RbacRole.code, RbacRole.permissions)
        .join(RbacUserRole, RbacUserRole.role_id == RbacRole.id)
        .filter(RbacUserRole.user_id == uid, RbacUserRole.tenant_id == tid,
                RbacRole.tenant_id == tid, RbacRole.is_active.is_(True))
        .all()
    )
    perms: set = set()
    codes = set()
    for code, plist in rows:
        codes.add(code)
        perms.update(plist or [])
    perms &= set(ALL_PERMISSIONS)
    is_admin = kind == PERSON and SYSTEM_ADMIN_CODE in codes

    modules = effective_modules(db, tenant_id=tid, user_id=uid, kind=kind, is_admin=is_admin,
                                group_ids=group_ids)
    if kind == COMPANY:
        # Cekirdek izin (module bagli olmayan) sirket hesabina HIC gecmez.
        perms = {p for p in perms if PERMISSION_MODULE.get(p) in modules}
        for module, implied in COMPANY_IMPLIED.items():
            if module in modules:
                perms |= implied
    else:
        perms = set(filter_permissions(perms, modules))
    return AccessProfile(kind=kind, modules=frozenset(modules), permissions=frozenset(perms), is_admin=is_admin)


def membership_kind(db: Session, *, tenant_id, user_id) -> Optional[str]:
    from .membership_service import get_membership

    m = get_membership(db, tenant_id=_uuid(tenant_id), user_id=_uuid(user_id))
    return None if m is None else (m.account_kind or PERSON)


def company_user_ids(db: Session, *, tenant_id) -> FrozenSet[UUID]:
    """Tenant'in sirket hesaplari (durumdan bagimsiz) — listelerden ayiklamak icin."""
    from ..models.tenancy import TenantMembership

    return frozenset(
        r[0] for r in db.query(TenantMembership.user_id).filter(
            TenantMembership.tenant_id == _uuid(tenant_id), TenantMembership.account_kind == COMPANY,
        ).all()
    )


# ── Yonetim (Ayarlar → Modul erisimi / Sirketler) ──────────────────────


def policy_rows(db: Session, *, tenant_id) -> Dict[str, dict]:
    """Modul basina {everyone, grants:[{type,id}]} — tenant'in ACIK modulleri."""
    from .tenant_modules import enabled_modules

    tid = _uuid(tenant_id)
    ceiling = enabled_modules(db, tid)
    closed = {
        p.module for p in db.query(TenantModulePolicy)
        .filter(TenantModulePolicy.tenant_id == tid, TenantModulePolicy.everyone.is_(False)).all()
    }
    out: Dict[str, dict] = {m: {"everyone": m not in closed, "grants": []} for m in ALL_MODULES if m in ceiling}
    for g in db.query(TenantModuleGrant).filter(TenantModuleGrant.tenant_id == tid).order_by(
            TenantModuleGrant.created_at).all():
        if g.module in out:
            out[g.module]["grants"].append({"type": g.principal_type, "id": str(g.principal_id)})
    return out


def set_policy(db: Session, *, tenant_id, module: str, everyone: bool, grants: Sequence[dict],
               actor_id) -> None:
    """Bir modulun politikasini ve kurallarini TAM KUME olarak yazar.
    Kullanici kurallari bu tenant'in uyesi olmali; grup kimligi opaktir
    (core'da dogrulanmis listeden secilir)."""
    from ..models.tenancy import TenantMembership
    from .tenant_modules import enabled_modules

    tid = _uuid(tenant_id)
    if module not in enabled_modules(db, tid):
        raise ValueError("module_not_enabled")
    clean = []
    for g in grants or ():
        ptype, pid = g.get("type"), _uuid(g.get("id"))
        if ptype not in ("user", "group") or pid is None:
            raise ValueError("invalid_principal")
        clean.append((ptype, pid))
    clean = list(dict.fromkeys(clean))
    user_ids = [pid for t, pid in clean if t == "user"]
    if user_ids:
        members = {
            r[0] for r in db.query(TenantMembership.user_id).filter(
                TenantMembership.tenant_id == tid, TenantMembership.user_id.in_(user_ids)).all()
        }
        if set(user_ids) - members:
            raise ValueError("unknown_user")

    policy = db.get(TenantModulePolicy, (tid, module))
    if policy is None:
        policy = TenantModulePolicy(tenant_id=tid, module=module)
        db.add(policy)
    policy.everyone = bool(everyone)
    policy.updated_by = _uuid(actor_id)
    (db.query(TenantModuleGrant)
     .filter(TenantModuleGrant.tenant_id == tid, TenantModuleGrant.module == module)
     .delete(synchronize_session=False))
    for ptype, pid in clean:
        db.add(TenantModuleGrant(tenant_id=tid, module=module, principal_type=ptype, principal_id=pid,
                                 created_by=_uuid(actor_id)))
    db.flush()


def set_user_modules(db: Session, *, tenant_id, user_id, modules: Iterable[str], actor_id) -> List[str]:
    """Bir kullanicinin (ozellikle sirket hesabinin) dogrudan modul
    kurallarini TAM KUME olarak yazar; diger kurallara dokunmaz."""
    from .tenant_modules import enabled_modules

    tid, uid = _uuid(tenant_id), _uuid(user_id)
    ceiling = enabled_modules(db, tid)
    wanted = [m for m in ALL_MODULES if m in set(modules or ())]
    if set(modules or ()) - set(ALL_MODULES):
        raise ValueError("unknown_module")
    if set(wanted) - set(ceiling):
        raise ValueError("module_not_enabled")
    (db.query(TenantModuleGrant)
     .filter(TenantModuleGrant.tenant_id == tid, TenantModuleGrant.principal_type == "user",
             TenantModuleGrant.principal_id == uid)
     .delete(synchronize_session=False))
    for m in wanted:
        db.add(TenantModuleGrant(tenant_id=tid, module=m, principal_type="user", principal_id=uid,
                                 created_by=_uuid(actor_id)))
    db.flush()
    return wanted


def user_modules(db: Session, *, tenant_id, user_id) -> List[str]:
    rows = {
        m for (m,) in db.query(TenantModuleGrant.module).filter(
            TenantModuleGrant.tenant_id == _uuid(tenant_id), TenantModuleGrant.principal_type == "user",
            TenantModuleGrant.principal_id == _uuid(user_id)).all()
    }
    return [m for m in ALL_MODULES if m in rows]
