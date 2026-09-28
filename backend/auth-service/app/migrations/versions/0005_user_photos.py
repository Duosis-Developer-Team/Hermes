"""auth_db — kullanici profil fotograflari (Microsoft Graph)

Revision ID: 0005_user_photos
Revises: 0004_email_domain_idp
Create Date: 2026-09-29

Yon: ILERI ve ADDITIVE. Yalnizca yeni `user_photos` tablosu yaratilir
(user_id PK + FK users ON DELETE CASCADE). Mevcut hicbir tablo/kolon
degismez; eski image bu semayla calismaya devam eder (tabloyu okumaz).

`users` GLOBAL kimliktir, fotograf da kimligin ozelligidir: tablo
tenant sutunu almaz. Tenant gorunurlugu okuma ucunda uyelikle uygulanir.
"""

from alembic import op

revision = "0005_user_photos"
down_revision = "0004_email_domain_idp"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.migrations.baseline_ddl import apply_user_photos

    apply_user_photos(op.get_bind())


def downgrade() -> None:
    # Tabloyu dusurmek kullanici verisi silmektir; bilerek desteklenmiyor.
    raise NotImplementedError(
        "Geri alinamaz: user_photos dusurulmez (veri silme yok)."
    )
