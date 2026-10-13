"""Tenant modulleri — tenant_registry.enabled_modules (auth projeksiyonu).

TAMAMEN ADDITIVE: `tenant_registry`'ye tek kolon eklenir (JSONB, NOT NULL,
varsayilan TUM katalog). PostgreSQL mevcut satirlari varsayilanla doldurur
→ her mevcut tenant tum modullere acik kalir; davranis degismez. Gercek
deger auth `tenants.enabled_modules`'tan `/internal/tenants/projection`
ile gelir. Hicbir satir silinmez/degistirilmez.

`tenant_registry` tenant-owned DEGILDIR (RLS'siz projeksiyon); enforce fazi
gerekmez.

`downgrade` bilerek desteklenmez: tenant konfigurasyonudur.
"""
from __future__ import annotations

from alembic import op

revision = "0017_tenant_modules"
down_revision = "0016_project_types"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.migrations.baseline_ddl import apply_tenant_modules

    apply_tenant_modules(op.get_bind())
    print("✅ tenant modules: tenant_registry.enabled_modules", flush=True)


def downgrade() -> None:
    raise NotImplementedError("tenant modulleri dusurulmez — konfigurasyondur.")
