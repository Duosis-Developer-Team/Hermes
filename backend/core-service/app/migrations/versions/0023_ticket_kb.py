"""Bilgi bankasi / yardim merkezi (Dalga D3) — kb_categories, kb_articles, kb_votes.

TAMAMEN ADDITIVE: uc yeni tenant-owned tablo, RLS + FORCE (0019 deseni).
Saglayicinin icerigidir; hicbir mevcut tablo degismez.

`downgrade` bilerek desteklenmez: saglayici icerigidir.
"""
from __future__ import annotations

import os

from alembic import op

revision = "0023_ticket_kb"
down_revision = "0022_ticket_automations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    import app.models  # noqa: F401 — TUM modelleri Base'e kaydeder
    from app.database import Base
    from app.migrations.tenant_enforce import apply_enforce
    from app.models.ticket_kb import KB_TABLES

    conn = op.get_bind()
    Base.metadata.create_all(
        bind=conn,
        tables=[Base.metadata.tables[name] for name in KB_TABLES],
        checkfirst=True,
    )
    runtime_role = os.getenv("HERMES_CORE_APP_ROLE", "hermes_core_app")
    report = apply_enforce(conn, runtime_role=runtime_role, only=KB_TABLES)
    print("✅ ticket kb: {tables_with_rls} tablo RLS+FORCE".format(**report), flush=True)


def downgrade() -> None:
    raise NotImplementedError("bilgi bankasi dusurulmez — saglayici icerigidir.")
