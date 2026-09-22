"""Is kalemi temeli — tasks → work_items (PM rework P1.1).

TAMAMEN ADDITIVE: dokuz yeni tablo, iki mevcut tabloya kolon
(projects.is_billable_default, work_logs.work_item_id) ve TEKRAR
KOSULABILIR bir veri tasimasi. `tasks` ailesine YAZILMAZ, hicbir sey
dusurulmez; eski tablolar F05'e kadar dokunulmadan durur (08-p1-plani §8).

Tasima kurallari ve dogrulama: app/migrations/work_item_migration.py.
Dogrulama basarisizsa istisna yukselir ve Alembic transaction'i geri
alinir — yarim tasima kalmaz.

`downgrade` bilerek desteklenmez: tasinmis is kalemleri, alias'lar ve
uyelik backfill'i kullanici verisidir.
"""
from __future__ import annotations

import os

from alembic import op
from sqlalchemy import text

revision = "0010_work_items_foundation"
down_revision = "0009_capacity_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    import app.models  # noqa: F401 — TUM modelleri Base'e kaydeder
    from app.database import Base
    from app.migrations.baseline_ddl import WORK_ITEMS_EXPAND_STATEMENTS
    from app.migrations.tenant_enforce import apply_enforce
    from app.migrations.work_item_migration import migrate_all
    from app.models.work_item import WORK_ITEM_TABLES

    conn = op.get_bind()

    # 1) Yeni tablolar (sira: ebeveynler once — WORK_ITEM_TABLES sirali).
    Base.metadata.create_all(
        bind=conn,
        tables=[Base.metadata.tables[name] for name in WORK_ITEM_TABLES],
        checkfirst=True,
    )

    # 2) Mevcut tablolara kolon (create_all bunu YAPMAZ).
    for stmt in WORK_ITEMS_EXPAND_STATEMENTS:
        conn.execute(text(stmt))

    # 3) RLS/FORCE + tenant-qualified benzersizlik + composite FK — yalniz
    #    yeni tablolar (0007/0008/0009 deseni).
    runtime_role = os.getenv("HERMES_CORE_APP_ROLE", "hermes_core_app")
    report = apply_enforce(conn, runtime_role=runtime_role, only=WORK_ITEM_TABLES)

    # 4) work_logs.work_item_id → work_items: tenant-tutarli composite FK.
    #    ADD COLUMN ile geldigi icin enforce onu gormedi; ayni bicimde
    #    (MATCH SIMPLE, SET NULL yalniz cocuk kolon) elle kurulur.
    #    Temiz DB'de 0001 kolonu tek-kolonlu FK ile yaratir ve 0005 onu
    #    zaten composite'e cevirir — ad degil, KOLON uzerinden kontrol
    #    edilir ki ikinci bir FK eklenmesin.
    exists = conn.execute(text(
        "SELECT 1 FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid "
        "WHERE c.relname = 'work_logs' AND con.contype = 'f' "
        "  AND pg_get_constraintdef(con.oid) LIKE '%work_item_id%' "
        "  AND pg_get_constraintdef(con.oid) LIKE '%tenant_id%'"
    )).first()
    if exists is None:
        conn.execute(text(
            "ALTER TABLE work_logs ADD CONSTRAINT fk_work_logs_work_item "
            "FOREIGN KEY (tenant_id, work_item_id) "
            "REFERENCES work_items (tenant_id, id) ON DELETE SET NULL (work_item_id)"
        ))

    # 5) Veri tasimasi + dogrulama (kiraci basina, tekrar kosulabilir).
    summary = migrate_all(conn)
    total = summary["total"]
    print(
        "✅ work_items: {tables_with_rls} tablo RLS+FORCE; {tenants} kiraci; "
        "{items} is kalemi (+{participants} katilimci, +{aliases} alias, "
        "{skipped} onceden tasinmis grup atlandi); yorum {comments}, olay {events}, "
        "work_log {logs}, uyelik +{members}, routing +{routing}".format(
            tables_with_rls=report["tables_with_rls"],
            tenants=summary["tenants"],
            items=total.get("items_created", 0),
            participants=total.get("participants", 0),
            aliases=total.get("aliases", 0),
            skipped=total.get("skipped_existing", 0),
            comments=total.get("comments_copied", 0),
            events=total.get("events_copied", 0),
            logs=total.get("work_logs_linked", 0),
            members=total.get("memberships_added", 0),
            routing=total.get("routing_copied", 0),
        ),
        flush=True,
    )


def downgrade() -> None:
    raise NotImplementedError(
        "work_items dusurulmez — tasinmis is kalemleri kullanici verisidir."
    )
