"""auth_db — sirket hesaplari + modul erisimi

Revision ID: 0007_company_module_access
Revises: 0006_tenant_modules
Create Date: 2026-10-14

Yon: ILERI ve ADDITIVE.
  - tenant_memberships.account_kind (VARCHAR, NOT NULL DEFAULT 'person'):
    mevcut uyelikler `person` olur → davranis degismez.
  - tenant_module_policies, tenant_module_grants: yeni tablolar. Satir
    yoksa her modul "Herkes"e (tum ic kullanicilar) aciktir → bugunku
    davranis aynen.
Hicbir satir silinmez/degistirilmez; eski image yeni kolonu/tablolari
okumadan calismaya devam eder.

Plan: docs/tenant-platform/01-sirket-hesaplari-ve-modul-erisimi.md.
"""

from alembic import op

revision = "0007_company_module_access"
down_revision = "0006_tenant_modules"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.migrations.baseline_ddl import apply_module_access

    apply_module_access(op.get_bind())


def downgrade() -> None:
    raise NotImplementedError(
        "Geri alinamaz: sirket hesaplari ve erisim kurallari dusurulmez (veri silme yok)."
    )
