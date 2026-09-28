# =============================================================================
# Dev-only mock veri tohumu (app/jobs/dev_seed.py) — kilitlenen sozlesmeler
# =============================================================================
#   1. KAPI: `--yes-dev` + HERMES_ENVIRONMENT=dev + PUBLIC_API_ENV=dev +
#      (pod icinde) namespace=hermes-dev. Biri tutmazsa exit 2 ve DB'ye
#      HIC baglanilmaz. hermes-test'te (HERMES_ENVIRONMENT=test,
#      PUBLIC_API_ENV=live, namespace hermes-test) kosamaz.
#   2. IDEMPOTENT: ayni gun iki kez kosmak ikinci kosuda HICBIR satir
#      yazmaz; tablo sayilari ayni kalir.
#   3. PURGE KESIN: yalnizca isaretli satirlar (+ onlara FK ile bagli
#      satirlar) silinir; ayni tenant'taki gercek satirlar ve baska
#      tenant'in verisi kalir; SET NULL referansi NULL'lanir.
#   4. Uretim gibi: tohum NOBYPASSRLS runtime rolu + RLS altinda kosar.
# =============================================================================

import re
import uuid
from datetime import date

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from shared import dev_seed as guard

from .conftest import TEST_DB_URL

MIGRATOR_ROLE = "hermes_seed_migrator"
APP_ROLE = "hermes_seed_app"
_PASSWORD = "seed-test-only"

TENANT_A = "aaaaaaaa-0000-4000-8000-0000000000d5"
TENANT_B = "bbbbbbbb-0000-4000-8000-0000000000d5"
REAL_1 = uuid.UUID("11111111-0000-4000-8000-0000000000d5")
REAL_2 = uuid.UUID("22222222-0000-4000-8000-0000000000d5")
REAL_USERS = [
    {"id": REAL_1, "name": "Gerçek Kullanıcı", "email": "real.one@example.com"},
    {"id": REAL_2, "name": "İkinci Kullanıcı", "email": "real.two@example.com"},
]
TODAY = date(2026, 9, 30)  # Carsamba


# =============================================================================
# 1) Kapi (DB gerekmez)
# =============================================================================

DEV_ENV = {"HERMES_ENVIRONMENT": "dev"}


def test_guard_accepts_only_full_dev_signature(tmp_path):
    guard.assert_dev_only(["--yes-dev"], public_api_env="dev", environ=DEV_ENV)
    ns = tmp_path / "namespace"
    ns.write_text("hermes-dev\n")
    guard.assert_dev_only(
        ["--yes-dev"], public_api_env="dev",
        environ={**DEV_ENV, "KUBERNETES_SERVICE_HOST": "10.0.0.1"},
        namespace_file=str(ns),
    )


@pytest.mark.parametrize("argv,public_env,environ,reason", [
    ([], "dev", DEV_ENV, "--yes-dev"),
    (["--yes-dev"], "dev", {}, "HERMES_ENVIRONMENT"),
    (["--yes-dev"], "dev", {"HERMES_ENVIRONMENT": "test"}, "HERMES_ENVIRONMENT"),
    (["--yes-dev"], "dev", {"HERMES_ENVIRONMENT": "production"}, "HERMES_ENVIRONMENT"),
    (["--yes-dev"], "live", DEV_ENV, "PUBLIC_API_ENV"),
    (["--yes-dev"], None, DEV_ENV, "PUBLIC_API_ENV"),
    (["--yes-dev"], "dev", {**DEV_ENV, "PUBLIC_API_ENV": "live"}, "PUBLIC_API_ENV"),
    # hermes-test imzasi (manifestlerdeki degerler)
    (["--yes-dev"], "live", {"HERMES_ENVIRONMENT": "test", "PUBLIC_API_ENV": "live"}, "HERMES_ENVIRONMENT"),
])
def test_guard_refuses_non_dev(argv, public_env, environ, reason):
    with pytest.raises(guard.DevSeedRefused) as exc:
        guard.assert_dev_only(argv, public_api_env=public_env, environ=environ)
    assert reason in str(exc.value)


