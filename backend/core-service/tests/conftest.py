# =============================================================================
# HERMES core-service tests - shared fixtures
# =============================================================================
# Onemli: env degiskenleri APP IMPORT'UNDAN ONCE ayarlanmalidir —
# shared/auth.py modul yuklenirken JWT_PUBLIC_KEY yoksa sys.exit(1) yapar.
# DB'ye BAGLANILMAZ: TestClient lifespan calistirmaz (context manager
# olarak kullanilmadigi surece), create_engine lazy'dir.
# =============================================================================

import os
import sys

# core-service koku (`app` paketi) + backend koku (`shared` paketi —
# Docker'da image'a kopyalanir; lokalde backend/shared'ten cozulur.
# NOT: core-service/shared BOS bir klasordur, backend koku ONCE gelmeli
# ki gercek `shared` paketi onu golgede biraksin).
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_BACKEND = os.path.dirname(_ROOT)
for _p in (_ROOT, _BACKEND):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# shared/auth.py'nin modul-yuklenme kontrolu icin dummy anahtar (yalnizca
# saklanir; testler JWT dogrulamasi yapmaz). DEBUG bilerek AYARLANMAZ —
# default False, internal OpenAPI hardening'i bu modda test ediyoruz.
os.environ.setdefault("JWT_PUBLIC_KEY", "test-only-not-a-real-key")

import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_rate_limiter():
    """Her test taze bir limiter'la baslar — global sayac durumu testler
    arasinda tasinmaz."""
    from app.public_api import rate_limit

    rate_limit.set_limiter(rate_limit.InMemoryRateLimiter())
    yield
    rate_limit.set_limiter(rate_limit.InMemoryRateLimiter())


# Gercek-Postgres entegrasyon testleri (Stage 2D+). Lokalde:
#   docker run -d --name hermes-test-pg -e POSTGRES_USER=hermes \
#     -e POSTGRES_PASSWORD=hermes -e POSTGRES_DB=hermes_test \
#     -p 55433:5432 postgres:15-alpine
# CI ayni URL'i servis container'iyla saglar. DB yoksa bu fixture'i
# kullanan testler SKIP edilir (foundation testleri etkilenmez).
TEST_DB_URL = os.environ.get(
    "HERMES_TEST_DATABASE_URL",
    "postgresql://hermes:hermes@localhost:55433/hermes_test",
)

# WS3/WS4: her test satiri bir tenant'a aittir. Tek bir sabit tenant
# yeterlidir — capraz-tenant izolasyonu ayri bir dosyada, gercek bir
# NOBYPASSRLS rolüyle sinaniyor (tests/test_rls_isolation.py).
TEST_TENANT_ID = "00000000-0000-0000-0000-0000000000a1"


@pytest.fixture(scope="session")
def pg_engine():
    from sqlalchemy import create_engine

    engine = create_engine(TEST_DB_URL, pool_pre_ping=True)
    try:
        with engine.connect():
            pass
    except Exception:
        pytest.skip("test database unavailable (see conftest for setup)")
    # Test semasi ile URETIM semasi TEK kaynaktan gelir (WS1/WS4):
    # burasi Alembic revizyonlarinin cagirdigi ayni modulleri kosar.
    # Onceden bu fixture semanin bir BOLUMUNU elle tekrarliyordu; eksik
    # kalan her ifade "testte gecer, uretimde patlar" kaymasiydi.
    from sqlalchemy import text as sa_text

    from app.migrations.baseline_ddl import apply_all
    from app.migrations.tenant_enforce import apply_enforce
    from app.models.mixins import tenant_owned_tables

    with engine.begin() as conn:
        apply_all(conn)
        # Onceki kosulardan kalan tenant'siz satirlar enforce'u
        # bloklar; test tenant'ina baglayip devam ediyoruz.
        for table in tenant_owned_tables():
            conn.execute(sa_text(
                f"UPDATE {table} SET tenant_id = CAST(:t AS uuid) "
                "WHERE tenant_id IS NULL"
            ), {"t": TEST_TENANT_ID})
        conn.execute(sa_text(
            "INSERT INTO tenant_registry (tenant_id, slug, status, "
            "placement_key, source_version, provisioned_at, updated_at) "
            "VALUES (CAST(:t AS uuid), 'test-tenant', 'active', "
            "'shared-default', 1, now(), now()) "
            "ON CONFLICT (tenant_id) DO NOTHING"
        ), {"t": TEST_TENANT_ID})
        # NOT NULL + tenant-qualified kisitlar + FORCE RLS.
        # NOT: testler superuser ile baglanir, yani RLS'i ASAR. Gercek
        # izolasyon kaniti tests/test_rls_isolation.py'dedir (orada
        # gercek bir NOBYPASSRLS rol acilir). Burada enforce'un amaci,
        # test semasinin uretimle AYNI kisitlari tasimasidir.
        apply_enforce(conn)

    yield engine
    engine.dispose()


