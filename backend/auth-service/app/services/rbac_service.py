# =============================================================================
# HERMES Auth Service - RBAC cekirdegi
# =============================================================================
# Efektif izin cozumu + startup bootstrap + guard yardimcilari.
#
# Fail-closed ilkeler:
#   - Pasif KULLANICI → bos izin kumesi (JWT suresi dolmamis olsa bile
#     RBAC-korumali uclara erisemez — mevcut G3 riskinin daraltilmasi).
#   - Pasif ROL efektif hesaba GIRMEZ (LogiSlot'un en somut sessiz
#     hatasi: pasif rolun izinleri calismaya devam ediyordu — burada
#     testle kilitli olarak calismaz).
#   - Katalog disi izin kodlari (kaldirilmis/yazim hatasi) filtrelenir.
#   - JWT'ye izin GOMULMEZ; her cozum DB'den. is_admin claim'i RBAC
#     kararlarinda KULLANILMAZ (fail-open fallback yasak — G4 dersi).
#
# is_admin turetmesi: users.is_admin sutunu GECIS DONEMI uyumlulugu icin
# yasar; tek dogruluk kaynagi system-admin rol atamasi olur ve sutun her
# atama degisikliginde senkronlanir. Eski JWT'ler ve heniz tasinmamis
# require_admin yollari boylece dogru calismaya devam eder.
# =============================================================================

import logging
import re
from typing import Iterable, Optional, Sequence
from uuid import UUID

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from shared.auth import CurrentUser, get_current_user
from shared.permissions import ALL_PERMISSIONS, PERMISSION_REQUIRES, Perm

from ..database import get_db
from ..models.rbac import RbacRole, RbacUserRole
from ..models.user import User

logger = logging.getLogger("hermes.rbac")

# Sistem rolleri — esletirme HER ZAMAN code ile (isimle asla).
SYSTEM_ADMIN_CODE = "system-admin"
MEMBER_CODE = "member"

# RBAC cutover komponent rolleri (stabil code slug'lari — backfill S2S
# ucu bu kodlarla atama yapar). Iceriklerinde bagimlilik invariant'i
# gozetilir: assigner rolleri access iznini DE tasir.
TASK_COMPONENT_ROLES = {
    "task-access": ("Task Access", [Perm.TASKS_ACCESS]),
    "task-assigner": (
        "Task Assigner",
        [Perm.TASKS_ACCESS, Perm.TASKS_ASSIGN],
    ),
    "issues-access": (
        "Issues & Suggestions Access",
        [Perm.ISSUES_ACCESS],
    ),
    "issues-assigner": (
        "Issues & Suggestions Assigner",
        [Perm.ISSUES_ACCESS, Perm.ISSUES_ASSIGN],
    ),
}

_CODE_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$")


# ── Efektif izin cozumu ────────────────────────────────────────────────


def effective_permissions(db: Session, user_id) -> frozenset:
    """Kullanicinin efektif izinleri: AKTIF kullanicinin AKTIF
    rollerindeki izinlerin birlesimi ∩ katalog."""
    try:
        uid = UUID(str(user_id))
    except (ValueError, TypeError):
        return frozenset()

    active = (
        db.query(User.is_active).filter(User.id == uid).scalar()
    )
    if not active:
        return frozenset()  # bilinmeyen veya pasif kullanici → bos

    rows = (
        db.query(RbacRole.permissions)
        .join(RbacUserRole, RbacUserRole.role_id == RbacRole.id)
        .filter(
            RbacUserRole.user_id == uid,
            RbacRole.is_active.is_(True),
        )
        .all()
    )
    perms: set = set()
    for (plist,) in rows:
        perms.update(plist or [])
    return frozenset(perms & set(ALL_PERMISSIONS))


def user_role_rows(db: Session, user_id: UUID):
    """Kullanicinin rol atamalari (pasif roller isaretli gelsin diye
    filtrelemeden doner; efektif hesap ayri)."""
    return (
        db.query(RbacRole)
        .join(RbacUserRole, RbacUserRole.role_id == RbacRole.id)
        .filter(RbacUserRole.user_id == user_id)
        .order_by(RbacRole.name.asc())
        .all()
    )


