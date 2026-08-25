# =============================================================================
# HERMES Auth Service — Uyelik cozumu (WS3)
# =============================================================================
# Bir kimligin bir tenant'a erisimi YALNIZCA aktif uyelik satiriyla
# vardir. Bu modul, "kullanici bu tenant'a girebilir mi?" sorusunun tek
# cevap noktasidir; login, tenant switch ve S2S dizin cozumu ayni
# fonksiyonlari kullanir.
#
# Numaralandirma karsiti ilke: bilinmeyen kullanici, yanlis sifre ve
# uyeliksiz kullanici AYNI yaniti alir. Aksi halde bir saldirgan,
# "hangi e-posta hangi sirkette calisiyor" bilgisini login ucundan
# toplayabilirdi.
# =============================================================================

from __future__ import annotations

from typing import List, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from ..models.tenancy import Tenant, TenantMembership

# Yalnizca bu durum oturum acabilir. 'invited' henuz kabul etmemistir,
# 'suspended'/'removed' erisimi kaldirilmistir.
ACTIVE_MEMBERSHIP_STATUS = "active"


def get_membership(
    db: Session, *, tenant_id, user_id
) -> Optional[TenantMembership]:
    """(tenant, user) uyeligini doner — durum FILTRELENMEZ."""
    return (
        db.query(TenantMembership)
        .filter(
            TenantMembership.tenant_id == tenant_id,
            TenantMembership.user_id == user_id,
        )
        .first()
    )


def get_active_membership(
    db: Session, *, tenant_id, user_id
) -> Optional[TenantMembership]:
    """Yalnizca AKTIF uyelik — oturum acmanin on kosulu."""
    membership = get_membership(db, tenant_id=tenant_id, user_id=user_id)
    if membership is None:
        return None
    if membership.status != ACTIVE_MEMBERSHIP_STATUS:
        return None
    return membership


def list_switchable_memberships(db: Session, *, user_id) -> List[dict]:
    """Kimligin gecis yapabilecegi tenant'lar (organizasyon secici).

    Yalnizca AKTIF uyelik + KULLANILABILIR tenant listelenir. Askiya
    alinmis bir tenant secicide gorunmez; boylece kullanici, girisi
    reddedilecek bir organizasyona tiklayamaz.
    """
    from .tenant_resolver import USABLE_STATUSES

    rows = (
        db.query(TenantMembership, Tenant)
        .join(Tenant, Tenant.id == TenantMembership.tenant_id)
        .filter(
            TenantMembership.user_id == user_id,
            TenantMembership.status == ACTIVE_MEMBERSHIP_STATUS,
            Tenant.status.in_(USABLE_STATUSES),
        )
        .order_by(Tenant.display_name.asc())
        .all()
    )
    return [
        {
            "tenant_id": str(tenant.id),
            "slug": tenant.slug,
            "display_name": tenant.display_name,
            "membership_id": str(membership.id),
            # BASKA tenant'lara dair hicbir bilgi (uye sayisi, plan,
            # domain) burada donmez.
        }
        for membership, tenant in rows
    ]


def count_active_or_invited(db: Session, *, tenant_id) -> int:
    """Entitlement limiti icin: aktif + davetli uyelik sayisi."""
    return (
        db.query(TenantMembership)
        .filter(
            TenantMembership.tenant_id == tenant_id,
            TenantMembership.status.in_(("active", "invited")),
        )
        .count()
    )


def assert_user_ids_are_members(
    db: Session, *, tenant_id, user_ids
) -> List[UUID]:
    """Verilen kimliklerden bu tenant'in AKTIF uyesi olanlari doner.

    S2S dizin/authz sozlesmesinin temel filtresi: baska bir tenant'in
    kullanicisi istense bile sonuca GIRMEZ (kimligin varligi bile
    sizmaz — sonuc listesinde yoktur).
    """
    ids = [UUID(str(u)) for u in dict.fromkeys(user_ids or [])]
    if not ids:
        return []
    rows = (
        db.query(TenantMembership.user_id)
        .filter(
            TenantMembership.tenant_id == tenant_id,
            TenantMembership.user_id.in_(ids),
            TenantMembership.status == ACTIVE_MEMBERSHIP_STATUS,
        )
        .all()
    )
    allowed = {row[0] for row in rows}
    return [uid for uid in ids if uid in allowed]


# =============================================================================
# E-posta alan adiyla OTOMATIK katilim (WS12)
# =============================================================================

def maybe_auto_join(db: Session, *, tenant, user):
    """Alan adi eslesiyorsa kullaniciyi tenant'a uye yapar.

    NE ZAMAN CAGRILIR: kimlik DOGRULANDIKTAN sonra, uyelik bulunamayinca.
    Parola kontrolu bu fonksiyondan ONCE yapilir — burasi kimseyi
    "girise" almaz, yalnizca zaten dogrulanmis bir kimlige UYELIK verir.

    Kosullar (hepsi saglanmali, aksi halde None):
      - tenant'in aktif bir 'email-domain' saglayicisi var,
      - `auto_provision_mode == 'auto'`,
      - kullanicinin e-posta alan adi izin listesinde.

    Verilen rol MEMBER'dir; admin YAPILMAZ. Bir alan adina sahip olmak
    o organizasyonun yoneticisi olmak anlamina gelmez.
    """
    from ..models.rbac import RbacRole, RbacUserRole
    from ..models.tenancy import TenantIdentityProvider

    email = (getattr(user, "email", "") or "").lower()
    if "@" not in email:
        return None
    domain = email.rsplit("@", 1)[1].strip().rstrip(".")
    if not domain:
        return None

    idp = db.query(TenantIdentityProvider).filter(
        TenantIdentityProvider.tenant_id == tenant.id,
        TenantIdentityProvider.provider == "email-domain",
        TenantIdentityProvider.is_active.is_(True),
    ).first()
    if idp is None or idp.auto_provision_mode != "auto":
        return None

    allowed = [d.lower() for d in (idp.allowed_email_domains or [])]
    if domain not in allowed:
        return None

    membership = TenantMembership(
        tenant_id=tenant.id, user_id=user.id,
        status=ACTIVE_MEMBERSHIP_STATUS,
    )
    db.add(membership)
    db.flush()

    # Varsayilan rol: member (varsa). Yoksa rolsuz uye kalir —
    # izinler fail-closed oldugu icin bu guvenlidir.
    member_role = db.query(RbacRole).filter(
        RbacRole.tenant_id == tenant.id,
        RbacRole.code == "member",
        RbacRole.is_active.is_(True),
    ).first()
    if member_role is not None:
        db.add(RbacUserRole(
            tenant_id=tenant.id, user_id=user.id, role_id=member_role.id,
        ))
    db.commit()
    return membership
