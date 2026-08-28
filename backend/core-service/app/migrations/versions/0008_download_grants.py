"""ticket_download_grants — tek kullanimlik indirme izni.

TAMAMEN ADDITIVE: yalnizca YENI bir tablo yaratir. Mevcut hicbir tabloya
dokunmaz, veri tasimaz, hicbir sey dusurmez.

`downgrade` bilerek desteklenmez: tabloyu dusurmek, o an acik olan
indirme izinlerini sessizce gecersiz kilmak disinda bir sey yapmaz ama
0007'deki karari (ticket verisinde downgrade YOK) tutarli birakmak icin
ayni cizgide durulur.
"""
from __future__ import annotations

import os

from alembic import op

revision = "0008_download_grants"
down_revision = "0007_ticketing_foundation"
branch_labels = None
depends_on = None

_TABLES = ("ticket_download_grants",)


def upgrade() -> None:
    import app.models  # noqa: F401 — TUM modelleri Base'e kaydeder
    from app.database import Base
    from app.migrations.tenant_enforce import apply_enforce

    conn = op.get_bind()

    Base.metadata.create_all(
        bind=conn,
        tables=[Base.metadata.tables[name] for name in _TABLES],
        checkfirst=True,
    )

    # RLS/FORCE + composite FK'ler 0007 ile AYNI yardimcidan gelir;
    # `only=` kapsami yalnizca yeni tabloyu daraltir, ebeveynler tum
    # envanterde aranir (bkz. tenant_enforce.convert_foreign_keys).
    runtime_role = os.getenv("HERMES_CORE_APP_ROLE", "hermes_core_app")
    report = apply_enforce(conn, runtime_role=runtime_role, only=_TABLES)
    print(
        "✅ download grants: {tables_with_rls} tablo RLS+FORCE, "
        "fk={foreign_keys_converted}".format(**report),
        flush=True,
    )


def downgrade() -> None:
    raise NotImplementedError(
        "ticket_download_grants dusurulmez — 0007 ile ayni karar."
    )
