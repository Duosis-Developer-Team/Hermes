"""P2.2 — uygulama ici bildirim + kanal ayrimi + uyelik rolu kisiti.

TAMAMEN ADDITIVE:
  - `work_item_notifications` (RLS+FORCE, 0007–0011 deseni)
  - `task_notification_settings.email_enabled` / `in_app_enabled`
    (NOT NULL DEFAULT true — eski davranis: iki kanal da acik)
  - `project_memberships.member_role` CHECK (lead|member|viewer|NULL) —
    0010 backfill'i yalniz `member` yazdi, tablo oncesinde bostu
    (06 §1), dolayisiyla mevcut satirlar kisita uyar.

`downgrade` bilerek desteklenmez (bildirimler kullanici verisidir).
"""
from __future__ import annotations

import os

from alembic import op
from sqlalchemy import text

revision = "0012_p2_notifications_channels"
down_revision = "0011_work_items_cutover_sync"
branch_labels = None
depends_on = None


def upgrade() -> None:
    import app.models  # noqa: F401 — TUM modelleri Base'e kaydeder
    from app.database import Base
    from app.migrations.baseline_ddl import P2_NOTIFICATIONS_EXPAND_STATEMENTS
    from app.migrations.tenant_enforce import apply_enforce
    from app.models.work_item import NOTIFICATION_TABLES

    conn = op.get_bind()
    Base.metadata.create_all(
        bind=conn,
        tables=[Base.metadata.tables[name] for name in NOTIFICATION_TABLES],
        checkfirst=True,
    )
    for stmt in P2_NOTIFICATIONS_EXPAND_STATEMENTS:
        conn.execute(text(stmt))
    runtime_role = os.getenv("HERMES_CORE_APP_ROLE", "hermes_core_app")
    report = apply_enforce(conn, runtime_role=runtime_role, only=NOTIFICATION_TABLES)
    print(
        "✅ p2 notifications: {tables_with_rls} tablo RLS+FORCE; kanal sutunlari; "
        "uyelik rolu kisiti".format(**report),
        flush=True,
    )


def downgrade() -> None:
    raise NotImplementedError("bildirimler dusurulmez — kullanici verisidir.")
