"""Kapasite temeli — kiraci varsayilani, tatil, kullanici override, izin.

TAMAMEN ADDITIVE: yalnizca DORT yeni tablo yaratir (PM rework P0 / D1).
Mevcut hicbir tabloya dokunmaz, veri tasimaz, hicbir sey dusurmez.

Neden plan_times'a kolon eklenmedi: 04-roller §8 "plan_times bir
plan_type alani kazanir" demisti; ama plan_times.customer_id ve
project_id NOT NULL — iznin musterisi/projesi yok. Izin ayri tablodur
(user_absences); gerekce app/models/capacity.py basinda.

`downgrade` bilerek desteklenmez: tatil/izin/override kayitlari kullanici
verisidir; dusurmek 0007/0008 ile ayni cizgide veri silmek olurdu.
"""
from __future__ import annotations

import os

from alembic import op

revision = "0009_capacity_foundation"
down_revision = "0008_download_grants"
branch_labels = None
depends_on = None


def upgrade() -> None:
    import app.models  # noqa: F401 — TUM modelleri Base'e kaydeder
    from app.database import Base
    from app.migrations.tenant_enforce import apply_enforce
    from app.models.capacity import CAPACITY_TABLES

    conn = op.get_bind()

    Base.metadata.create_all(
        bind=conn,
        tables=[Base.metadata.tables[name] for name in CAPACITY_TABLES],
        checkfirst=True,
    )

    # RLS/FORCE + tenant-qualified benzersizlikler 0007/0008 ile AYNI
    # yardimcidan; `only=` kapsami yalnizca yeni tablolari daraltir.
    runtime_role = os.getenv("HERMES_CORE_APP_ROLE", "hermes_core_app")
    report = apply_enforce(conn, runtime_role=runtime_role, only=CAPACITY_TABLES)
    print(
        "✅ capacity: {tables_with_rls} tablo RLS+FORCE, "
        "uq={unique_constraints_converted}".format(**report),
        flush=True,
    )


def downgrade() -> None:
    raise NotImplementedError(
        "kapasite tablolari dusurulmez — tatil/izin/override kullanici verisidir."
    )