def test_guard_checks_pod_namespace_even_if_env_says_dev(tmp_path):
    ns = tmp_path / "namespace"
    ns.write_text("hermes-test")
    env = {**DEV_ENV, "KUBERNETES_SERVICE_HOST": "10.0.0.1"}
    with pytest.raises(guard.DevSeedRefused, match="hermes-test"):
        guard.assert_dev_only(["--yes-dev"], public_api_env="dev", environ=env,
                              namespace_file=str(ns))
    # Pod icinde namespace okunamiyorsa da red (fail-closed).
    with pytest.raises(guard.DevSeedRefused, match="namespace"):
        guard.assert_dev_only(["--yes-dev"], public_api_env="dev", environ=env,
                              namespace_file=str(tmp_path / "missing"))


def test_main_refuses_before_touching_the_database(monkeypatch, capsys):
    from app import database
    from app.config import get_settings
    from app.jobs import dev_seed

    def _boom(*a, **k):
        raise AssertionError("DB must not be opened when the guard refuses")

    monkeypatch.setattr(database, "SessionLocal", _boom)
    monkeypatch.delenv("KUBERNETES_SERVICE_HOST", raising=False)

    # hermes-test: HERMES_ENVIRONMENT=test, PUBLIC_API_ENV=live
    monkeypatch.setenv("HERMES_ENVIRONMENT", "test")
    monkeypatch.setattr(get_settings(), "PUBLIC_API_ENV", "live")
    assert dev_seed.main(["--yes-dev"]) == guard.EXIT_REFUSED
    assert dev_seed.main(["--yes-dev", "--purge"]) == guard.EXIT_REFUSED
    assert "refused" in capsys.readouterr().err

    # dev ortam ama bayrak yok
    monkeypatch.setenv("HERMES_ENVIRONMENT", "dev")
    monkeypatch.setattr(get_settings(), "PUBLIC_API_ENV", "dev")
    assert dev_seed.main([]) == guard.EXIT_REFUSED

    # Yalnizca PUBLIC_API_ENV live (env dev olsa bile)
    monkeypatch.setattr(get_settings(), "PUBLIC_API_ENV", "live")
    assert dev_seed.main(["--yes-dev"]) == guard.EXIT_REFUSED


def test_demo_ids_are_deterministic_and_marked():
    a = guard.demo_id("t", "work_item", 1)
    assert a == guard.demo_id("t", "work_item", 1)
    assert a != guard.demo_id("t", "work_item", 2)
    assert str(a).startswith(guard.DEMO_ID_PREFIX + "-")
    assert guard.is_demo_id(a) and guard.is_demo_id(str(a))
    assert not guard.is_demo_id(uuid.uuid4())
    assert not guard.is_demo_id(REAL_1)
    for u in guard.demo_users():
        assert guard.is_demo_id(u["id"])
        assert u["email"].endswith("@" + guard.DEMO_EMAIL_DOMAIN)


# =============================================================================
# 2) Gercek Postgres: tek kullanimlik DB, NOBYPASSRLS runtime rolu
# =============================================================================

@pytest.fixture(scope="module")
def seed_db():
    admin = create_engine(TEST_DB_URL, isolation_level="AUTOCOMMIT", pool_pre_ping=True)
    name = f"hermes_seed_{uuid.uuid4().hex[:12]}"
    try:
        with admin.connect() as conn:
            conn.execute(text(f'CREATE DATABASE "{name}"'))
    except Exception:  # noqa: BLE001
        admin.dispose()
        pytest.skip("disposable veritabani yaratilamadi")

    with admin.connect() as conn:
        for role in (MIGRATOR_ROLE, APP_ROLE):
            conn.execute(text(
                f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') "
                f"THEN CREATE ROLE {role} LOGIN PASSWORD '{_PASSWORD}'; END IF; END $$;"
            ))
        conn.execute(text(f"ALTER ROLE {MIGRATOR_ROLE} NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS"))
        conn.execute(text(f"ALTER ROLE {APP_ROLE} NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS"))
        conn.execute(text(f'GRANT CREATE, CONNECT ON DATABASE "{name}" TO {MIGRATOR_ROLE}'))
        conn.execute(text(f'GRANT CONNECT ON DATABASE "{name}" TO {APP_ROLE}'))
        conn.execute(text(f'ALTER DATABASE "{name}" OWNER TO {MIGRATOR_ROLE}'))

    db_url = re.sub(r"/[^/]+$", f"/{name}", TEST_DB_URL)
    migrator_url = re.sub(r"://[^@]+@", f"://{MIGRATOR_ROLE}:{_PASSWORD}@", db_url)
    app_url = re.sub(r"://[^@]+@", f"://{APP_ROLE}:{_PASSWORD}@", db_url)

    from shared.migration_runner import upgrade

    upgrade("core", "head", database_url=migrator_url)
    migrator = create_engine(migrator_url)
    with migrator.begin() as conn:
        for tenant_id, slug in ((TENANT_A, "seed-a"), (TENANT_B, "seed-b")):
            conn.execute(text(
                "INSERT INTO tenant_registry (tenant_id, slug, status, placement_key, "
                "source_version, provisioned_at, updated_at) VALUES (CAST(:t AS uuid), :s, "
                "'active', 'shared-default', 1, now(), now()) ON CONFLICT (tenant_id) DO NOTHING"
            ), {"t": tenant_id, "s": slug})
        from app.migrations.tenant_enforce import grant_runtime_role

        grant_runtime_role(conn, APP_ROLE)

    app_engine = create_engine(app_url, pool_pre_ping=True)
    yield {"migrator": migrator, "app": app_engine}

    app_engine.dispose()
    migrator.dispose()
    with admin.connect() as conn:
        conn.execute(text(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :n"
        ), {"n": name})
        conn.execute(text(f'DROP DATABASE IF EXISTS "{name}"'))
    admin.dispose()


