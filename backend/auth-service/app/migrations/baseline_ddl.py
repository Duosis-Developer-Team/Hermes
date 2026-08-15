# =============================================================================
# HERMES auth-service — sema fazlarinin TEK kaynagi (WS1/WS2)
# =============================================================================
# Alembic revizyonlari ve test fixture'lari AYNI fonksiyonlari cagirir.
# Boyle olmazsa test semasi ile uretim semasi sessizce ayrisir: create_all
# eksik TABLO yaratir ama mevcut tabloya eksik KOLON EKLEMEZ — yani
# "testte gecer, uretimde patlar" kaymasi tam olarak buradan cikar.
# =============================================================================

from __future__ import annotations

from typing import List

from sqlalchemy import text

# Cutover ONCESI var olan tablolar.
PRE_TENANT_TABLES = ("users", "rbac_roles", "rbac_user_roles")

# WS2 expand fazinda eklenen kontrol duzlemi tablolari (FK sirasinda).
CONTROL_PLANE_TABLES = (
    "tenants",
    "tenant_domains",
    "tenant_memberships",
    "tenant_identity_providers",
    "plans",
    "plan_entitlements",
    "tenant_subscriptions",
    "tenant_entitlement_overrides",
    "tenant_provisioning_operations",
    "platform_admins",
    "support_access_grants",
    "platform_audit_events",
)

# Mevcut tablolara eklenen kolonlar. create_all bunlari EKLEYEMEZ, bu
# yuzden acik ALTER gerekir; hepsi idempotenttir.
EXPAND_STATEMENTS: List[str] = [
    # RBAC tenant-scoped hale gelir. NOT NULL 0004'te verilir; su an
    # mevcut satirlarin tenant'i henuz yok (backfill 0003'te).
    "ALTER TABLE rbac_roles ADD COLUMN IF NOT EXISTS tenant_id UUID",
    "ALTER TABLE rbac_user_roles ADD COLUMN IF NOT EXISTS tenant_id UUID",
    "CREATE INDEX IF NOT EXISTS idx_rbac_roles_tenant "
    "ON rbac_roles(tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_rbac_user_roles_tenant_user "
    "ON rbac_user_roles(tenant_id, user_id)",
    # Oturum iptali: uyelik/tenant durumu degisince artirilir.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS "
    "session_version INTEGER NOT NULL DEFAULT 1",
]


def _create(conn, table_names) -> None:
    import app.models  # noqa: F401 — modelleri Base'e kaydeder
    from app.database import Base

    Base.metadata.create_all(
        bind=conn,
        tables=[Base.metadata.tables[name] for name in table_names],
        checkfirst=True,
    )


def apply_baseline(conn) -> None:
    """Cutover ONCESI sema (0001_baseline)."""
    _create(conn, PRE_TENANT_TABLES)


def apply_control_plane(conn) -> None:
    """Tenant kontrol duzlemi + expand kolonlari (0002)."""
    _create(conn, CONTROL_PLANE_TABLES)
    for stmt in EXPAND_STATEMENTS:
        conn.execute(text(stmt))


def apply_all(conn) -> None:
    """Testler icin: bugunku head semasinin tamami."""
    apply_baseline(conn)
    apply_control_plane(conn)
