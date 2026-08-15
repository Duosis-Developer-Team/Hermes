"""core_db baseline — tenant cutover ONCESI semanin otoriter tarifi

Revision ID: 0001_baseline
Revises:
Create Date: 2026-08-15

Bu revizyon, `app/main.py` startup'inda kosan `init_db()` (create_all) +
13 ad-hoc `_migrate_*` fonksiyonunun tam karsiligidir. Boylece:

  - BOS bir veritabani → bugunku semayi bire bir uretir;
  - MEVCUT hermes-dev/hermes-test veritabani → hicbir sey degistirmez
    (butun ifadeler IF NOT EXISTS / IF EXISTS korumali).

Bundan sonraki tum sema degisiklikleri ayri revizyonlardir; uygulama
startup'i artik DDL kosmaz.
"""
from app.migrations.baseline_ddl import apply_baseline
from alembic import op

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    apply_baseline(op.get_bind())


def downgrade() -> None:
    # Baseline geri alinamaz: bu revizyonun "oncesi" bos veritabanidir ve
    # tum uretim verisi burada yasar. Geri donus yolu backup restore'dur.
    raise NotImplementedError(
        "0001_baseline geri alinamaz — kurtarma yolu koordineli "
        "auth+core backup restore'udur."
    )
