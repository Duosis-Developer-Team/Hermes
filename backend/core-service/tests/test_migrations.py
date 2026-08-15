# =============================================================================
# WS1 — Migration cercevesi kapilari (core_db)
# =============================================================================
# Bu dosya, sema otoritesinin gercekten Alembic'te oldugunu MAKINE ile
# dogrular. Uc sinif kapi var:
#
#   1) Yapisal: uygulama startup'i artik DDL kosMAMALI.
#   2) Fonksiyonel: BOS veritabani -> head basarili olmali.
#   3) Idempotency: ayni migration ikinci kez kosunca hicbir sey
#      degismemeli (mevcut hermes-dev verisi ustunde guvenle kosar).
#
# Gercek Postgres gerekir; yoksa testler SKIP olur (foundation testleri
# etkilenmez) — conftest.py'deki TEST_DB_URL ile ayni sunucu kullanilir.
# =============================================================================

import os
import re
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

from .conftest import TEST_DB_URL

_ROOT = Path(__file__).resolve().parent.parent          # core-service/
_BACKEND = _ROOT.parent                                  # backend/


# =============================================================================
# 1) Yapisal kapi — startup'ta DDL YOK
# =============================================================================

def test_startup_runs_no_ddl():
    """main.py sema degistiren hicbir ifade icermemeli.

    Cok podlu bir rollout'ta startup DDL'i, ayni ALTER'i yarisan podlar
    demektir. Tenant cutover'i bunu kaldiramaz — bu yuzden yapisal
    olarak yasakliyoruz.
    """
    source = (_ROOT / "app" / "main.py").read_text(encoding="utf-8")
    # Yorum satirlarini at: aciklama metinlerinde "create_all" gecebilir.
    code = "\n".join(
        line for line in source.splitlines()
        if not line.lstrip().startswith("#")
    )
    forbidden = [
        "create_all", "ALTER TABLE", "CREATE INDEX", "CREATE TABLE",
        "CREATE SEQUENCE", "DROP CONSTRAINT", "CREATE TRIGGER",
        "CREATE OR REPLACE FUNCTION",
    ]
    hits = [needle for needle in forbidden if needle in code]
    assert not hits, (
        f"main.py hala DDL iceriyor: {hits}. Sema degisiklikleri "
        "app/migrations/versions/ altina tasinmalidir."
    )


def test_database_module_exposes_no_schema_helpers():
    """init_db/drop_db gibi create_all kisayollari geri gelmemeli."""
    from app import database

    assert not hasattr(database, "init_db")
    assert not hasattr(database, "drop_db")


def test_single_migration_head():
    """Coklu head, hangi semanin gecerli oldugunu belirsizlestirir."""
    from alembic.script import ScriptDirectory

    script = ScriptDirectory(str(_ROOT / "app" / "migrations"))
    heads = script.get_heads()
    assert len(heads) == 1, f"Tek head bekleniyor, bulunan: {heads}"


# =============================================================================
# Yardimci: tek kullanimlik veritabani
# =============================================================================

@pytest.fixture()
def disposable_db():
    """Bu test icin tek kullanimlik bos bir veritabani yaratir."""
    admin_url = TEST_DB_URL
    name = f"hermes_mig_{uuid.uuid4().hex[:12]}"
    admin = create_engine(admin_url, isolation_level="AUTOCOMMIT",
                          pool_pre_ping=True)
    try:
        with admin.connect() as conn:
            conn.execute(text(f'CREATE DATABASE "{name}"'))
    except Exception:  # noqa: BLE001 — DB yoksa/yetki yoksa atla
        admin.dispose()
        pytest.skip("disposable veritabani yaratilamadi")

    yield re.sub(r"/[^/]+$", f"/{name}", admin_url)

    with admin.connect() as conn:
        conn.execute(text(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE datname = :n"
        ), {"n": name})
        conn.execute(text(f'DROP DATABASE IF EXISTS "{name}"'))
    admin.dispose()


def _run_migration(url: str) -> None:
    import sys

    for path in (str(_ROOT), str(_BACKEND)):
        if path not in sys.path:
            sys.path.insert(0, path)
    from shared.migration_runner import upgrade

    upgrade("core", "head", database_url=url)


def _table_names(url: str) -> set:
    engine = create_engine(url)
    try:
        with engine.connect() as conn:
            rows = conn.execute(text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public'"
            )).scalars().all()
    finally:
        engine.dispose()
    return set(rows)