# ── Guard dependency'leri (auth-service ici) ───────────────────────────


def require_permissions(*codes: str):
    """FastAPI dependency factory — verilen TUM izinler gerekli (AND).
    LogiSlot'un require_facility_permissions deseninin Hermes hali."""

    def checker(
        current_user: CurrentUser = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> CurrentUser:
        perms = effective_permissions(db, current_user.id)
        missing = set(codes) - perms
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "Missing permissions: "
                    + ", ".join(sorted(missing))
                ),
            )
        return current_user

    return checker


def require_any_permission(*codes: str):
    """Verilen izinlerden EN AZ BIRI gerekli (OR) — ortak okuma uclari
    icin (ornegin rol listesi hem rol hem kullanici yoneticisine lazim)."""

    def checker(
        current_user: CurrentUser = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> CurrentUser:
        perms = effective_permissions(db, current_user.id)
        if not (set(codes) & perms):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "Requires one of: " + ", ".join(sorted(codes))
                ),
            )
        return current_user

    return checker


# ── Yazim dogrulamalari ────────────────────────────────────────────────


def validate_role_code(code: str) -> None:
    if not _CODE_PATTERN.match(code or ""):
        raise HTTPException(
            status_code=422,
            detail=(
                "Role code must be a 3-64 char lowercase slug "
                "(a-z, 0-9, hyphen)."
            ),
        )


def validate_permission_codes(codes: Iterable[str]) -> list:
    """Katalog disi kod → 422 (hangileri oldugu acikca soylenir).
    RBAC cutover: bagimlilik kurali da YAZIM yolunda zorlanir —
    assign izni ayni scope'un access iznini gerektirir (yalniz
    frontend checkbox davranisina guvenilmez)."""
    codes = list(dict.fromkeys(codes or []))
    unknown = [c for c in codes if c not in ALL_PERMISSIONS]
    if unknown:
        raise HTTPException(
            status_code=422,
            detail="Unknown permission codes: " + ", ".join(unknown),
        )
    violated = [
        f"{code} requires {required}"
        for code, required in PERMISSION_REQUIRES.items()
        if code in codes and required not in codes
    ]
    if violated:
        raise HTTPException(
            status_code=422,
            detail="Permission dependency violated: " + "; ".join(violated),
        )
    return sorted(codes)


def enforce_subset_rule(
    actor_perms: frozenset, requested: Sequence[str], action: str
) -> None:
    """SELF-ESCALATION KILIDI (LogiSlot'ta yoktu — bilinen zaaf):
    aktor, SAHIP OLMADIGI bir izni icermeye calisan rol yazamaz/atayamaz.
    system-admin (tum izinler) dogal olarak her seyi yapabilir."""
    exceeding = set(requested) - actor_perms
    if exceeding:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Cannot {action} permissions you do not hold: "
                + ", ".join(sorted(exceeding))
            ),
        )


def enforce_last_admin_guard(
    db: Session, *, losing_user_id: UUID
) -> None:
    """Son aktif system-admin'in yetkisi dusurulemez (kilitlenme
    korumasi — LogiSlot'un LAST_ADMIN deseninden alinan iyi fikir)."""
    admin_role = get_role_by_code(db, SYSTEM_ADMIN_CODE)
    if admin_role is None:
        return
    others = (
        db.query(RbacUserRole)
        .join(User, User.id == RbacUserRole.user_id)
        .filter(
            RbacUserRole.role_id == admin_role.id,
            RbacUserRole.user_id != losing_user_id,
            User.is_active.is_(True),
        )
        .count()
    )
    if others == 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Cannot remove the last active system administrator."
            ),
        )


# ── Rol / atama yardimcilari ───────────────────────────────────────────


def get_role_by_code(db: Session, code: str) -> Optional[RbacRole]:
    return db.query(RbacRole).filter(RbacRole.code == code).first()


