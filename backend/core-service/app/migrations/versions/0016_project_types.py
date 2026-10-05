"""Proje turu + jenerik proje logosu — `project_types`, projects'e iki kolon.

TAMAMEN ADDITIVE:
  - BIR yeni tenant-owned tablo (`project_types`: ad + renk anahtari),
  - `projects`e iki NULL'a izin veren kolon: `project_type_id` (FK, ON
    DELETE SET NULL) ve `logo_glyph` (jenerik logo glifi).
Mevcut hicbir satir degismez, veri tasinmaz, hicbir sey dusurulmez;
projelerin turleri sonradan (uygulama ya da yonetici) atanir.

Desen 0014/0015 ile ayni: create_all(tables=...) + apply_enforce(only=...)
— NOT NULL tenant_id, tenant-qualified benzersizlik, composite FK ve
RLS+FORCE ayni yardimcidan gelir. `projects` de kapsama alinir: yeni FK'si
(tenant_id, project_type_id) composite'ine cevrilsin (diger kisitlari
zaten donusmus — enforce idempotent, onlara dokunmaz).

`downgrade` bilerek desteklenmez: turler ve atamalar kullanici verisidir.
"""
from __future__ import annotations

import os

from alembic import op

revision = "0016_project_types"
down_revision = "0015_project_logos"
branch_labels = None
depends_on = None


def upgrade() -> None:
    import app.models  # noqa: F401 — TUM modelleri Base'e kaydeder
    from app.database import Base
    from app.migrations.baseline_ddl import apply_project_types_expand
    from app.migrations.tenant_enforce import apply_enforce
    from app.models.project_type import PROJECT_TYPE_TABLES

    conn = op.get_bind()
    Base.metadata.create_all(
        bind=conn,
        tables=[Base.metadata.tables[name] for name in PROJECT_TYPE_TABLES],
        checkfirst=True,
    )
    apply_project_types_expand(conn)
    runtime_role = os.getenv("HERMES_CORE_APP_ROLE", "hermes_core_app")
    report = apply_enforce(
        conn, runtime_role=runtime_role, only=PROJECT_TYPE_TABLES + ("projects",),
    )
    print(
        "✅ project types: {tables_with_rls} tablo RLS+FORCE, "
        "fk={foreign_keys_converted}".format(**report),
        flush=True,
    )


def downgrade() -> None:
    raise NotImplementedError("proje turleri dusurulmez — kullanici verisidir.")
