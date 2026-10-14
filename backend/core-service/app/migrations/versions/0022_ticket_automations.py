"""Talep otomasyon kurallari (Dalga D2) — 2 yeni tenant-owned tablo.

TAMAMEN ADDITIVE:
  - ticket_automations, ticket_automation_runs (RLS + FORCE, 0019 deseni);
  - ticket_notifications.kind kisiti GENISLETILIR ('automation' eklenir):
    mevcut satirlarin hepsi yeni kisiti saglar, hicbir veri degismez.

`downgrade` bilerek desteklenmez: kural ve calisma gecmisi konfigurasyondur.
"""
from __future__ import annotations

import os

from alembic import op

revision = "0022_ticket_automations"
down_revision = "0021_ticket_merges"
branch_labels = None
depends_on = None

def upgrade() -> None:
    import app.models  # noqa: F401 — TUM modelleri Base'e kaydeder
    from app.database import Base
    from app.migrations.tenant_enforce import apply_enforce
    from app.models.ticket_helpdesk import TICKET_AUTOMATION_TABLES

    conn = op.get_bind()
    Base.metadata.create_all(
        bind=conn,
        tables=[Base.metadata.tables[name] for name in TICKET_AUTOMATION_TABLES],
        checkfirst=True,
    )
    # Genisletme (veri degismez): baseline_ddl ile ayni tek tanim.
    from app.migrations.baseline_ddl import apply_ticket_notification_kinds

    apply_ticket_notification_kinds(conn)
    runtime_role = os.getenv("HERMES_CORE_APP_ROLE", "hermes_core_app")
    report = apply_enforce(conn, runtime_role=runtime_role, only=TICKET_AUTOMATION_TABLES)
    print("✅ ticket automations: {tables_with_rls} tablo RLS+FORCE".format(**report), flush=True)


def downgrade() -> None:
    raise NotImplementedError("otomasyon kurallari dusurulmez — konfigurasyondur.")
