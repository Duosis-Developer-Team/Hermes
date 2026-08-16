# =============================================================================
# WS6 — Public API tenant binding: A'nin token'i B'yi GOREMEZ
# =============================================================================
# WS6'nin cikis kriteri: "A token'i hicbir Public API yolundan B'yi
# goremez." Bu dosya bunu GERCEK bir non-owner rol ile, gercek RLS
# altinda kanitlar — cunku superuser ile kosulan bir izolasyon testi
# hicbir sey kanitlamaz.
#
# Ayrica kimlik dogrulamanin tavuk-yumurta cozumunu sinar: tenant
# kesfi yalnizca DAR ayricalikli fonksiyon uzerinden yapilir ve o
# fonksiyon is verisi DONDURMEZ.
# =============================================================================

import hashlib
import re
import uuid

import pytest
from sqlalchemy import create_engine, text

from ..conftest import TEST_DB_URL

MIGRATOR_ROLE = "hermes_api_migrator"
APP_ROLE = "hermes_api_app"
_PASSWORD = "api-rls-test-only"

TENANT_A = "aaaaaaaa-1111-0000-0000-00000000000a"
TENANT_B = "bbbbbbbb-1111-0000-0000-00000000000b"


@pytest.fixture(scope="module")
def api_db():
    """Head semasina migrate edilmis, rol ayrimi kurulmus DB."""
    import sys
    from pathlib import Path

    root = Path(__file__).resolve().parent.parent.parent
    backend = root.parent
    for path in (str(root), str(backend)):
        if path not in sys.path:
            sys.path.insert(0, path)

    name = f"hermes_apirls_{uuid.uuid4().hex[:10]}"
    admin = create_engine(TEST_DB_URL, isolation_level="AUTOCOMMIT",
                          pool_pre_ping=True)
    try:
        with admin.connect() as conn:
            conn.execute(text(f'CREATE DATABASE "{name}"'))
    except Exception:  # noqa: BLE001
        admin.dispose()
        pytest.skip("disposable veritabani yaratilamadi")

    db_url = re.sub(r"/[^/]+$", f"/{name}", TEST_DB_URL)
    with admin.connect() as conn:
        for role in (MIGRATOR_ROLE, APP_ROLE):
            conn.execute(text(
                f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles "
                f"WHERE rolname = '{role}') THEN CREATE ROLE {role} "
                f"LOGIN PASSWORD '{_PASSWORD}'; END IF; END $$;"
            ))
        conn.execute(text(
            f"ALTER ROLE {MIGRATOR_ROLE} NOSUPERUSER BYPASSRLS"
        ))
        conn.execute(text(
            f"ALTER ROLE {APP_ROLE} NOSUPERUSER NOBYPASSRLS"
        ))
        conn.execute(text(
            f'GRANT CREATE, CONNECT ON DATABASE "{name}" TO {MIGRATOR_ROLE}'
        ))
        conn.execute(text(
            f'GRANT CONNECT ON DATABASE "{name}" TO {APP_ROLE}'
        ))
        conn.execute(text(
            f'ALTER DATABASE "{name}" OWNER TO {MIGRATOR_ROLE}'
        ))

    migrator_url = re.sub(
        r"://[^@]+@", f"://{MIGRATOR_ROLE}:{_PASSWORD}@", db_url
    )
    app_url = re.sub(r"://[^@]+@", f"://{APP_ROLE}:{_PASSWORD}@", db_url)

    from shared.migration_runner import upgrade

    upgrade("core", "head", database_url=migrator_url)

    migrator = create_engine(migrator_url)
    with migrator.begin() as conn:
        for tenant_id, slug in ((TENANT_A, "acme-dev"),
                                (TENANT_B, "globex-dev")):
            conn.execute(text(
                "INSERT INTO tenant_registry (tenant_id, slug, status, "
                "placement_key, source_version, provisioned_at, "
                "updated_at) VALUES (CAST(:t AS uuid), :s, 'active', "
                "'shared-default', 1, now(), now()) "
                "ON CONFLICT (tenant_id) DO NOTHING"
            ), {"t": tenant_id, "s": slug})
        from app.migrations.tenant_enforce import grant_runtime_role

        grant_runtime_role(conn, APP_ROLE)

    yield {"migrator": migrator, "app_url": app_url}

    migrator.dispose()
    with admin.connect() as conn:
        conn.execute(text(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE datname = :n"
        ), {"n": name})
        conn.execute(text(f'DROP DATABASE IF EXISTS "{name}"'))
    admin.dispose()


@pytest.fixture()
def app_engine(api_db):
    engine = create_engine(api_db["app_url"], pool_pre_ping=True)
    yield engine
    engine.dispose()


