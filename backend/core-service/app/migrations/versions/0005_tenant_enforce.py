"""core_db — ENFORCE: NOT NULL, tenant-qualified kisitlar, FORCE RLS

Revision ID: 0005_tenant_enforce
Revises: 0004_tenant_backfill
Create Date: 2026-08-15

CUTOVER SINIRI (runbook §7/§10). Buraya kadar her sey additive'di ve
eski image ayni semayla calisabiliyordu. Bu revizyondan SONRA:

  - tenant_id NOT NULL;
  - global benzersizlikler tenant-qualified;
  - tenant-owned FK'ler (tenant_id, id) uzerinden composite;
  - her tenant tablosunda RLS ENABLE + FORCE + politika;
  - runtime rolune en az yetki.

Geri donus yolu ILERI DUZELTMEDIR. Acil durumda RLS'i genis capta
kapatip trafigi geri acmak YASAKTIR (runbook §10) — kurtarma,
koordineli auth+core backup restore'udur.

ONKOSUL: uygulama kodu tenant baglamini her istekte kurmus olmali
(app/tenant_db.py). Aksi halde tum sorgular sifir satir doner — ki bu
zaten tasarlanan fail-closed davranistir.
"""
import os

from alembic import op

revision = "0005_tenant_enforce"
down_revision = "0004_tenant_backfill"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.migrations.tenant_enforce import apply_enforce

    runtime_role = os.getenv("HERMES_CORE_APP_ROLE", "hermes_core_app")
    report = apply_enforce(op.get_bind(), runtime_role=runtime_role)
    print(
        "✅ enforce: RLS={tables_with_rls} tablo, "
        "unique={unique_constraints_converted}, "
        "fk={foreign_keys_converted}".format(**report),
        flush=True,
    )


def downgrade() -> None:
    # RLS'i toplu kapatmak, tenant izolasyonunu bir anda kaldirir.
    # Bilincli olarak DESTEKLENMEZ: 10_MIGRATION_AND_ROLLOUT_RUNBOOK §10
    # "never broadly disable RLS and reopen application traffic".
    raise NotImplementedError(
        "0005_tenant_enforce geri alinamaz. Kurtarma yolu koordineli "
        "auth+core backup restore'udur; RLS toplu kapatilmaz."
    )
