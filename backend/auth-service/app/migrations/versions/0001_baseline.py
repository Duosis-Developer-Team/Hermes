"""auth_db baseline — tenant cutover ONCESI semanin otoriter tarifi

Revision ID: 0001_baseline
Revises:
Create Date: 2026-08-15

auth-service startup'i `init_db()` (create_all) + `rbac_bootstrap()`
kosuyordu. Sema kismi buraya tasindi; RBAC bootstrap'i VERI seed'idir ve
tenant-scoped hale gelene kadar (0003) uygulamada kalir.

  - BOS bir veritabani → bugunku semayi (users, rbac_roles,
    rbac_user_roles) uretir;
  - MEVCUT veritabani → create_all checkfirst sayesinde hicbir sey
    degistirmez.
"""
from alembic import op

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # DIKKAT: baseline YALNIZCA cutover oncesi uc tabloyu kurar. Tenant
    # kontrol duzlemi tablolari 0002'de gelir — burada tum modelleri
    # create_all etmek, 0002'yi anlamsiz kilardi.
    from app.migrations.baseline_ddl import apply_baseline

    apply_baseline(op.get_bind())


def downgrade() -> None:
    raise NotImplementedError(
        "0001_baseline geri alinamaz — kurtarma yolu koordineli "
        "auth+core backup restore'udur."
    )
