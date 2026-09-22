"""P2.3 / F1 — is kalemine ek dosya: ticket_attachments exclusive-arc'ina
`work_item_id` (CTO karari P2-4: tablo yerinde genellesir; ad, ticket
akisi, CronJob ve LogiSlot indirme akisi degismez).

TAMAMEN ADDITIVE: bir nullable kolon + index; `attached_needs_ticket`
kisiti is kalemini de kabul edecek sekilde YENIDEN tanimlanir ve yeni
`work_item_exclusive` kisiti eklenir (is kalemi eki ticket/mesaj/cozum
sahipligiyle birlikte olamaz). Mevcut satirlar (hepsi ticket'a bagli)
her iki kisita uyar.

`downgrade` bilerek desteklenmez (ek metadata'si kullanici verisidir).
"""
from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "0013_p2_work_item_attachments"
down_revision = "0012_p2_notifications_channels"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.migrations.baseline_ddl import P2_ATTACHMENTS_EXPAND_STATEMENTS

    conn = op.get_bind()
    for stmt in P2_ATTACHMENTS_EXPAND_STATEMENTS:
        conn.execute(text(stmt))
    print("✅ p2 attachments: ticket_attachments.work_item_id + arc kisitlari", flush=True)


def downgrade() -> None:
    raise NotImplementedError("is kalemi eki kolonu dusurulmez — ek metadata'si kullanici verisidir.")