@pytest.fixture()
def pg_session(pg_engine):
    from sqlalchemy import text as sa_text
    from sqlalchemy.orm import sessionmaker

    Session = sessionmaker(
        bind=pg_engine, autoflush=False, autocommit=False
    )
    s = Session()
    # Test izolasyonu: yalnizca api_* tablolari temizlenir.
    s.execute(
        sa_text(
            "TRUNCATE api_request_logs, api_client_access, api_tokens, "
            "api_clients, api_cleanup_runs RESTART IDENTITY CASCADE"
        )
    )
    s.commit()
    # Tenant baglami: yeni satirlar `tenant_id` damgasini buradan alir
    # (app/tenant_db.py before_flush hook'u). Uretimde bu damgayi
    # istegin dogrulanmis principal'i belirler.
    #
    # `bind_tenant` DEGIL `mark_session_tenant`: ilki set_config
    # calistirip transaction ACAR ve paylasilan test session'i, ikinci
    # bir baglanti kullanan testlerle (orn. advisory-lock testi) kilit
    # bekleyisine girerdi.
    from app.tenant_db import mark_session_tenant

    mark_session_tenant(s, TEST_TENANT_ID)
    yield s
    s.rollback()
    s.close()


@pytest.fixture(autouse=True)
def audit_records(monkeypatch):
    """Audit yazimini yakalar: testler gercek DB'ye yazmaz ve kayitlari
    dogrulayabilir. _persist'i patchler; audit middleware'in 'asla istegi
    bozma' garantisi ayri testte gercek hata enjekte edilerek sinanir."""
    records = []
    from app.public_api import audit

    monkeypatch.setattr(audit, "_persist", records.append)
    return records


# =============================================================================
# RBAC cutover (2026-08-04): ortak sahte authz upstream'i
# =============================================================================
# Efektif task/issue izinleri artik rollerden cozuldugu icin, izin
# gerektiren HER dunya kurulumunun kullanici→izin eslemesi vermesi
# gerekir. grants dict'i: user_id(str) -> izin kodu listesi.

@pytest.fixture()
def authz_grants(monkeypatch):
    import httpx as _httpx

    from app.services import authz_client as _authz

    grants: dict = {}

    def handler(request: _httpx.Request) -> _httpx.Response:
        import json as _json

        if request.url.path == "/internal/authz/resolve":
            ids = _json.loads(request.content)["user_ids"]
            return _httpx.Response(200, json={
                "users": [
                    {"id": str(i), "permissions": grants.get(str(i), [])}
                    for i in ids
                ]
            })
        return _httpx.Response(404, json={"detail": "Not Found"})

    _authz.set_client_factory(
        lambda: _httpx.Client(transport=_httpx.MockTransport(handler))
    )
    _authz.clear_cache()
    monkeypatch.setattr(
        _authz.get_settings(), "AUTH_SERVICE_URL",
        "http://auth-service/api/v1",
    )
    monkeypatch.setattr(
        _authz.get_settings(), "HERMES_S2S_TOKEN_CURRENT",
        "s2s-test-" + "x" * 40,
    )
    yield grants
    _authz.set_client_factory(lambda: _httpx.Client(timeout=5))
    _authz.clear_cache()