def sync_is_admin(db: Session, user_id: UUID) -> None:
    """users.is_admin'i TURETILMIS degere cek: aktif system-admin
    atamasi var mi? (Gecis donemi uyumlulugu; commit CAGIRANA aittir.)"""
    admin_role = get_role_by_code(db, SYSTEM_ADMIN_CODE)
    has_admin = False
    if admin_role is not None and admin_role.is_active:
        has_admin = (
            db.query(RbacUserRole)
            .filter(
                RbacUserRole.user_id == user_id,
                RbacUserRole.role_id == admin_role.id,
            )
            .count()
            > 0
        )
    user = db.query(User).filter(User.id == user_id).first()
    if user is not None and bool(user.is_admin) != has_admin:
        user.is_admin = has_admin


def set_user_roles(
    db: Session,
    *,
    target_user_id: UUID,
    role_ids: Sequence[UUID],
    actor: CurrentUser,
    actor_perms: frozenset,
) -> list:
    """Kullanicinin rol kumesini REPLACE eder (LogiSlot deseni: delta
    degil tam kume). Kurallar: yalnizca aktif roller atanabilir; subset
    kurali atanan TUM izinlerin birlesimine uygulanir; son-admin kilidi.
    Commit cagirana aittir."""
    target = db.query(User).filter(User.id == target_user_id).first()
    if target is None:
        raise HTTPException(status_code=404, detail="User not found.")

    unique_ids = list(dict.fromkeys(role_ids or []))
    roles = (
        db.query(RbacRole).filter(RbacRole.id.in_(unique_ids)).all()
        if unique_ids
        else []
    )
    by_id = {r.id: r for r in roles}
    missing = [str(i) for i in unique_ids if i not in by_id]
    if missing:
        raise HTTPException(
            status_code=422,
            detail="Unknown role ids: " + ", ".join(missing),
        )
    inactive = [r.code for r in roles if not r.is_active]
    if inactive:
        raise HTTPException(
            status_code=422,
            detail=(
                "Inactive roles cannot be assigned: "
                + ", ".join(sorted(inactive))
            ),
        )

    # Subset kurali: atanacak kumenin TUM izinleri aktorde olmali.
    requested_perms: set = set()
    for r in roles:
        requested_perms.update(r.permissions or [])
    enforce_subset_rule(
        actor_perms, sorted(requested_perms), action="grant"
    )

    # Son-admin kilidi: bu replace, hedeften system-admin'i dusuruyorsa
    # ve hedef son aktif admin ise engelle.
    admin_role = get_role_by_code(db, SYSTEM_ADMIN_CODE)
    if admin_role is not None:
        had = (
            db.query(RbacUserRole)
            .filter(
                RbacUserRole.user_id == target_user_id,
                RbacUserRole.role_id == admin_role.id,
            )
            .count()
            > 0
        )
        keeps = admin_role.id in by_id
        if had and not keeps:
            enforce_last_admin_guard(db, losing_user_id=target_user_id)

    db.query(RbacUserRole).filter(
        RbacUserRole.user_id == target_user_id
    ).delete(synchronize_session=False)
    for rid in unique_ids:
        db.add(
            RbacUserRole(
                user_id=target_user_id,
                role_id=rid,
                created_by=UUID(actor.id),
            )
        )
    db.flush()
    sync_is_admin(db, target_user_id)
    return [by_id[i] for i in unique_ids]


def sync_admin_role_from_legacy_flag(
    db: Session, *, user_id: UUID, is_admin: bool
) -> None:
    """GECIS KOPRUSU: eski kullanici-yonetimi yollari (PUT /users/{id}
    is_admin=...) rol atamasina cevrilir — tek dogruluk kaynagi ROL kalir.
    is_admin=False son aktif admin'i dusurecekse 409. Commit cagirana."""
    admin_role = get_role_by_code(db, SYSTEM_ADMIN_CODE)
    if admin_role is None:  # bootstrap henuz kosmadiysa sessiz gecis
        return
    existing = (
        db.query(RbacUserRole)
        .filter(
            RbacUserRole.user_id == user_id,
            RbacUserRole.role_id == admin_role.id,
        )
        .first()
    )
    if is_admin and existing is None:
        db.add(RbacUserRole(user_id=user_id, role_id=admin_role.id))
    elif not is_admin and existing is not None:
        enforce_last_admin_guard(db, losing_user_id=user_id)
        db.delete(existing)
    db.flush()
    sync_is_admin(db, user_id)