def _tenant_counts(migrator, tenant_id) -> dict:
    from app.models.mixins import tenant_owned_tables

    out = {}
    with migrator.connect() as conn:
        for table in tenant_owned_tables():
            out[table] = conn.execute(text(
                f"SELECT count(*) FROM {table} WHERE tenant_id = CAST(:t AS uuid)"
            ), {"t": tenant_id}).scalar()
    return out


def _demo_rows(migrator) -> dict:
    from app.models.mixins import tenant_owned_tables

    out = {}
    with migrator.connect() as conn:
        for table in tenant_owned_tables():
            has_id = conn.execute(text(
                "SELECT 1 FROM information_schema.columns WHERE table_name = :t "
                "AND column_name = 'id' AND data_type = 'uuid'"), {"t": table}).first()
            if not has_id:
                continue
            n = conn.execute(text(
                f"SELECT count(*) FROM {table} WHERE CAST(id AS text) LIKE :p"
            ), {"p": guard.demo_id_sql_pattern()}).scalar()
            if n:
                out[table] = n
    return out


def _run(app_engine, fn, **kwargs):
    """Uretim yolu: runtime rolu + transaction-local tenant baglami."""
    from app.tenant_db import bind_tenant

    Session = sessionmaker(bind=app_engine, autoflush=False, autocommit=False)
    db = Session()
    try:
        bind_tenant(db, TENANT_A)
        result = fn(db, tenant_id=TENANT_A, **kwargs)
        db.commit()
        return result
    finally:
        db.close()


def _real_rows(migrator):
    """Tohumdan ONCE yazilan gercek (isaretsiz) satirlar: A ve B'de."""
    ids = {k: uuid.uuid4() for k in ("cust", "proj", "wt", "cust_b")}
    with migrator.begin() as conn:
        conn.execute(text(
            "INSERT INTO customers (id, tenant_id, name, is_active, created_at) "
            "VALUES (:id, CAST(:t AS uuid), 'Gerçek Müşteri', true, now())"
        ), {"id": ids["cust"], "t": TENANT_A})
        conn.execute(text(
            "INSERT INTO projects (id, tenant_id, customer_id, name, is_active, "
            "is_billable_default, created_at) VALUES (:id, CAST(:t AS uuid), :c, "
            "'Gerçek Proje', true, true, now())"
        ), {"id": ids["proj"], "t": TENANT_A, "c": ids["cust"]})
        conn.execute(text(
            "INSERT INTO work_types (id, tenant_id, name, is_active) "
            "VALUES (:id, CAST(:t AS uuid), 'Geliştirme', true)"
        ), {"id": ids["wt"], "t": TENANT_A})
        conn.execute(text(
            "INSERT INTO customers (id, tenant_id, name, is_active, created_at) "
            "VALUES (:id, CAST(:t AS uuid), 'Vakko', true, now())"
        ), {"id": ids["cust_b"], "t": TENANT_B})
    return ids


