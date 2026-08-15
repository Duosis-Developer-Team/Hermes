"""auth_db — tenant kontrol duzlemi (expand fazi)

Revision ID: 0002_tenant_control_plane
Revises: 0001_baseline
Create Date: 2026-08-15

EXPAND fazi (10_MIGRATION_AND_ROLLOUT_RUNBOOK.md §4): yalnizca EKLER.
Bu revizyondan sonra uygulama davranisi hala tek-tenant'tir; hicbir
mevcut sorgu bozulmaz.

  - 12 kontrol duzlemi tablosu yaratilir;
  - `rbac_roles` / `rbac_user_roles` NULLABLE `tenant_id` alir
    (backfill 0003'te, NOT NULL + tenant-qualified unique 0004'te);
  - `users.session_version` eklenir (oturum iptali icin).

Global `rbac_roles.code` unique kisiti BU FAZDA KALDIRILMAZ: mevcut kod
hala global kod arayabilir. Kaldirma, backfill dogrulandiktan sonra
0004'te yapilir.
"""
import sqlalchemy as sa
from alembic import op

revision = "0002_tenant_control_plane"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None

# Bu revizyonun yarattigi tablolar — sira FK bagimliliklarini izler.
_NEW_TABLES = (
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


def upgrade() -> None:
    # Kontrol duzlemi tablolari + mevcut tablolara eklenen NULLABLE
    # kolonlar. NOT NULL bu fazda VERILMEZ — mevcut satirlarin tenant'i
    # henuz yok (backfill 0003) ve eski image bu semayla calismaya
    # devam edebilmeli (runbook §10, rollback sinirlari).
    from app.migrations.baseline_ddl import apply_control_plane

    apply_control_plane(op.get_bind())


def downgrade() -> None:
    # Expand fazi geri alinabilir: henuz hicbir veri bu tablolara
    # bagimli degil (backfill 0003'te).
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS session_version")
    op.execute("DROP INDEX IF EXISTS idx_rbac_user_roles_tenant_user")
    op.execute("DROP INDEX IF EXISTS idx_rbac_roles_tenant")
    op.execute("ALTER TABLE rbac_user_roles DROP COLUMN IF EXISTS tenant_id")
    op.execute("ALTER TABLE rbac_roles DROP COLUMN IF EXISTS tenant_id")
    for name in reversed(_NEW_TABLES):
        op.execute(f"DROP TABLE IF EXISTS {name} CASCADE")
