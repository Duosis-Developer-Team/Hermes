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
    from app.database import Base
    from app.models import rbac, user  # noqa: F401 — Base'e kaydeder

    Base.metadata.create_all(bind=op.get_bind(), checkfirst=True)


def downgrade() -> None:
    raise NotImplementedError(
        "0001_baseline geri alinamaz — kurtarma yolu koordineli "
        "auth+core backup restore'udur."
    )
