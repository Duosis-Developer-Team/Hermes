# =============================================================================
# WS1 — Migration cercevesi kapilari (auth_db)
# =============================================================================
# core-service/tests/test_migrations.py ile ayni sozlesme; auth tarafinda
# sema kucuk oldugu icin kapilar da dardir. Ayrintili gerekce icin core
# dosyasina bakin.
# =============================================================================

import re
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

from .conftest import TEST_DB_URL

_ROOT = Path(__file__).resolve().parent.parent          # auth-service/
_BACKEND = _ROOT.parent                                  # backend/


def test_startup_runs_no_ddl():
    """auth main.py sema degistiren ifade icermemeli."""
    source = (_ROOT / "app" / "main.py").read_text(encoding="utf-8")
    code = "\n".join(
        line for line in source.splitlines()
        if not line.lstrip().startswith("#")
    )
    forbidden = ["create_all", "ALTER TABLE", "CREATE TABLE",
                 "CREATE INDEX", "CREATE SEQUENCE"]
    hits = [needle for needle in forbidden if needle in code]
    assert not hits, f"main.py hala DDL iceriyor: {hits}"


def test_database_module_exposes_no_schema_helpers():
    from app import database

    assert not hasattr(database, "init_db")
    assert not hasattr(database, "drop_db")


def test_single_migration_head():
    from alembic.script import ScriptDirectory

    script = ScriptDirectory(str(_ROOT / "app" / "migrations"))
    heads = script.get_heads()
    assert len(heads) == 1, f"Tek head bekleniyor, bulunan: {heads}"


@pytest.fixture()
def disposable_db():
    name = f"hermes_mig_auth_{uuid.uuid4().hex[:12]}"
    admin = create_engine(TEST_DB_URL, isolation_level="AUTOCOMMIT",
                          pool_pre_ping=True)
    try:
        with admin.connect() as conn:
            conn.execute(text(f'CREATE DATABASE "{name}"'))
    except Exception:  # noqa: BLE001
        admin.dispose()
        pytest.skip("disposable veritabani yaratilamadi")

    yield re.sub(r"/[^/]+$", f"/{name}", TEST_DB_URL)

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

    upgrade("auth", "head", database_url=url)


def test_fresh_database_upgrades_to_head(disposable_db):
    _run_migration(disposable_db)

    from app.database import Base
    from app.models import rbac, user  # noqa: F401

    engine = create_engine(disposable_db)
    try:
        with engine.connect() as conn:
            produced = set(conn.execute(text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public'"
            )).scalars().all())
    finally:
        engine.dispose()

    missing = set(Base.metadata.tables.keys()) - produced
    assert not missing, f"migration sonrasi eksik tablo: {sorted(missing)}"
    assert "alembic_version" in produced


def test_migration_is_idempotent(disposable_db):
    _run_migration(disposable_db)

    engine = create_engine(disposable_db)
    try:
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO users (id, email, full_name, hashed_password, "
                "is_active, is_admin, role, created_at) "
                "VALUES (gen_random_uuid(), 'a@example.com', 'A', 'x', "
                "true, false, 'USER', now())"
            ))

        _run_migration(disposable_db)

        with engine.connect() as conn:
            assert conn.execute(
                text("SELECT count(*) FROM users")
            ).scalar() == 1
    finally:
        engine.dispose()


def test_schema_guard_rejects_unmigrated_database(disposable_db):
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
            verify_schema_compatibility("auth", engine)

        _run_migration(disposable_db)
        assert verify_schema_compatibility("auth", engine) == "0001_baseline"
    finally:
        engine.dispose()
