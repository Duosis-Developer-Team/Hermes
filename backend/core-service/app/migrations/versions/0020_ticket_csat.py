"""Talep memnuniyeti (Dalga C) — ticket_csat (tenant-owned).

TAMAMEN ADDITIVE: tek yeni tablo, RLS + FORCE (0019 deseni). Talep basina
tek puan (1–5) + yorum. Sozlesme olayi uretmez; hicbir mevcut tablo
degismez.

`downgrade` bilerek desteklenmez: musteri geri bildirimidir.
"""
from __future__ import annotations

import os

from alembic import op

revision = "0020_ticket_csat"
down_revision = "0019_ticket_helpdesk"
branch_labels = None
depends_on = None


def upgrade() -> None:
    import app.models  # noqa: F401 — TUM modelleri Base'e kaydeder
    from app.database import Base
    from app.migrations.tenant_enforce import apply_enforce
    from app.models.ticket_helpdesk import TICKET_CSAT_TABLES

    conn = op.get_bind()
    Base.metadata.create_all(
        bind=conn,
        tables=[Base.metadata.tables[name] for name in TICKET_CSAT_TABLES],
        checkfirst=True,
    )
    runtime_role = os.getenv("HERMES_CORE_APP_ROLE", "hermes_core_app")
    report = apply_enforce(conn, runtime_role=runtime_role, only=TICKET_CSAT_TABLES)
    print("✅ ticket csat: {tables_with_rls} tablo RLS+FORCE".format(**report), flush=True)


def downgrade() -> None:
    raise NotImplementedError("CSAT dusurulmez — musteri geri bildirimidir.")
