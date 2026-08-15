"""core_db — tenant projeksiyonu ve sayaclari (expand fazi)

Revision ID: 0002_tenant_projection
Revises: 0001_baseline
Create Date: 2026-08-15

EXPAND fazi: yalnizca EKLER. Bu revizyondan sonra uygulama davranisi
hala tek-tenant'tir.

  - `tenant_registry`: auth kontrol duzleminin core'daki idempotent
    projeksiyonu. core, veritabanlari arasi FK olmadan bilinmeyen veya
    pasif bir tenant'i bununla reddeder.
  - `tenant_counters`: tenant basina atomik numara uretimi. Global
    `task_number_seq` her tenant'a bagimsiz bir seri veremez.

Tenant-owned is tablolarina `tenant_id` eklenmesi ve RLS, sonraki
revizyonlarda (0003 backfill, 0004 enforce) gelir.
"""
from alembic import op

revision = "0002_tenant_projection"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.migrations.baseline_ddl import apply_tenant_projection

    apply_tenant_projection(op.get_bind())


def downgrade() -> None:
    # Expand fazi geri alinabilir: henuz hicbir is verisi bu tablolara
    # bagimli degil.
    op.execute("DROP TABLE IF EXISTS tenant_counters")
    op.execute("DROP TABLE IF EXISTS tenant_registry")
