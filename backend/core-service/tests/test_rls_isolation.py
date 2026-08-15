# =============================================================================
# WS4 — RLS izolasyonu: iki tenantli negatif matris (gercek Postgres)
# =============================================================================
# Bu dosya cutover'in EN KRITIK kanitidir. Uc sinif kapi var:
#
#   1. Katalog kapilari — her tenant tablosunda RLS ENABLE + FORCE ve
#      TAM OLARAK bir izolasyon politikasi var mi? (Yeni bir tablo
#      politikasiz eklenirse CI kirmizi olur.)
#   2. Rol kapilari — runtime rol NOBYPASSRLS mi ve HICBIR tablonun
#      sahibi degil mi? (Sahip/superuser ile kosulan bir RLS testi
#      GECERSIZDIR: sahip FORCE olmadan, superuser hic bir kosulda
#      politikaya tabi degildir.)
#   3. Davranis kapilari — A/B izolasyonu, context yoklugu, capraz
#      referans, havuz yeniden kullanimi.
#
# Testler GERCEK bir non-owner rol acar; owner baglantisiyla yapilan bir
# "izolasyon testi" kendini kandirmak olurdu.
# =============================================================================

import re
import uuid

import pytest
from sqlalchemy import create_engine, text

from .conftest import TEST_DB_URL

MIGRATOR_ROLE = "hermes_rls_migrator"
APP_ROLE = "hermes_rls_app"
_PASSWORD = "rls-test-only"

TENANT_A = "aaaaaaaa-0000-0000-0000-00000000000a"
TENANT_B = "bbbbbbbb-0000-0000-0000-00000000000b"


# =============================================================================
# Ortam: enforce edilmis semaya sahip, tek kullanimlik veritabani
# =============================================================================

