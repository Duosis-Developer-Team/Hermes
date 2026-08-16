#!/usr/bin/env python
# =============================================================================
# HERMES — Platform Super Admin bootstrap (WS9)
# =============================================================================
# Ilk platform operatorunu IDEMPOTENT olarak olusturur.
#
# SIFRE POLITIKASI (pack 06 §8, degismez CTO karari):
#   - Sifre BU DOSYADA, hicbir SQL'de, manifest'te, ConfigMap'te,
#     frontend'de veya test fixture'inda BULUNMAZ.
#   - Yalnizca RUNTIME'dan gelir: `HERMES_BOOTSTRAP_ADMIN_PASSWORD`
#     ortam degiskeni. Verilmezse betik guclu bir sifre URETIR ve
#     STDOUT'a BIR KEZ yazar; hicbir yere kaydetmez.
#   - Uretilen sifre loglanmaz (yalnizca stdout'a bir kez basilir).
#
# Kullanim:
#   python -m app.scripts.bootstrap_platform_admin \
#       --email superadmin@hermes.dev
#
# Idempotent: ayni e-posta ile yeniden kosmak yeni kayit YARATMAZ,
# yalnizca eksik platform-admin kaydini tamamlar.
# =============================================================================

from __future__ import annotations

import argparse
import os
import secrets
import sys


def _generate_password() -> str:
    """Kriptografik olarak guclu, tek kullanimlik sifre."""
    return secrets.token_urlsafe(24)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Hermes Platform Super Admin bootstrap",
    )
    parser.add_argument(
        "--email", required=True,
        help="Operator e-postasi (orn. superadmin@hermes.dev)",
    )
    parser.add_argument(
        "--full-name", default="Platform Administrator",
    )
    args = parser.parse_args(argv)

    # Servis kokunu path'e ekle (Job icinde `python -m` ile kosar).
    from app.database import SessionLocal
    from app.models.tenancy import PlatformAdmin
    from app.models.user import User
    from app.services.platform_service import (
        BOOTSTRAP_PERMISSIONS, record_audit,
    )
    from shared.auth import hash_password

    email = args.email.strip().lower()

    supplied = os.getenv("HERMES_BOOTSTRAP_ADMIN_PASSWORD") or ""
    password = supplied.strip() or _generate_password()
    generated = not supplied.strip()

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        created_user = False
        if user is None:
            user = User(
                email=email,
                full_name=args.full_name,
                hashed_password=hash_password(password),
                is_active=True,
                is_admin=False,   # platform yetkisi TENANT rolu DEGILDIR
            )
            db.add(user)
            db.flush()
            created_user = True
        elif generated is False:
            # Acikca sifre verildiyse mevcut kimligin sifresi guncellenir
            # (kurtarma senaryosu); uretilen sifre ile SESSIZCE degistirme
            # YAPILMAZ.
            user.hashed_password = hash_password(password)

        admin = (
            db.query(PlatformAdmin)
            .filter(PlatformAdmin.user_id == user.id).first()
        )
        created_admin = False
        if admin is None:
            admin = PlatformAdmin(
                user_id=user.id,
                permissions=list(BOOTSTRAP_PERMISSIONS),
                is_active=True,
            )
            db.add(admin)
            created_admin = True
        else:
            admin.is_active = True

        record_audit(
            db,
            action="platform.admin.bootstrapped",
            actor_user_id=None,          # sistem eylemi
            target_type="platform_admin",
            target_id=str(user.id),
            metadata={
                "created_user": created_user,
                "created_admin": created_admin,
                "password_source": "generated" if generated else "provided",
            },
        )
        db.commit()
    finally:
        db.close()

    print(f"✅ platform admin hazir: {email}")
    if created_user and generated:
        # BIR KEZ gosterilir; hicbir yere yazilmaz. Operator bunu
        # parola yoneticisine almali ve ilk giriste degistirmelidir.
        print("--- ONE-TIME PASSWORD (kaydedin, bir daha gosterilmez) ---")
        print(password)
        print("---------------------------------------------------------")
    elif generated and not created_user:
        print(
            "ℹ️  Mevcut kimlik kullanildi; sifre DEGISTIRILMEDI. "
            "Sifre sifirlamak icin HERMES_BOOTSTRAP_ADMIN_PASSWORD verin."
        )
    return 0


if __name__ == "__main__":  # pragma: no cover — CLI
    sys.exit(main())
