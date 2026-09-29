# =============================================================================
# HERMES auth-service - DEV-ONLY sahte kullanici tohumu
# =============================================================================
# YALNIZCA hermes-dev. Kapi: shared/dev_seed.assert_dev_only (bayrak +
# HERMES_ENVIRONMENT + PUBLIC_API_ENV + pod namespace). hermes-test'te
# hicbir DB baglantisi acilmadan exit 2 ile cikar.
#
#   python -m app.jobs.dev_seed --yes-dev            # tohumla (idempotent)
#   python -m app.jobs.dev_seed --yes-dev --purge    # yalnizca tohumu sil
#
# Ne yapar: shared/dev_seed.DEMO_USERS katalogundaki sahte kisileri acar
# (parolasiz, RFC 2606 `example.com` e-postasi — giris YAPAMAZLAR),
# `duosis` tenant'ina aktif uye yapar ve `member` rolunu verir. Zaten var
# olan sahte kullanicinin e-postasi guncel alan adina TASINIR (eski
# `.invalid` satirlari tekrar kosuyla duzelir). core-service tohumu ayni
# id'leri is verisine baglar; bu yuzden SIRA: once auth, sonra core.
#
# Purge: yalnizca isaretli id'li kullanicilar ve onlarin uyelik/rol
# satirlari silinir. Gercek kullaniciya dokunulmaz. DDL YOK.
# =============================================================================

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from typing import Optional, Sequence

from sqlalchemy import text
from sqlalchemy.orm import Session

from shared.dev_seed import (
    EXIT_REFUSED,
    DevSeedRefused,
    assert_dev_only,
    demo_id,
    demo_users,
    is_demo_id,
)

DEFAULT_TENANT_SLUG = "duosis"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _tenant(db: Session, slug: str):
    from ..models.tenancy import Tenant

    tenant = db.query(Tenant).filter(Tenant.slug == slug).first()
    if tenant is None:
        raise RuntimeError(f"tenant '{slug}' not found")
    return tenant


def seed(db: Session, *, tenant_slug: str = DEFAULT_TENANT_SLUG) -> dict:
    """Sahte kullanicilari + uyelik + member rolunu yazar (idempotent)."""
    from ..models.rbac import RbacRole, RbacUserRole
    from ..models.tenancy import TenantMembership
    from ..models.user import AuthProvider, User, UserRole

    tenant = _tenant(db, tenant_slug)
    member_role = db.query(RbacRole).filter(
        RbacRole.tenant_id == tenant.id,
        RbacRole.code == "member",
        RbacRole.is_active.is_(True),
    ).first()

    created = {"users": 0, "memberships": 0, "roles": 0}
    updated = {"emails": 0}
    skipped = []
    for spec in demo_users():
        user = db.query(User).filter(User.id == spec["id"]).first()
        if user is not None and user.email != spec["email"]:
            # Eski kosulardan kalan e-posta (ornek: `@demo.duosis.invalid`)
            # guncel alan adina tasinir — tekrar kosmak eski satirlari
            # DUZELTIR. Yalnizca isaretli (demo) id'ye dokunulur; hedef
            # e-posta baska bir kayitta ise dokunma, atla.
            clash = db.query(User.id).filter(
                User.email == spec["email"], User.id != spec["id"]).first()
            if clash is not None:
                skipped.append(spec["email"])
            else:
                user.email = spec["email"]
                updated["emails"] += 1
        if user is None:
            clash = db.query(User.id).filter(
                User.email == spec["email"]).first()
            if clash is not None:
                # Ayni e-posta isaretsiz bir kayitta: dokunma, atla.
                skipped.append(spec["email"])
                continue
            db.add(User(
                id=spec["id"],
                email=spec["email"],
                full_name=spec["full_name"],
                # Parolasiz + ayrilmis (RFC 2606) alan adi: yerel giris de
                # SSO da imkansiz. Yalnizca listelerde/atamalarda gorunurler.
                hashed_password=None,
                is_active=True,
                is_admin=False,
                role=UserRole.USER,
                auth_provider=AuthProvider.MICROSOFT,
            ))
            db.flush()
            created["users"] += 1

        membership = db.query(TenantMembership).filter(
            TenantMembership.tenant_id == tenant.id,
            TenantMembership.user_id == spec["id"],
        ).first()
        if membership is None:
            db.add(TenantMembership(
                id=demo_id("membership", tenant.id, spec["key"]),
                tenant_id=tenant.id, user_id=spec["id"],
                status="active", joined_at=_now(),
            ))
            created["memberships"] += 1

        if member_role is not None:
            has_role = db.query(RbacUserRole.id).filter(
                RbacUserRole.tenant_id == tenant.id,
                RbacUserRole.user_id == spec["id"],
                RbacUserRole.role_id == member_role.id,
            ).first()
            if has_role is None:
                db.add(RbacUserRole(
                    id=demo_id("user_role", tenant.id, spec["key"]),
                    tenant_id=tenant.id, user_id=spec["id"],
                    role_id=member_role.id,
                ))
                created["roles"] += 1
    db.flush()
    return {
        "ok": True,
        "tenant_id": str(tenant.id),
        "created": created,
        "updated": updated,
        "skipped_email_clash": skipped,
        "member_role_found": member_role is not None,
    }


def purge(db: Session) -> dict:
    """Yalnizca isaretli sahte kullanicilari ve bagli satirlarini siler."""
    ids = [str(u["id"]) for u in demo_users() if is_demo_id(u["id"])]
    params = {"ids": ids}
    deleted = {}
    for table in ("rbac_user_roles", "tenant_memberships"):
        deleted[table] = db.execute(text(
            f"DELETE FROM {table} WHERE CAST(user_id AS text) = ANY(:ids)"
        ), params).rowcount
    deleted["users"] = db.execute(text(
        "DELETE FROM users WHERE CAST(id AS text) = ANY(:ids)"
    ), params).rowcount
    return {"ok": True, "deleted": deleted}


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    try:
        # auth-service'te PUBLIC_API_ENV ayari yoktur: efektif deger
        # ortamdan (yoksa "dev"). Asil kapi HERMES_ENVIRONMENT + namespace.
        assert_dev_only(
            args, public_api_env=os.environ.get("PUBLIC_API_ENV", "dev"),
        )
    except DevSeedRefused as exc:
        print(str(exc), file=sys.stderr)
        return EXIT_REFUSED

    slug = DEFAULT_TENANT_SLUG
    if "--tenant-slug" in args:
        slug = args[args.index("--tenant-slug") + 1]

    from ..database import SessionLocal

    db = SessionLocal()
    try:
        if "--purge" in args:
            summary = purge(db)
        else:
            summary = seed(db, tenant_slug=slug)
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        print(json.dumps({"ok": False, "error": type(exc).__name__,
                          "detail": str(exc)[:300]}), file=sys.stderr)
        return 1
    finally:
        db.close()
    print(json.dumps(summary, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
