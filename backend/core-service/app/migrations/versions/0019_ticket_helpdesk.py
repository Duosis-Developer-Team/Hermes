"""Talep yonetimi helpdesk katmani (Dalga B) — 9 yeni tenant-owned tablo.

TAMAMEN ADDITIVE: SLA politikasi + talep basina SLA saati, etiketler,
hazir yanitlar, kayitli gorunumler, takipciler, okundu bilgisi, uygulama
ici talep bildirimleri. Mevcut hicbir tabloya dokunulmaz; donmus ticket
sozlesmesi (olay turleri, outbox alanlari) DEGISMEZ.

Desen 0016 ile ayni: create_all(tables=...) + apply_enforce(only=...)
(RLS + FORCE + bilesik FK'ler). Bos tablolar: geri doldurma yok.

`downgrade` bilerek desteklenmez: talep verisidir.
"""
from __future__ import annotations

import os

from alembic import op

revision = "0019_ticket_helpdesk"
down_revision = "0018_ticket_network"
branch_labels = None
depends_on = None


def upgrade() -> None:
    import app.models  # noqa: F401 — TUM modelleri Base'e kaydeder
    from app.database import Base
    from app.migrations.tenant_enforce import apply_enforce
    from app.models.ticket_helpdesk import TICKET_HELPDESK_TABLES

    conn = op.get_bind()
    Base.metadata.create_all(
        bind=conn,
        tables=[Base.metadata.tables[name] for name in TICKET_HELPDESK_TABLES],
        checkfirst=True,
    )
    runtime_role = os.getenv("HERMES_CORE_APP_ROLE", "hermes_core_app")
    report = apply_enforce(conn, runtime_role=runtime_role, only=TICKET_HELPDESK_TABLES)
    print(
        "✅ ticket helpdesk: {tables_with_rls} tablo RLS+FORCE, "
        "fk={foreign_keys_converted}".format(**report),
        flush=True,
    )


def downgrade() -> None:
    raise NotImplementedError("helpdesk tablolari dusurulmez — talep verisidir.")
