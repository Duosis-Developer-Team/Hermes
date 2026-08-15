# =============================================================================
# HERMES - Platform Super Admin izin katalogu (TEK KAYNAK, WS2)
# =============================================================================
# Bu, `shared/permissions.py`'den TAMAMEN AYRI bir yetki uzayidir.
#
# NEDEN AYRI: bir tenant yoneticisi (tenant'in `system-admin` rolu) kendi
# organizasyonunun tam yetkilisidir — ama Hermes SaaS operatoru DEGILDIR.
# Iki katalogu birlestirmek, tenant admininin kendine platform yetkisi
# verebilmesi anlamina gelirdi. Bu yuzden:
#
#   - platform izinleri ASLA `rbac_roles.permissions` icinde gecerli
#     degildir (auth-service rol yazim yolunda reddedilir);
#   - tenant izinleri de `platform_admins.permissions` icinde gecersizdir;
#   - iki uzay ayni ad alanini bile paylasmaz: platform izinleri
#     `platform.` on ekiyle baslar.
#
# Kimin platform admini oldugu `platform_admins` tablosunda yasar ve
# yalnizca mevcut bir platform admini (veya bootstrap) tarafindan
# yazilabilir — hicbir tenant akisiyla degil.
# =============================================================================


class PlatformPerm:
    """Platform (SaaS operatoru) izin sabitleri."""

    TENANTS_VIEW = "platform.tenants.view"
    TENANTS_MANAGE = "platform.tenants.manage"
    SUBSCRIPTIONS_MANAGE = "platform.subscriptions.manage"
    SUPPORT_ACCESS_CREATE = "platform.support_access.create"
    # Salt-okunur destek varsayilandir; YAZMA yetkisi AYRI bir izindir.
    SUPPORT_ACCESS_WRITE = "platform.support_access.write"
    AUDIT_VIEW = "platform.audit.view"
    ADMINS_MANAGE = "platform.admins.manage"


PLATFORM_PERMISSION_DESCRIPTIONS = {
    PlatformPerm.TENANTS_VIEW: (
        "View tenant metadata, lifecycle state and provisioning health. "
        "Does NOT grant access to tenant business data."
    ),
    PlatformPerm.TENANTS_MANAGE: (
        "Create tenants and drive lifecycle transitions "
        "(suspend, reactivate, deprovision)."
    ),
    PlatformPerm.SUBSCRIPTIONS_MANAGE: (
        "Assign plans and manage tenant entitlement overrides."
    ),
    PlatformPerm.SUPPORT_ACCESS_CREATE: (
        "Create an expiring, audited read-only support grant for one "
        "tenant."
    ),
    PlatformPerm.SUPPORT_ACCESS_WRITE: (
        "Escalate a support grant to read-write. Separate from creating "
        "a grant so read-only stays the default path."
    ),
    PlatformPerm.AUDIT_VIEW: "Read the platform audit log.",
    PlatformPerm.ADMINS_MANAGE: (
        "Grant or revoke platform administrator access."
    ),
}


def _derive_all() -> tuple:
    """ALL, PlatformPerm sinifindan TURETILIR — elle liste tutulmaz."""
    return tuple(
        sorted(
            v
            for k, v in vars(PlatformPerm).items()
            if not k.startswith("_") and isinstance(v, str)
        )
    )


ALL_PLATFORM_PERMISSIONS = _derive_all()

# Platform izinleri bu on eke SAHIP OLMALIDIR; iki yetki uzayinin
# karismadigi buradan makine ile dogrulanir.
PLATFORM_PERMISSION_PREFIX = "platform."
