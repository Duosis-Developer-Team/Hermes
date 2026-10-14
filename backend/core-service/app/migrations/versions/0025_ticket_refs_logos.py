"""Musteriye gore talep numarasi + talebe bagli efor + sirket logosu.

ADDITIVE:
  - support_source_tenants.next_ticket_seq, tickets.customer_seq (+ kismi
    benzersiz indeks): arayuzde "Defacto Ticket-001". Mevcut talepler musteri
    basina kanonik numara sirasiyla 1..n doldurulur (migrator BYPASSRLS).
    Kanonik `number` (TKT-000123, LogiSlot sozlesmesi) DEGISMEZ.
  - work_logs.ticket_id (+ indeks): talep cozulunce girilen efor talebe
    mantiksal olarak baglanir.
  - company_logos: sirket hesabi logosu (tenant-owned, RLS + FORCE).
"""
from __future__ import annotations

import os

from alembic import op

revision = "0025_ticket_refs_logos"
down_revision = "0024_ticket_mail"
branch_labels = None
depends_on = None


def upgrade() -> None:
    import app.models  # noqa: F401 — TUM modelleri Base'e kaydeder
    from app.database import Base
    from app.migrations.baseline_ddl import apply_ticket_customer_refs
    from app.migrations.tenant_enforce import apply_enforce
    from app.models.company_logo import COMPANY_LOGO_TABLES

    conn = op.get_bind()
    apply_ticket_customer_refs(conn)
    Base.metadata.create_all(
        bind=conn,
        tables=[Base.metadata.tables[name] for name in COMPANY_LOGO_TABLES],
        checkfirst=True,
    )
    runtime_role = os.getenv("HERMES_CORE_APP_ROLE", "hermes_core_app")
    report = apply_enforce(conn, runtime_role=runtime_role, only=COMPANY_LOGO_TABLES)
    print("✅ ticket refs + company logos: {tables_with_rls} tablo RLS+FORCE".format(**report), flush=True)


def downgrade() -> None:
    raise NotImplementedError("geri alinamaz (veri silme yok).")
