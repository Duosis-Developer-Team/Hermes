"""Talep e-posta kanali (Dalga D4) — ticket_mail_settings, ticket_mail_outbox, ticket_mail_inbound.

TAMAMEN ADDITIVE: uc yeni tenant-owned tablo, RLS + FORCE (0019 deseni).
Hicbir mevcut tablo degismez; LogiSlot sozlesmesi (olay turleri, outbox
alanlari) etkilenmez.

`downgrade` bilerek desteklenmez: gelen e-posta kaydi talep gecmisidir.
"""
from __future__ import annotations

import os

from alembic import op

revision = "0024_ticket_mail"
down_revision = "0023_ticket_kb"
branch_labels = None
depends_on = None


def upgrade() -> None:
    import app.models  # noqa: F401 — TUM modelleri Base'e kaydeder
    from app.database import Base
    from app.migrations.tenant_enforce import apply_enforce
    from app.models.ticket_mail import TICKET_MAIL_TABLES

    conn = op.get_bind()
    Base.metadata.create_all(
        bind=conn,
        tables=[Base.metadata.tables[name] for name in TICKET_MAIL_TABLES],
        checkfirst=True,
    )
    runtime_role = os.getenv("HERMES_CORE_APP_ROLE", "hermes_core_app")
    report = apply_enforce(conn, runtime_role=runtime_role, only=TICKET_MAIL_TABLES)
    print("✅ ticket mail: {tables_with_rls} tablo RLS+FORCE".format(**report), flush=True)


def downgrade() -> None:
    raise NotImplementedError("e-posta kanali dusurulmez — gelen e-posta kaydi talep gecmisidir.")