# =============================================================================
# 2) Fonksiyonel kapi — bos DB -> head
# =============================================================================

def test_fresh_database_upgrades_to_head(disposable_db):
    """BOS veritabani, TUM ORM tablolarini iceren semaya yukselmeli."""
    _run_migration(disposable_db)

    import app.models  # noqa: F401
    from app.database import Base

    produced = _table_names(disposable_db)
    expected = set(Base.metadata.tables.keys())
    missing = expected - produced
    assert not missing, f"migration sonrasi eksik tablo: {sorted(missing)}"
    assert "alembic_version" in produced


def test_fresh_database_has_type_number_trigger(disposable_db):
    """Production paritesi: per-type numaralandirma trigger'i kurulmali."""
    _run_migration(disposable_db)

    engine = create_engine(disposable_db)
    try:
        with engine.connect() as conn:
            found = conn.execute(text(
                "SELECT 1 FROM pg_trigger "
                "WHERE tgname = 'trg_assign_type_number'"
            )).first()
    finally:
        engine.dispose()
    assert found is not None


# =============================================================================
# 3) Idempotency kapisi — ikinci kosu hicbir sey degistirmemeli
# =============================================================================

def test_migration_is_idempotent_and_preserves_rows(disposable_db):
    """Var olan veri ustunde ikinci kosu: satirlar ve kodlar AYNEN kalir.

    hermes-dev veritabani migration'i birden fazla kez gorebilir
    (retry, yeniden deploy). Task kodlarinin (TASK-56 gibi) yeniden
    numaralanmasi kabul edilemez.
    """
    _run_migration(disposable_db)

    engine = create_engine(disposable_db)
    customer_id = uuid.uuid4()
    project_id = uuid.uuid4()
    try:
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO customers (id, name, is_active, created_at) "
                "VALUES (:id, 'Musteri', true, now())"
            ), {"id": customer_id})
            conn.execute(text(
                "INSERT INTO projects (id, customer_id, name, is_active, "
                "created_at) VALUES (:id, :cid, 'Proje', true, now())"
            ), {"id": project_id, "cid": customer_id})
            for title, ttype in (("Gorev", "task"), ("Talep", "suggestion")):
                conn.execute(text(
                    "INSERT INTO tasks (id, customer_id, project_id, title, "
                    "assignee_user_id, assigner_user_id, scheduled_date, "
                    "task_type, priority, status, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :cid, :pid, :t, "
                    "gen_random_uuid(), gen_random_uuid(), current_date, "
                    ":tt, 'medium', 'pending', now(), now())"
                ), {"cid": customer_id, "pid": project_id, "t": title,
                    "tt": ttype})

        snapshot_sql = text(
            "SELECT task_type, task_number, type_number FROM tasks "
            "ORDER BY task_number"
        )
        with engine.connect() as conn:
            before = conn.execute(snapshot_sql).all()

        _run_migration(disposable_db)      # ikinci kosu
        _run_migration(disposable_db)      # ucuncu kosu

        with engine.connect() as conn:
            after = conn.execute(snapshot_sql).all()
            count = conn.execute(
                text("SELECT count(*) FROM tasks")
            ).scalar()
    finally:
        engine.dispose()

    assert count == 2
    assert before == after, (
        "migration tekrar kosunca task numaralari degisti — mevcut "
        "task kodlari bozulur"
    )


# =============================================================================
# 4) Sema uyumluluk kapisi
# =============================================================================

def test_schema_guard_rejects_unmigrated_database(disposable_db):
    """Migration kosMAMIS bir DB'ye karsi pod acilmamali."""
    import sys

    for path in (str(_ROOT), str(_BACKEND)):
        if path not in sys.path:
            sys.path.insert(0, path)
    from shared.schema_guard import (
        SchemaCompatibilityError, verify_schema_compatibility,
    )

    engine = create_engine(disposable_db)
    try:
        with pytest.raises(SchemaCompatibilityError):
            verify_schema_compatibility("core", engine)

        _run_migration(disposable_db)
        # head revizyon adi degistikce test kirilmasin.
        from alembic.script import ScriptDirectory

        heads = ScriptDirectory(
            str(_ROOT / "app" / "migrations")
        ).get_heads()
        assert verify_schema_compatibility("core", engine) in heads
    finally:
        engine.dispose()
