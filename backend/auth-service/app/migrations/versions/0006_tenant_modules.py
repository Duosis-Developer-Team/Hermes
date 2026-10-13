"""auth_db — tenant modul secimi (tenants.enabled_modules)

Revision ID: 0006_tenant_modules
Revises: 0005_user_photos
Create Date: 2026-10-14

Yon: ILERI ve ADDITIVE. `tenants` tablosuna tek kolon eklenir:
`enabled_modules JSONB NOT NULL DEFAULT <tum katalog>`. PostgreSQL mevcut
satirlari varsayilanla doldurur → her mevcut tenant TUM modullere acik
kalir; bugunku davranis degismez. Hicbir satir silinmez/degistirilmez,
eski image bu kolonu okumadan calismaya devam eder.

Katalog: shared/modules.py (docs/tenant-platform/00-plan.md §2).
"""

from alembic import op

revision = "0006_tenant_modules"
down_revision = "0005_user_photos"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.migrations.baseline_ddl import apply_tenant_modules

    apply_tenant_modules(op.get_bind())


def downgrade() -> None:
    # Kolonu dusurmek tenant konfigurasyonunu silmektir; desteklenmiyor.
    raise NotImplementedError(
        "Geri alinamaz: tenants.enabled_modules dusurulmez (veri silme yok)."
    )
