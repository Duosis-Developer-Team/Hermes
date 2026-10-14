"""Talep musterisi musteri kaydina baglanir (sirket hesabi musteriden).

ADDITIVE: `support_source_tenants.customer_id` (+ indeks, uygulama basina
musteri tekligi). Mevcut satirlar bos kalir; bag Ayarlar → Kullanicilar →
Sirketler'de musteri secilince kurulur. Satir silinmez/degismez.
"""
from __future__ import annotations

from alembic import op

revision = "0027_source_customer_link"
down_revision = "0026_ticket_mail_kinds"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.migrations.baseline_ddl import apply_source_customer_link

    apply_source_customer_link(op.get_bind())
    print("✅ source tenant → customer link", flush=True)


def downgrade() -> None:
    raise NotImplementedError("geri alinamaz (veri silme yok).")