@pytest.fixture(scope="module")
def rls_db():
    """Migration'lari head'e kadar kosmus, rol ayrimi kurulmus DB.

    Modul kapsaminda: kurulum pahali (tam sema + enforce), ama testler
    birbirinden bagimsiz kalsin diye her test kendi verisini yazar.
    """
    import sys
    from pathlib import Path

    root = Path(__file__).resolve().parent.parent
    backend = root.parent
    for path in (str(root), str(backend)):
        if path not in sys.path:
            sys.path.insert(0, path)

    name = f"hermes_rls_{uuid.uuid4().hex[:12]}"
    admin = create_engine(TEST_DB_URL, isolation_level="AUTOCOMMIT",
                          pool_pre_ping=True)
    try:
        with admin.connect() as conn:
            conn.execute(text(f'CREATE DATABASE "{name}"'))
    except Exception:  # noqa: BLE001
        admin.dispose()
        pytest.skip("disposable veritabani yaratilamadi")

    db_url = re.sub(r"/[^/]+$", f"/{name}", TEST_DB_URL)

    # --- roller (superuser baglantisiyla) ---
    with admin.connect() as conn:
        for role in (MIGRATOR_ROLE, APP_ROLE):
            conn.execute(text(
                f"DO $$ BEGIN "
                f"  IF NOT EXISTS (SELECT 1 FROM pg_roles "
                f"                 WHERE rolname = '{role}') THEN "
                f"    CREATE ROLE {role} LOGIN PASSWORD '{_PASSWORD}'; "
                f"  END IF; "
                f"END $$;"
            ))
        conn.execute(text(
            f"ALTER ROLE {MIGRATOR_ROLE} NOSUPERUSER NOCREATEDB "
            "NOCREATEROLE BYPASSRLS"
        ))
        # TUM izolasyonun dayandigi satir:
        conn.execute(text(
            f"ALTER ROLE {APP_ROLE} NOSUPERUSER NOCREATEDB NOCREATEROLE "
            "NOBYPASSRLS"
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

    # Sema MIGRATOR ile kurulur → tablolarin sahibi migrator olur,
    # uygulama rolu SAHIP DEGILDIR (kapi #2 bunu dogrular).
    from shared.migration_runner import upgrade

    upgrade("core", "head", database_url=migrator_url)

    # Enforce fazi, backfill icin tenant kimligi ister; bos DB'de
    # backfill atlanir, bu yuzden tenant kayitlarini burada ekliyoruz.
    migrator_engine = create_engine(migrator_url)
    with migrator_engine.begin() as conn:
        for tenant_id, slug in ((TENANT_A, "acme-dev"),
                                (TENANT_B, "globex-dev")):
            conn.execute(text(
                "INSERT INTO tenant_registry (tenant_id, slug, status, "
                "placement_key, source_version, provisioned_at, "
                "updated_at) VALUES (CAST(:t AS uuid), :s, 'active', "
                "'shared-default', 1, now(), now()) "
                "ON CONFLICT (tenant_id) DO NOTHING"
            ), {"t": tenant_id, "s": slug})
        # Uygulama rolune yetkiler (enforce fazi rol yoksa atlar).
        from app.migrations.tenant_enforce import grant_runtime_role

        grant_runtime_role(conn, APP_ROLE)

    yield {
        "migrator_url": migrator_url,
        "app_url": app_url,
        "migrator": migrator_engine,
        "name": name,
    }

    migrator_engine.dispose()
    with admin.connect() as conn:
        conn.execute(text(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE datname = :n"
        ), {"n": name})
        conn.execute(text(f'DROP DATABASE IF EXISTS "{name}"'))
    admin.dispose()


@pytest.fixture()
def app_engine(rls_db):
    """Uygulama rolu baglantisi — tek baglantili havuz.

    Havuz boyutu 1: "A'dan sonra B ayni baglantiyi alirsa sizinti olur
    mu?" sorusunu YAPISAL olarak test edebilmek icin.
    """
    from sqlalchemy.pool import QueuePool

    engine = create_engine(
        rls_db["app_url"], poolclass=QueuePool, pool_size=1,
        max_overflow=0, pool_pre_ping=True,
    )
    yield engine
    engine.dispose()


def _seed_customer(migrator_engine, tenant_id, name):
    """Migrator (BYPASSRLS) ile veri ekler — kurulum yolu."""
    customer_id = uuid.uuid4()
    with migrator_engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO customers (id, tenant_id, name, is_active, "
            "created_at) VALUES (:id, CAST(:t AS uuid), :n, true, now())"
        ), {"id": customer_id, "t": tenant_id, "n": name})
    return customer_id


# =============================================================================
# KAPI 1 — Katalog: her tenant tablosunda RLS ENABLE + FORCE + politika
# =============================================================================

def test_every_tenant_table_has_forced_rls(rls_db):
    """Envanter MAKINE ile dogrulanir.

    Liste elle tutulmaz: `TenantOwnedMixin` tasiyan her tablo burada
    aranir. Yeni bir tenant tablosu politikasiz eklenirse bu test
    kirilir — pack'in "tablo envanter kapisi" gereksinimi (04 §8).
    """
    from app.models.mixins import tenant_owned_tables

    with rls_db["migrator"].connect() as conn:
        rows = conn.execute(text(
            "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity "
            "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND c.relkind = 'r'"
        )).all()
    state = {r[0]: (r[1], r[2]) for r in rows}

    missing = []
    for table in tenant_owned_tables():
        enabled, forced = state.get(table, (False, False))
        if not enabled or not forced:
            missing.append(f"{table} (enabled={enabled}, forced={forced})")
    assert not missing, f"RLS eksik/zorlanmamis tablolar: {missing}"


def test_every_tenant_table_has_exactly_one_isolation_policy(rls_db):
    from app.models.mixins import tenant_owned_tables

    with rls_db["migrator"].connect() as conn:
        rows = conn.execute(text(
            "SELECT tablename, policyname, qual, with_check "
            "FROM pg_policies WHERE schemaname = 'public'"
        )).mappings().all()

    by_table = {}
    for row in rows:
        by_table.setdefault(row["tablename"], []).append(row)

    problems = []
    for table in tenant_owned_tables():
        policies = by_table.get(table, [])
        if len(policies) != 1:
            problems.append(f"{table}: {len(policies)} politika")
            continue
        policy = policies[0]
        # Hem okuma hem yazma tarafi kapali olmali.
        if not policy["qual"] or not policy["with_check"]:
            problems.append(f"{table}: USING/WITH CHECK eksik")
        if "app_current_tenant_id" not in (policy["qual"] or ""):
            problems.append(f"{table}: politika tenant fonksiyonu kullanmiyor")
    assert not problems, problems


def test_no_permissive_superadmin_policy_exists(rls_db):
    """"superadmin her seyi gorur" tarzi bir kacis dali OLMAMALI.

    Pack §8 (05_POSTGRES_RLS): destek erisimi somut bir tenant baglami
    kurar; politikaya `OR current_setting('app.is_superadmin')` gibi bir
    dal EKLENMEZ.
    """
    with rls_db["migrator"].connect() as conn:
        quals = conn.execute(text(
            "SELECT coalesce(qual, '') || ' ' || coalesce(with_check, '') "
            "FROM pg_policies WHERE schemaname = 'public'"
        )).scalars().all()
    for qual in quals:
        lowered = qual.lower()
        assert " or " not in lowered, (
            f"politikada beklenmeyen OR dali: {qual}"
        )
        assert "superadmin" not in lowered
        assert "is_admin" not in lowered


# =============================================================================
# KAPI 2 — Roller: runtime rol asamaz ve sahip degildir
# =============================================================================

def test_runtime_role_cannot_bypass_rls(rls_db):
    with rls_db["migrator"].connect() as conn:
        bypass = conn.execute(
            text("SELECT rolbypassrls FROM pg_roles WHERE rolname = :r"),
            {"r": APP_ROLE},
        ).scalar()
        superuser = conn.execute(
            text("SELECT rolsuper FROM pg_roles WHERE rolname = :r"),
            {"r": APP_ROLE},
        ).scalar()
    assert bypass is False, "runtime rol BYPASSRLS — izolasyon anlamsiz"
    assert superuser is False


def test_runtime_role_owns_no_tenant_table(rls_db):
    """Sahip, FORCE olmadan politikadan muaftir; olmamali."""
    with rls_db["migrator"].connect() as conn:
        owned = conn.execute(text(
            "SELECT c.relname FROM pg_class c "
            "JOIN pg_namespace n ON n.oid = c.relnamespace "
            "JOIN pg_roles r ON r.oid = c.relowner "
            "WHERE n.nspname = 'public' AND c.relkind = 'r' "
            "  AND r.rolname = :role"
        ), {"role": APP_ROLE}).scalars().all()
    assert owned == [], f"runtime rol su tablolarin sahibi: {owned}"


def test_runtime_role_cannot_disable_row_security(app_engine):
    from sqlalchemy.exc import ProgrammingError

    with app_engine.connect() as conn:
        conn.execute(text("SET row_security = off"))
        with pytest.raises(ProgrammingError):
            conn.execute(text("SELECT count(*) FROM customers")).scalar()


# =============================================================================
# KAPI 3 — Davranis: iki tenantli negatif matris
# =============================================================================

def test_missing_context_returns_zero_rows(rls_db, app_engine):
    """Tenant baglami YOKSA hicbir satir gorunmez.

    "Baglam yok" ASLA "tum tenant'lar" anlamina gelmez — cutover'in
    temel guvenlik vaadi budur.
    """
    _seed_customer(rls_db["migrator"], TENANT_A, "Acme Musteri")

    with app_engine.connect() as conn:
        count = conn.execute(
            text("SELECT count(*) FROM customers")
        ).scalar()
    assert count == 0


def test_missing_context_blocks_writes(app_engine):
    from sqlalchemy.exc import ProgrammingError

    with app_engine.begin() as conn:
        with pytest.raises(ProgrammingError):
            conn.execute(text(
                "INSERT INTO customers (id, tenant_id, name, is_active, "
                "created_at) VALUES (gen_random_uuid(), CAST(:t AS uuid), "
                "'kacak', true, now())"
            ), {"t": TENANT_A})


def test_each_tenant_sees_only_its_own_rows(rls_db, app_engine):
    """Ayni ADA sahip kayitlar iki tenant'ta yan yana yasar."""
    _seed_customer(rls_db["migrator"], TENANT_A, "Ortak Ad")
    _seed_customer(rls_db["migrator"], TENANT_B, "Ortak Ad")

    seen = {}
    for tenant_id in (TENANT_A, TENANT_B):
        with app_engine.begin() as conn:
            conn.execute(
                text("SELECT set_config('app.tenant_id', :t, true)"),
                {"t": tenant_id},
            )
            rows = conn.execute(text(
                "SELECT tenant_id FROM customers WHERE name = 'Ortak Ad'"
            )).scalars().all()
            seen[tenant_id] = {str(r) for r in rows}

    assert seen[TENANT_A] == {TENANT_A}
    assert seen[TENANT_B] == {TENANT_B}


def test_cross_tenant_uuid_is_invisible(rls_db, app_engine):
    """B'nin BILINEN UUID'si, A baglaminda hic yokmus gibi davranir."""
    b_id = _seed_customer(rls_db["migrator"], TENANT_B, "Globex Gizli")

    with app_engine.begin() as conn:
        conn.execute(
            text("SELECT set_config('app.tenant_id', :t, true)"),
            {"t": TENANT_A},
        )
        row = conn.execute(
            text("SELECT id FROM customers WHERE id = :id"), {"id": b_id}
        ).first()
    assert row is None


def test_cross_tenant_write_is_rejected(app_engine):
    """A baglamindayken B'ye satir YAZILAMAZ (WITH CHECK)."""
    from sqlalchemy.exc import ProgrammingError

    with app_engine.begin() as conn:
        conn.execute(
            text("SELECT set_config('app.tenant_id', :t, true)"),
            {"t": TENANT_A},
        )
        with pytest.raises(ProgrammingError):
            conn.execute(text(
                "INSERT INTO customers (id, tenant_id, name, is_active, "
                "created_at) VALUES (gen_random_uuid(), CAST(:t AS uuid), "
                "'capraz', true, now())"
            ), {"t": TENANT_B})


def test_cross_tenant_update_cannot_move_a_row(rls_db, app_engine):
    """A'daki bir satir UPDATE ile B'ye TASINAMAZ."""
    from sqlalchemy.exc import ProgrammingError

    a_id = _seed_customer(rls_db["migrator"], TENANT_A, "Tasinamaz")

    with app_engine.begin() as conn:
        conn.execute(
            text("SELECT set_config('app.tenant_id', :t, true)"),
            {"t": TENANT_A},
        )
        with pytest.raises(ProgrammingError):
            conn.execute(text(
                "UPDATE customers SET tenant_id = CAST(:b AS uuid) "
                "WHERE id = :id"
            ), {"b": TENANT_B, "id": a_id})


def test_cross_tenant_foreign_key_is_rejected(rls_db, app_engine):
    """A'nin projesi B'nin musterisini referans EDEMEZ.

    RLS "goremezsin" der; composite FK "referans bile veremezsin" der.
    Bu test ikincisini kanitlar: satir A baglaminda yazilir ama parent
    B'ye aittir — FK reddeder.
    """
    from sqlalchemy.exc import IntegrityError, ProgrammingError

    b_customer = _seed_customer(rls_db["migrator"], TENANT_B, "B Musteri")

    with app_engine.begin() as conn:
        conn.execute(
            text("SELECT set_config('app.tenant_id', :t, true)"),
            {"t": TENANT_A},
        )
        with pytest.raises((IntegrityError, ProgrammingError)):
            conn.execute(text(
                "INSERT INTO projects (id, tenant_id, customer_id, name, "
                "is_active, created_at) VALUES (gen_random_uuid(), "
                "CAST(:t AS uuid), :c, 'Capraz Proje', true, now())"
            ), {"t": TENANT_A, "c": b_customer})


def test_pool_reuse_does_not_leak_context(rls_db, app_engine):
    """TEK baglantili havuz: A'dan sonra B ayni baglantiyi alir.

    `SET LOCAL` kullanildigi icin A'nin baglami B'ye TASINMAZ; ve
    baglam kurulmadan yapilan sorgu sifir satir gorur.
    """
    _seed_customer(rls_db["migrator"], TENANT_A, "Havuz A")
    _seed_customer(rls_db["migrator"], TENANT_B, "Havuz B")

    with app_engine.begin() as conn:
        conn.execute(
            text("SELECT set_config('app.tenant_id', :t, true)"),
            {"t": TENANT_A},
        )
        a_rows = conn.execute(text(
            "SELECT count(*) FROM customers WHERE name = 'Havuz A'"
        )).scalar()
    assert a_rows == 1

    # AYNI baglanti (pool_size=1), baglam kurulmadan:
    with app_engine.begin() as conn:
        leaked = conn.execute(text("SELECT count(*) FROM customers")).scalar()
    assert leaked == 0, "onceki tenant baglami havuzda kaldi"

    # Ve B baglami yalnizca B'yi gorur.
    with app_engine.begin() as conn:
        conn.execute(
            text("SELECT set_config('app.tenant_id', :t, true)"),
            {"t": TENANT_B},
        )
        b_rows = conn.execute(text(
            "SELECT name FROM customers WHERE name LIKE 'Havuz%'"
        )).scalars().all()
    assert b_rows == ["Havuz B"]


def test_rollback_clears_context(rls_db, app_engine):
    """Istisna/rollback yolunda da baglam tasinmaz."""
    _seed_customer(rls_db["migrator"], TENANT_A, "Rollback A")

    try:
        with app_engine.begin() as conn:
            conn.execute(
                text("SELECT set_config('app.tenant_id', :t, true)"),
                {"t": TENANT_A},
            )
            raise RuntimeError("kasitli hata")
    except RuntimeError:
        pass

    with app_engine.begin() as conn:
        assert conn.execute(
            text("SELECT count(*) FROM customers")
        ).scalar() == 0


def test_unfiltered_orm_query_still_isolates(rls_db, app_engine):
    """Tenant predikati UNUTULMUS bir sorgu bile izole kalir.

    Uygulama filtresi savunma derinligidir; OTORITE veritabanidir.
    Bu test tam olarak "gelistirici filtreyi unuttu" senaryosudur.
    """
    from sqlalchemy.orm import sessionmaker

    from app.models.customer import Customer

    _seed_customer(rls_db["migrator"], TENANT_A, "ORM A")
    _seed_customer(rls_db["migrator"], TENANT_B, "ORM B")

    Session = sessionmaker(bind=app_engine)
    session = Session()
    try:
        from app.tenant_db import bind_tenant

        session.begin()
        bind_tenant(session, TENANT_A)
        # Bilerek tenant filtresi YOK:
        names = [c.name for c in session.query(Customer).all()]
        assert "ORM A" in names
        assert "ORM B" not in names
    finally:
        session.rollback()
        session.close()


def test_tenant_counter_allocates_atomically(rls_db):
    """Tenant sayaci: her tenant kendi serisini bagimsiz ilerletir."""
    with rls_db["migrator"].begin() as conn:
        for tenant_id in (TENANT_A, TENANT_B):
            conn.execute(text(
                "INSERT INTO tenant_counters (tenant_id, counter_key, "
                "next_value, updated_at) VALUES (CAST(:t AS uuid), "
                "'task', 1, now()) "
                "ON CONFLICT (tenant_id, counter_key) DO NOTHING"
            ), {"t": tenant_id})

        allocated = {}
        for tenant_id in (TENANT_A, TENANT_B, TENANT_A):
            value = conn.execute(text(
                "UPDATE tenant_counters SET next_value = next_value + 1 "
                "WHERE tenant_id = CAST(:t AS uuid) AND counter_key = "
                "'task' RETURNING next_value - 1"
            ), {"t": tenant_id}).scalar()
            allocated.setdefault(tenant_id, []).append(value)

    # A: 1, 2   B: 1  → seriler BAGIMSIZ
    assert allocated[TENANT_A] == [1, 2]
    assert allocated[TENANT_B] == [1]
