# =============================================================================
# HERMES PLATFORM - Auth Service Models Package
# =============================================================================
# Bu paket, auth-service veritabanı modellerini içerir.
# Tüm modeller tek bir yerden import edilebilir.
# =============================================================================

from .access import TenantModuleGrant, TenantModulePolicy
from .rbac import RbacRole, RbacUserRole
from .tenancy import (
    Plan,
    PlanEntitlement,
    PlatformAdmin,
    PlatformAuditEvent,
    SupportAccessGrant,
    Tenant,
    TenantDomain,
    TenantEntitlementOverride,
    TenantIdentityProvider,
    TenantMembership,
    TenantProvisioningOperation,
    TenantSubscription,
)
from .user import User
from .user_photo import UserPhoto

__all__ = [
    "User",
    "UserPhoto",
    "RbacRole",
    "TenantModuleGrant",
    "TenantModulePolicy",
    "RbacUserRole",
    # Tenant control-plane (WS2)
    "Tenant",
    "TenantDomain",
    "TenantMembership",
    "TenantIdentityProvider",
    "Plan",
    "PlanEntitlement",
    "TenantSubscription",
    "TenantEntitlementOverride",
    "TenantProvisioningOperation",
    # Platform guvenlik duzlemi (tenant rollerinden AYRI)
    "PlatformAdmin",
    "SupportAccessGrant",
    "PlatformAuditEvent",
]
