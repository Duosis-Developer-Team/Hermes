"""core_db — tenant-owned tablolara tenant_id (expand fazi)

Revision ID: 0003_tenant_expand
Revises: 0002_tenant_projection
Create Date: 2026-08-15

EXPAND (10_MIGRATION_AND_ROLLOUT_RUNBOOK.md §4): 33 tenant-owned tabloya
NULLABLE `tenant_id` + index eklenir. Hicbir satir degismez, hicbir kisit
siklasmaz; eski image bu semayla calismaya DEVAM EDER (rollback siniri).

Tablo listesi ELLE TUTULMAZ: `TenantOwnedMixin` tasiyan siniflardan
turetilir. Yeni bir tenant tablosu eklendiginde bu migration'i guncellemek
gerekmez ve tablo sessizce kapsam disi kalamaz.

Sonraki fazlar:
  0004 — ilk Duosis tenant'ina backfill (idempotent)
  0005 — NOT NULL + tenant-qualified unique/FK + FORCE RLS
"""
from alembic import op

revision = "0003_tenant_expand"
down_revision = "0002_tenant_projection"
branch_labels = None
depends_on = None


def _tables():
    from app.models.mixins import tenant_owned_tables

    return tenant_owned_tables()


def upgrade() -> None:
    # Ifadelerin TEK kaynagi baseline_ddl'dir; test fixture'lari da ayni
    # fonksiyonu cagirir, boylece test semasi uretimden ayrisamaz.
    from app.migrations.baseline_ddl import apply_tenant_expand

    apply_tenant_expand(op.get_bind())


def downgrade() -> None:
    for table in _tables():
        op.execute(f"DROP INDEX IF EXISTS idx_{table}_tenant")
        op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS tenant_id")