# ── Startup bootstrap (idempotent) ─────────────────────────────────────


def bootstrap(db: Session) -> None:
    """Her startup'ta kosar; yeniden kosmak guvenlidir.

    1. system-admin rolu: yoksa yarat; VARSA izinlerini kataloga esitle —
       kataloga eklenen yeni izin, elle data-migration YAZILMADAN bir
       sonraki deploy'da admin'lere otomatik yayilir (LogiSlot'un
       aebbb08f3bd8 migration'ina ihtiyac birakan zaafin cozumu).
    2. member rolu: bos taban sablonu (kilitli degil; silinirse yeniden
       olusur — bilincli, dokumante davranis).
    3. is_admin=True olan her kullaniciya system-admin atamasi (gecis
       gunu kimsenin yetkisi degismez).
    4. is_admin sutunlarini turetilmis degere senkronla.
    """
    admin_role = get_role_by_code(db, SYSTEM_ADMIN_CODE)
    if admin_role is None:
        admin_role = RbacRole(
            code=SYSTEM_ADMIN_CODE,
            name="System Administrator",
            description=(
                "Full administrative authority over Hermes. "
                "System role: permissions are locked to the full "
                "catalog and kept in sync automatically."
            ),
            permissions=list(ALL_PERMISSIONS),
            is_system=True,
            is_active=True,
        )
        db.add(admin_role)
        db.flush()
        logger.info("rbac bootstrap: system-admin role created")
    else:
        wanted = list(ALL_PERMISSIONS)
        if sorted(admin_role.permissions or []) != wanted:
            admin_role.permissions = wanted
            logger.info(
                "rbac bootstrap: system-admin permissions synced to "
                "catalog (%d)", len(wanted)
            )
        # Kilit alanlari her kosula karsi sabitle.
        admin_role.is_system = True
        admin_role.is_active = True

    if get_role_by_code(db, MEMBER_CODE) is None:
        db.add(
            RbacRole(
                code=MEMBER_CODE,
                name="Member",
                description=(
                    "Baseline role template with no permissions. "
                    "Recreated empty at startup if deleted."
                ),
                permissions=[],
                is_system=False,
                is_active=True,
            )
        )
        db.flush()
        logger.info("rbac bootstrap: member role created")

    # RBAC cutover (2026-08-04): PM Configurations'taki legacy task
    # access verisinin tasinacagi KOMPONENT roller. Yalnizca YOKSA
    # olusturulur — admin sonradan duzenleyebilir; system-admin gibi
    # katalogla senkronlanmaz.
    ensured = 0
    for code, (name, perms) in TASK_COMPONENT_ROLES.items():
        if get_role_by_code(db, code) is None:
            db.add(
                RbacRole(
                    code=code,
                    name=name,
                    description=(
                        "Created by the PM-permissions → Roles migration. "
                        "Grants: " + ", ".join(perms) + "."
                    ),
                    permissions=list(perms),
                    is_system=False,
                    is_active=True,
                )
            )
            ensured += 1
    if ensured:
        db.flush()
        logger.info(
            "rbac bootstrap: %d task component role(s) created", ensured
        )

    # Legacy admin'lere rol atamasi (idempotent).
    assigned = 0
    admin_users = (
        db.query(User).filter(User.is_admin.is_(True)).all()
    )
    existing_ids = {
        row.user_id
        for row in db.query(RbacUserRole.user_id)
        .filter(RbacUserRole.role_id == admin_role.id)
        .all()
    }
    for u in admin_users:
        if u.id not in existing_ids:
            db.add(RbacUserRole(user_id=u.id, role_id=admin_role.id))
            assigned += 1
    if assigned:
        logger.info(
            "rbac bootstrap: system-admin assigned to %d legacy "
            "admin(s)", assigned
        )
    db.flush()

    # is_admin sutununu tureterek senkronla (rol → sutun yonu).
    for u in db.query(User).all():
        sync_is_admin(db, u.id)

    db.commit()