def _seed_client_and_token(migrator, tenant_id, *, name, plaintext):
    """Bir tenant'a API client + token yazar (kurulum yolu)."""
    client_id = uuid.uuid4()
    token_id = uuid.uuid4()
    digest = hashlib.sha256(plaintext.encode()).hexdigest()
    with migrator.begin() as conn:
        conn.execute(text(
            "INSERT INTO api_clients (id, tenant_id, name, client_type, "
            "environment, scopes, status, created_at, updated_at, "
            "created_by) VALUES (:id, CAST(:t AS uuid), :n, 'service', "
            "'dev', CAST(:sc AS jsonb), 'active', now(), now(), "
            "gen_random_uuid())"
        ), {"id": client_id, "t": tenant_id, "n": name,
            "sc": '["tasks:read"]'})
        conn.execute(text(
            "INSERT INTO api_tokens (id, tenant_id, client_id, "
            "token_prefix, token_hash, status, created_at, created_by) "
            "VALUES (:id, CAST(:t AS uuid), :c, :p, :h, 'active', now(), "
            "gen_random_uuid())"
        ), {"id": token_id, "t": tenant_id, "c": client_id,
            "p": plaintext[:12], "h": digest})
    return client_id, token_id, digest


# =============================================================================
# 1) Tenant kesfi: dar fonksiyon dogru tenant'i verir, is verisi vermez
# =============================================================================

def test_lookup_resolves_the_owning_tenant(api_db, app_engine):
    """Ayricalikli fonksiyon, token'in tenant'ini tenant baglami
    OLMADAN cozer — kimlik dogrulamanin calisabilmesi icin sart."""
    plain_a = "hms_dev_" + "a" * 43
    _seed_client_and_token(api_db["migrator"], TENANT_A,
                           name="Acme Bot", plaintext=plain_a)
    digest = hashlib.sha256(plain_a.encode()).hexdigest()

    with app_engine.connect() as conn:
        row = conn.execute(text(
            "SELECT tenant_id, environment_matches "
            "FROM hermes_sec.api_token_lookup(:h, 'dev')"
        ), {"h": digest}).mappings().first()

    assert row is not None
    assert str(row["tenant_id"]) == TENANT_A
    assert row["environment_matches"] is True


def test_lookup_returns_no_business_data(api_db, app_engine):
    """Fonksiyon YALNIZCA guvenli tanimlayicilar doner.

    Scope, client adi, binding gibi hicbir icerik cikmaz — ayricalikli
    yolun yuzeyi bilerek dardir.
    """
    plain = "hms_dev_" + "c" * 43
    _seed_client_and_token(api_db["migrator"], TENANT_A,
                           name="Gizli Isim", plaintext=plain)
    digest = hashlib.sha256(plain.encode()).hexdigest()

    with app_engine.connect() as conn:
        row = conn.execute(text(
            "SELECT * FROM hermes_sec.api_token_lookup(:h, 'dev')"
        ), {"h": digest}).mappings().first()

    assert set(row.keys()) == {
        "tenant_id", "token_id", "client_id", "token_status",
        "token_expires_at", "client_status", "environment_matches",
    }
    assert "Gizli Isim" not in str(dict(row))


def test_unknown_token_hash_resolves_to_nothing(app_engine):
    with app_engine.connect() as conn:
        row = conn.execute(text(
            "SELECT tenant_id FROM hermes_sec.api_token_lookup(:h, 'dev')"
        ), {"h": "0" * 64}).mappings().first()
    assert row is None


# =============================================================================
# 2) Kesif SONRASI her sey normal RLS altinda
# =============================================================================

def test_token_context_sees_only_its_own_tenant(api_db, app_engine):
    """A baglaminda B'nin client'i GORUNMEZ — ayni ada sahip olsa bile."""
    plain_a = "hms_dev_" + "d" * 43
    plain_b = "hms_dev_" + "e" * 43
    # AYNI client adi iki tenant'ta: tenant-qualified benzersizlik
    # sayesinde ikisi de yasar.
    _seed_client_and_token(api_db["migrator"], TENANT_A,
                           name="Ortak Client", plaintext=plain_a)
    _seed_client_and_token(api_db["migrator"], TENANT_B,
                           name="Ortak Client", plaintext=plain_b)

    for tenant_id in (TENANT_A, TENANT_B):
        with app_engine.begin() as conn:
            conn.execute(
                text("SELECT set_config('app.tenant_id', :t, true)"),
                {"t": tenant_id},
            )
            rows = conn.execute(text(
                "SELECT tenant_id FROM api_clients "
                "WHERE name = 'Ortak Client'"
            )).scalars().all()
        assert [str(r) for r in rows] == [tenant_id]