def test_seed_is_idempotent_and_purge_removes_only_seeded_rows(seed_db):
    from app.jobs import dev_seed

    migrator, app_engine = seed_db["migrator"], seed_db["app"]
    real = _real_rows(migrator)
    before_b = _tenant_counts(migrator, TENANT_B)

    first = _run(app_engine, dev_seed.seed, real_users=REAL_USERS, today=TODAY,
                 with_tickets=True)
    created = first["created"]
    assert created["work_items"] >= 60
    assert created["customers"] == 5 and created["projects"] == 10
    assert created["tickets"] == 10 and created["meetings"] >= 15
    assert created["work_logs"] > 100 and created["work_item_notifications"] > 0
    assert "work_types" not in created  # gercek referans veri yeniden kullanilir
    counts_1 = _tenant_counts(migrator, TENANT_A)

    # Gercek kullanicilar ekranlarda veri gorur: bugun / gecikmis / bu hafta.
    with migrator.connect() as conn:
        for uid in (REAL_1, REAL_2):
            dues = {r[0] for r in conn.execute(text(
                "SELECT w.due_date FROM work_items w JOIN work_item_participants p "
                "ON p.work_item_id = w.id WHERE p.user_id = :u AND p.role = 'assignee'"
            ), {"u": uid})}
            assert TODAY in dues
            assert any(d and d < TODAY for d in dues)
            assert any(d and d > TODAY for d in dues)

    # 2. kosu: hicbir satir yazilmaz, sayilar ayni.
    second = _run(app_engine, dev_seed.seed, real_users=REAL_USERS, today=TODAY,
                  with_tickets=True)
    assert second["created"] == {}
    assert _tenant_counts(migrator, TENANT_A) == counts_1

    # Arayuzden demo veriye dokunan gercek bir satir: SET NULL ile baglanir.
    item_id = guard.demo_id(TENANT_A, "work_item", "general", 0)
    with migrator.begin() as conn:
        conn.execute(text(
            "INSERT INTO work_logs (tenant_id, user_id, customer_id, project_id, work_type_id, "
            "work_item_id, date_worked, duration_hours, description, created_at, updated_at) "
            "VALUES (CAST(:t AS uuid), :u, :c, :p, :wt, :wi, :d, 2, 'gercek efor', now(), now())"
        ), {"t": TENANT_A, "u": REAL_1, "c": real["cust"], "p": real["proj"],
            "wt": real["wt"], "wi": item_id, "d": TODAY})

    result = _run(app_engine, dev_seed.purge)
    assert result["deleted"]["work_items"] == created["work_items"]
    assert _demo_rows(migrator) == {}

    after = _tenant_counts(migrator, TENANT_A)
    assert after["customers"] == 1 and after["projects"] == 1 and after["work_types"] == 1
    assert after["work_logs"] == 1 and after["work_items"] == 0 and after["tickets"] == 0
    # Kiracinin akis durumlari (ensure_states, isaretsiz) kalir.
    assert after["workflow_states"] >= 4
    with migrator.connect() as conn:
        row = conn.execute(text(
            "SELECT work_item_id, description FROM work_logs WHERE tenant_id = CAST(:t AS uuid)"
        ), {"t": TENANT_A}).one()
    assert row == (None, "gercek efor")
    assert _tenant_counts(migrator, TENANT_B) == before_b

    # Purge'dan sonra yeniden tohumlanabilir; tekrar purge temizler.
    again = _run(app_engine, dev_seed.seed, real_users=REAL_USERS, today=TODAY,
                 with_tickets=False)
    assert again["created"]["work_items"] == created["work_items"]
    assert "tickets" not in again["created"]
    _run(app_engine, dev_seed.purge)
    assert _demo_rows(migrator) == {}


def test_main_seeds_and_purges_under_runtime_role(seed_db, monkeypatch, capsys):
    from app import database
    from app.config import get_settings
    from app.jobs import dev_seed

    migrator, app_engine = seed_db["migrator"], seed_db["app"]
    monkeypatch.setattr(database, "SessionLocal",
                        sessionmaker(bind=app_engine, autoflush=False, autocommit=False))
    monkeypatch.setattr(dev_seed, "discover_real_users", lambda db, tid: REAL_USERS)
    monkeypatch.setenv("HERMES_ENVIRONMENT", "dev")
    monkeypatch.delenv("PUBLIC_API_ENV", raising=False)
    monkeypatch.delenv("KUBERNETES_SERVICE_HOST", raising=False)
    monkeypatch.setattr(get_settings(), "PUBLIC_API_ENV", "dev")
    monkeypatch.setattr(get_settings(), "HERMES_SUPPORT_TENANT_ID", TENANT_A)

    assert dev_seed.main(["--yes-dev", "--tenant-slug", "seed-a"]) == 0
    demo = _demo_rows(migrator)
    assert demo["tickets"] == 10 and demo["work_items"] >= 60
    assert dev_seed.main(["--yes-dev", "--tenant-slug", "seed-a", "--reseed"]) == 0
    assert _demo_rows(migrator) == demo
    assert dev_seed.main(["--yes-dev", "--tenant-slug", "seed-a", "--purge"]) == 0
    assert _demo_rows(migrator) == {}
    capsys.readouterr()


