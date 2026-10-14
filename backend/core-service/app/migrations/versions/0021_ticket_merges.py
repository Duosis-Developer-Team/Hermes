"""Talep birlestirme (Dalga D1) — ticket_merges (tenant-owned).

TAMAMEN ADDITIVE: tek yeni tablo, RLS + FORCE (0019 deseni). Kaynak talep
`duplicate` koduyla cozulur (mevcut sozlesme alani duplicate_of_ticket_id);
bu tablo kim/ne zaman bilgisini tasir. Hicbir mevcut tablo degismez.

`downgrade` bilerek desteklenmez: talep gecmisidir.
"""
from __future__ import annotations

import os

from alembic import op

revision = "0021_ticket_merges"
down_revision = "0020_ticket_csat"
branch_labels = None
depends_on = None


def upgrade() -> None:
    import app.models  # noqa: F401 — TUM modelleri Base'e kaydeder
    from app.database import Base
    from app.migrations.tenant_enforce import apply_enforce
    from app.models.ticket_helpdesk import TICKET_MERGE_TABLES

    conn = op.get_bind()
    Base.metadata.create_all(
        bind=conn,
        tables=[Base.metadata.tables[name] for name in TICKET_MERGE_TABLES],
        checkfirst=True,
    )
    runtime_role = os.getenv("HERMES_CORE_APP_ROLE", "hermes_core_app")
    report = apply_enforce(conn, runtime_role=runtime_role, only=TICKET_MERGE_TABLES)
    print("✅ ticket merges: {tables_with_rls} tablo RLS+FORCE".format(**report), flush=True)


def downgrade() -> None:
    raise NotImplementedError("birlestirme kaydi dusurulmez — talep gecmisidir.")
