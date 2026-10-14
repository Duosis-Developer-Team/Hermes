"""Talep e-postasi turleri genisler (her olayda iki taraf).

ADDITIVE: `ticket_mail_outbox.kind` kisiti yeni turlerle DEGISTIRILIR
(alindi her kanalda, isleme alindi, musterinin kendi yanit kopyasi; ekibe
yeni talep, ekip yaniti kopyasi, cozum). Satir silinmez/degismez.
"""
from __future__ import annotations

from alembic import op

revision = "0026_ticket_mail_kinds"
down_revision = "0025_ticket_refs_logos"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.migrations.baseline_ddl import apply_ticket_mail_kinds

    apply_ticket_mail_kinds(op.get_bind())
    print("✅ ticket mail kinds widened", flush=True)


def downgrade() -> None:
    raise NotImplementedError("geri alinamaz (veri silme yok).")