def test_seeded_data_renders_on_the_main_screens(seed_db, monkeypatch, authz_grants):
    """Duman testi: tohumdan sonra bir GERCEK kullanicinin ana ekranlari
    (ana sayfa, isler, efor, toplantilar, bildirimler, ticket hub'i)
    500 vermeden ve BOS olmadan doner."""
    from fastapi.testclient import TestClient

    from shared.auth import CurrentUser, get_current_user
    from shared.permissions import Perm

    from app.config import get_settings
    from app.database import get_db
    from app.jobs import dev_seed
    from app.main import app
    from app.routers.ticket_deps import get_support_db
    from app.services import support_tenant
    from app.tenant_db import bind_tenant, get_tenant_db

    migrator, app_engine = seed_db["migrator"], seed_db["app"]
    settings = get_settings()
    monkeypatch.setattr(settings, "SUPPORT_TICKETS_ENABLED", True)
    monkeypatch.setattr(settings, "HERMES_SUPPORT_TENANT_ID", TENANT_A)
    monkeypatch.setattr(settings, "PUBLIC_API_ENV", "dev")
    support_tenant._force_state_for_tests("ok")
    authz_grants[str(REAL_1)] = [
        Perm.TASKS_ACCESS, Perm.TASKS_ASSIGN, Perm.ISSUES_ACCESS, Perm.ISSUES_ASSIGN,
        Perm.TICKETS_ACCESS, Perm.TICKETS_RESPOND, Perm.REPORTS_VIEW,
    ]

    _run(app_engine, dev_seed.seed, real_users=REAL_USERS, with_tickets=True)
    Session = sessionmaker(bind=app_engine, autoflush=False, autocommit=False)
    db = Session()
    bind_tenant(db, TENANT_A)
    for dep in (get_db, get_tenant_db, get_support_db):
        app.dependency_overrides[dep] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id=str(REAL_1), email="real.one@example.com", full_name="Gerçek Kullanıcı",
        is_admin=False, tenant_id=TENANT_A,
    )
    try:
        client = TestClient(app, raise_server_exceptions=False)
        base = "/api/v1/core"

        res = client.get(f"{base}/home/my-work")
        assert res.status_code == 200, res.text
        body = res.json()
        assert any(v.get("groups") for v in body.values() if isinstance(v, dict)), body

        from app.services.capacity_service import today_in_tenant_tz, week_monday

        monday = week_monday(today_in_tenant_tz()).isoformat()
        for path in ("/home/week", "/home/team", "/tasks/states",
                     f"/capacity/week?start={monday}", "/work-logs", "/meetings"):
            res = client.get(base + path)
            assert res.status_code == 200, (path, res.text)

        tasks = client.get(f"{base}/tasks")
        assert tasks.status_code == 200, tasks.text
        assert len(tasks.json()) >= 10
        detail = client.get(f"{base}/tasks/{tasks.json()[0]['id']}")
        assert detail.status_code == 200, detail.text

        unread = client.get(f"{base}/notifications/unread-count")
        assert unread.status_code == 200, unread.text
        assert max(v for v in unread.json().values() if isinstance(v, int)) > 0

        hub = client.get(f"{base}/tickets")
        assert hub.status_code == 200, hub.text
        items = hub.json()["items"]
        assert len(items) == 10
        one = client.get(f"{base}/tickets/{items[0]['id']}")
        assert one.status_code == 200, one.text
    finally:
        app.dependency_overrides.clear()
        support_tenant._force_state_for_tests("unverified")
        db.rollback()
        db.close()
        _run(app_engine, dev_seed.purge)
    assert _demo_rows(migrator) == {}
