# =============================================================================
# HERMES core - Legacy task izinleri → RBAC komponent rol backfill'i
# =============================================================================
# RBAC cutover (2026-08-04): "ne yapabilir" artik rollerden cozulur.
# Bu modul, DONMUS legacy cozumleyiciyle (task_service.
# legacy_resolve_effective_for_user) mevcut efektif izinleri hesaplar ve
# kullanici→komponent-rol eslemesini auth-service'in S2S
# /internal/authz/task-backfill ucuna gonderir.
#
# Kurallar:
#   - Non-destructive: hicbir legacy tablo/kayit SILINMEZ; auth tarafi
#     yalnizca EKSIK atamalari ekler (idempotent — tekrar kosmak guvenli).
#   - Kimlik user ID'dir; e-posta asla anahtar degildir.
#   - Inactive kullanici ozel islenmez: rol atamasi verilse bile
#     auth-service effective_permissions pasif kullaniciya bos kume
#     doner (mevcut fail-closed davranis korunur).
#   - Legacy veride "assign var ama access yok" gorulurse yeni invariant
#     geregi access DE verilir ve ANOMALI olarak raporlanir.
#   - Basarisizlik deployment'i YARIM BIRAKMAZ: startup cagiran sarmalar,
#     loglar, yutar. Admin ucu ayni ozeti dondurur (dry-run destekli).
# =============================================================================

import logging
from typing import Callable, Dict, List, Optional, Tuple

import httpx
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models.task import TaskUserPermission
from ..models.user_group import (
    TaskGroupMemberOverride,
    TaskGroupPermission,
    UserGroup,
    UserGroupMember,
)
from . import task_service
from .auth_upstream import auth_service_base_url

logger = logging.getLogger("hermes.rbac_backfill")

_TIMEOUT = 10.0
_CHUNK = 500  # auth ucundaki MAX_BACKFILL_ITEMS

_client: Optional[httpx.Client] = None
_client_factory: Callable[[], httpx.Client] = lambda: httpx.Client(
    timeout=_TIMEOUT
)


def set_client_factory(factory: Callable[[], httpx.Client]) -> None:
    """YALNIZCA testler icin."""
    global _client, _client_factory
    _client_factory = factory
    _client = None


def _get_client() -> httpx.Client:
    global _client
    if _client is None or _client.is_closed:
        _client = _client_factory()
    return _client


def _candidate_user_ids(db: Session) -> List:
    """Legacy izin sisteminin DOKUNDUGU herkes: dogrudan satiri olanlar +
    izin satiri olan aktif gruplarin aktif uyeleri + override sahipleri."""
    ids = {r[0] for r in db.query(TaskUserPermission.user_id).all()}
    ids.update(
        r[0]
        for r in db.query(UserGroupMember.user_id)
        .join(UserGroup, UserGroup.id == UserGroupMember.group_id)
        .join(
            TaskGroupPermission,
            TaskGroupPermission.group_id == UserGroup.id,
        )
        .filter(
            UserGroupMember.is_active.is_(True),
            UserGroup.is_active.is_(True),
        )
        .all()
    )
    ids.update(r[0] for r in db.query(TaskGroupMemberOverride.user_id).all())
    return sorted(ids, key=str)


def _legacy_raw_assign(db: Session, user_id, scope: str) -> bool:
    """Legacy assign SINYALI — access sartina BAKMADAN. Anomali tespiti
    icin: resolver'in "assign access'siz olmaz" kurali bu ham sinyali
    gizler; invariant geregi boyle kullaniciya access de verilecek."""
    from .task_service import (
        _direct_perm_attr,
        _effective_group_grant,
        get_task_permission,
    )

    has_active_group = (
        db.query(UserGroupMember.id)
        .join(UserGroup, UserGroup.id == UserGroupMember.group_id)
        .filter(
            UserGroupMember.user_id == user_id,
            UserGroupMember.is_active.is_(True),
            UserGroup.is_active.is_(True),
        )
        .first()
        is not None
    )
    if has_active_group:
        return _effective_group_grant(db, user_id, column="assign", scope=scope)
    perm = get_task_permission(db, user_id)
    if perm is None:
        return False
    return bool(getattr(perm, _direct_perm_attr(scope, "assign")))


_SCOPE_ROLES = {
    "task": ("task-access", "task-assigner"),
    "issue": ("issues-access", "issues-assigner"),
}


def compute_legacy_mapping(
    db: Session,
) -> Tuple[Dict[str, List[str]], List[str]]:
    """{user_id_str: [komponent rol kodu, ...]} + anomali listesi.

    Rol secimi (scope basina): assigner rolu access'i ZATEN icerir; bu
    yuzden assigner verilen kullaniciya ayrica access rolu EKLENMEZ.
    """
    mapping: Dict[str, List[str]] = {}
    anomalies: List[str] = []
    for uid in _candidate_user_ids(db):
        codes: List[str] = []
        for scope, (access_role, assigner_role) in _SCOPE_ROLES.items():
            access = task_service.legacy_resolve_effective_for_user(
                db, uid, column="access", scope=scope
            )
            raw_assign = _legacy_raw_assign(db, uid, scope)
            if raw_assign and not access:
                anomalies.append(
                    f"user {uid}: legacy {scope} assign without access — "
                    "access granted per new invariant"
                )
            if raw_assign:
                codes.append(assigner_role)
            elif access:
                codes.append(access_role)
        if codes:
            mapping[str(uid)] = codes
    return mapping, anomalies


def push_to_auth(mapping: Dict[str, List[str]]) -> Dict[str, int]:
    """Eslemeyi auth-service S2S backfill ucuna parcali gonderir."""
    settings = get_settings()
    token = settings.HERMES_S2S_TOKEN_CURRENT
    if not token:
        raise RuntimeError("S2S credential not configured")

    totals = {"assigned": 0, "skipped_existing": 0,
              "unknown_users": 0, "unknown_roles": 0}
    items = [
        {"user_id": uid, "role_codes": codes}
        for uid, codes in mapping.items()
    ]
    for i in range(0, len(items), _CHUNK):
        resp = _get_client().post(
            f"{auth_service_base_url()}/internal/authz/task-backfill",
            json={"assignments": items[i : i + _CHUNK]},
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code != 200:
            raise RuntimeError(f"backfill push status {resp.status_code}")
        body = resp.json()
        for k in totals:
            totals[k] += int(body.get(k) or 0)
    return totals


def run(db: Session, *, dry_run: bool = True) -> dict:
    """Backfill'i hesaplar; dry_run=False ise auth'a gonderir."""
    mapping, anomalies = compute_legacy_mapping(db)
    summary = {
        "dry_run": dry_run,
        "users": len(mapping),
        "role_grants": sum(len(v) for v in mapping.values()),
        "anomalies": anomalies,
        "pushed": None,
    }
    if not dry_run and mapping:
        summary["pushed"] = push_to_auth(mapping)
    return summary


def run_startup_backfill(db: Session) -> None:
    """Startup'ta otomatik, idempotent backfill. HICBIR hata yukselmez —
    deployment yarim kalmaz; sonuc/loga yazilir."""
    try:
        summary = run(db, dry_run=False)
        logger.info(
            "rbac backfill: users=%d grants=%d pushed=%s anomalies=%d",
            summary["users"],
            summary["role_grants"],
            summary["pushed"],
            len(summary["anomalies"]),
        )
        for a in summary["anomalies"]:
            logger.warning("rbac backfill anomaly: %s", a)
    except Exception as exc:  # noqa: BLE001 — asla deployment'i bozma
        logger.warning("rbac backfill skipped: %s", exc)
