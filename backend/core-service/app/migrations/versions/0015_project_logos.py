"""Proje logosu — `project_logos` (proje basina opsiyonel marka gorseli).

TAMAMEN ADDITIVE: yalnizca BIR yeni tenant-owned tablo yaratir. Mevcut
hicbir tabloya dokunmaz, veri tasimaz, hicbir sey dusurmez.

Desen 0014 ile ayni: create_all(tables=...) + apply_enforce(only=...)
— NOT NULL tenant_id, (tenant_id, project_id) benzersizligi, composite FK
(projects'e ON DELETE CASCADE) ve RLS+FORCE ayni yardimcidan gelir.

`downgrade` bilerek desteklenmez: logolar kullanici verisidir.
"""
from __future__ import annotations

import os

from alembic import op

revision = "0015_project_logos"
down_revision = "0014_customer_logos"
branch_labels = None
depends_on = None


def upgrade() -> None:
    import app.models  # noqa: F401 — TUM modelleri Base'e kaydeder
    from app.database import Base
    from app.migrations.tenant_enforce import apply_enforce
    from app.models.project_logo import PROJECT_LOGO_TABLES

    conn = op.get_bind()
    Base.metadata.create_all(
        bind=conn,
        tables=[Base.metadata.tables[name] for name in PROJECT_LOGO_TABLES],
        checkfirst=True,
    )
    runtime_role = os.getenv("HERMES_CORE_APP_ROLE", "hermes_core_app")
    report = apply_enforce(conn, runtime_role=runtime_role, only=PROJECT_LOGO_TABLES)
    print(
        "✅ project logos: {tables_with_rls} tablo RLS+FORCE, "
        "fk={foreign_keys_converted}".format(**report),
        flush=True,
    )


def downgrade() -> None:
    raise NotImplementedError("proje logolari dusurulmez — kullanici verisidir.")