def test_cross_tenant_token_row_is_invisible(api_db, app_engine):
    """A baglamindayken B'nin token satiri okunamaz.

    Kimlik dogrulamanin ikinci adimi (RLS altinda yeniden okuma) tam
    olarak buna dayanir: kesif yanlis bir tenant verse bile, token
    satiri o tenant'in baglaminda bulunamaz.
    """
    plain_b = "hms_dev_" + "f" * 43
    _, token_id_b, digest_b = _seed_client_and_token(
        api_db["migrator"], TENANT_B, name="B Bot", plaintext=plain_b
    )

    with app_engine.begin() as conn:
        conn.execute(
            text("SELECT set_config('app.tenant_id', :t, true)"),
            {"t": TENANT_A},
        )
        row = conn.execute(text(
            "SELECT id FROM api_tokens WHERE token_hash = :h"
        ), {"h": digest_b}).first()
    assert row is None


def test_api_request_log_is_tenant_isolated(api_db, app_engine):
    """Denetim kayitlari da tenant'a aittir — capraz okuma yok."""
    with app_engine.begin() as conn:
        conn.execute(
            text("SELECT set_config('app.tenant_id', :t, true)"),
            {"t": TENANT_A},
        )
        conn.execute(text(
            "INSERT INTO api_request_logs (tenant_id, request_id, method, "
            "path, status_code, duration_ms, rate_limited, created_at) "
            "VALUES (CAST(:t AS uuid), :r, 'GET', '/v1/tasks', 200, 5, "
            "false, now())"
        ), {"t": TENANT_A, "r": f"req_{uuid.uuid4().hex[:10]}"})

    with app_engine.begin() as conn:
        conn.execute(
            text("SELECT set_config('app.tenant_id', :t, true)"),
            {"t": TENANT_B},
        )
        count = conn.execute(text(
            "SELECT count(*) FROM api_request_logs"
        )).scalar()
    assert count == 0


def test_idempotency_key_may_repeat_across_tenants(api_db, app_engine):
    """Ayni idempotency anahtari iki tenant'ta BAGIMSIZ yasar.

    Global benzersiz kalsaydi, A'nin kullandigi bir anahtar B'yi
    engeller ve B'ye A'nin anahtar uzayini sizdirirdi.
    """
    client_a, _, _ = _seed_client_and_token(
        api_db["migrator"], TENANT_A, name="Idem A",
        plaintext="hms_dev_" + "g" * 43,
    )
    client_b, _, _ = _seed_client_and_token(
        api_db["migrator"], TENANT_B, name="Idem B",
        plaintext="hms_dev_" + "h" * 43,
    )
    shared_key = "same-key-in-both-tenants"

    for tenant_id, client_id in ((TENANT_A, client_a), (TENANT_B, client_b)):
        with app_engine.begin() as conn:
            conn.execute(
                text("SELECT set_config('app.tenant_id', :t, true)"),
                {"t": tenant_id},
            )
            conn.execute(text(
                "INSERT INTO api_idempotency_keys (id, tenant_id, "
                "client_id, key, request_hash, created_at) VALUES "
                "(gen_random_uuid(), CAST(:t AS uuid), :c, :k, :h, now())"
            ), {"t": tenant_id, "c": client_id, "k": shared_key,
                "h": "x" * 64})

    # Ikisi de yazildi: cakisma YOK.
    with api_db["migrator"].connect() as conn:
        total = conn.execute(text(
            "SELECT count(*) FROM api_idempotency_keys WHERE key = :k"
        ), {"k": shared_key}).scalar()
    assert total == 2


def test_token_cannot_be_attached_to_another_tenants_client(api_db,
                                                            app_engine):
    """A'nin token'i B'nin client'ina baglanamaz (composite FK)."""
    from sqlalchemy.exc import IntegrityError, ProgrammingError

    client_b, _, _ = _seed_client_and_token(
        api_db["migrator"], TENANT_B, name="B Client",
        plaintext="hms_dev_" + "i" * 43,
    )

    with app_engine.begin() as conn:
        conn.execute(
            text("SELECT set_config('app.tenant_id', :t, true)"),
            {"t": TENANT_A},
        )
        with pytest.raises((IntegrityError, ProgrammingError)):
            conn.execute(text(
                "INSERT INTO api_tokens (id, tenant_id, client_id, "
                "token_prefix, token_hash, status, created_at, "
                "created_by) VALUES (gen_random_uuid(), CAST(:t AS uuid), "
                ":c, 'hms_dev_', :h, 'active', now(), gen_random_uuid())"
            ), {"t": TENANT_A, "c": client_b, "h": "z" * 64})


def test_runtime_role_cannot_read_tokens_without_context(app_engine):
    """Baglamsiz token taramasi sifir satir — kesif yalnizca dar
    fonksiyon uzerinden mumkun."""
    with app_engine.connect() as conn:
        count = conn.execute(
            text("SELECT count(*) FROM api_tokens")
        ).scalar()
    assert count == 0
