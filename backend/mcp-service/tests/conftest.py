# =============================================================================
# hermes-mcp tests - fixtures
# =============================================================================
# GERCEK uctan uca zincir: MCP HTTP → hermes_mcp → (ASGITransport) →
# core-service Public API → gercek Postgres. hermes_mcp RUNTIME'da core
# import etmez; core'u yalnizca BU test harness'i yukler (izin verilen
# tek yer). Env degiskenleri import'lardan ONCE ayarlanir.
# =============================================================================

import os
import sys
import uuid

_MCP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_BACKEND = os.path.dirname(_MCP_ROOT)
_CORE = os.path.join(_BACKEND, "core-service")
for _p in (_MCP_ROOT, _BACKEND, _CORE):
    if _p not in sys.path:
        sys.path.insert(0, _p)

os.environ.setdefault("JWT_PUBLIC_KEY", "test-only-not-a-real-key")
# Upstream: ASGITransport her host'u karsilar; path core mount'una gider.
os.environ["HERMES_PUBLIC_API_BASE"] = "http://core-test/api/public/v1"
os.environ["MCP_SCOPE_CACHE_TTL_SECONDS"] = "15"

import httpx  # noqa: E402
import pytest  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

TEST_DB_URL = os.environ.get(
    "HERMES_TEST_DATABASE_URL",
    "postgresql://hermes:hermes@localhost:55433/hermes_test",
)


@pytest.fixture(scope="session")
def pg_engine():
    from sqlalchemy import create_engine, text as sa_text

    engine = create_engine(TEST_DB_URL, pool_pre_ping=True)
    try:
        with engine.connect():
            pass
    except Exception:
        pytest.skip("test database unavailable (see conftest for setup)")
    # Sema TEK kaynaktan gelir (WS1): core'un Alembic baseline'i.
    # Onceden burada create_all + type_number trigger'i elle
    # tekrarlaniyordu; her eksik ifade "testte gecer, uretimde
    # patlar" kaymasi demekti.
    from app.migrations.baseline_ddl import apply_all

    with engine.begin() as conn:
        apply_all(conn)

    yield engine
    engine.dispose()


@pytest.fixture()
def pg_session(pg_engine):
    from sqlalchemy import text as sa_text
    from sqlalchemy.orm import sessionmaker

    Session = sessionmaker(bind=pg_engine, autoflush=False, autocommit=False)
    s = Session()
    s.execute(
        sa_text(
            "TRUNCATE api_request_logs, api_client_access, api_tokens, "
            "api_clients, api_cleanup_runs RESTART IDENTITY CASCADE"
        )
    )
    s.commit()
    yield s
    s.rollback()
    s.close()


# get_db override'i her testte YENI session'a baglamak icin holder.
_db_holder = {"session": None}


@pytest.fixture(scope="session")
def core_asgi_app():
    from app.database import get_db
    from app.main import app as core_app

    public_app = next(
        r.app
        for r in core_app.routes
        if getattr(r, "path", "") == "/api/public"
    )
    public_app.dependency_overrides[get_db] = lambda: _db_holder["session"]
    return core_app


@pytest.fixture(autouse=True)
def _wire_core(pg_session, core_asgi_app, monkeypatch):
    """Her test: DB holder'i baglar, audit'i yakalar, limiter'i tazeler,
    MCP gorunurluk cache'ini temizler."""
    _db_holder["session"] = pg_session

    from app.public_api import audit, rate_limit

    records = []
    monkeypatch.setattr(audit, "_persist", records.append)
    rate_limit.set_limiter(rate_limit.InMemoryRateLimiter())

    from hermes_mcp.auth import clear_visibility_cache

    clear_visibility_cache()

    # 5B-2: core'un directory client'ina sahte auth-service (her ID'yi
    # "User <ilk4>" olarak cozer; gorunurluk kararini CORE verdigi icin
    # echo guvenlidir).
    import json as _json

    from app.services import directory_client

    def _fake_auth(request):
        if request.url.path.endswith("/users/resolve"):
            ids = _json.loads(request.content)["user_ids"]
            return httpx.Response(
                200,
                json={
                    "users": [
                        {
                            "id": i,
                            "display_name": f"User {i[:4]}",
                            "work_email": f"u{i[:4]}@example.com",
                            "is_active": True,
                        }
                        for i in ids
                    ]
                },
            )
        return httpx.Response(
            200, json={"users": [], "has_more": False}
        )

    directory_client.set_client_factory(
        lambda: httpx.Client(transport=httpx.MockTransport(_fake_auth))
    )
    directory_client.clear_cache()
    monkeypatch.setattr(
        directory_client.get_settings(),
        "HERMES_S2S_TOKEN_CURRENT",
        "s2s-mcp-test-" + "z" * 32,
    )

    # RBAC cutover (2026-08-04): core, efektif task izinlerini rollerden
    # cozer — dunya kurulumlari kullanici→izin eslemesini _authz_holder'a
    # yazar (authz_grants fixture'i). Cozum sahte authz upstream'inden.
    from app.services import authz_client as _authz_mod

    _authz_holder.clear()

    def _fake_authz(request):
        if request.url.path == "/internal/authz/resolve":
            ids = _json.loads(request.content)["user_ids"]
            return httpx.Response(200, json={
                "users": [
                    {"id": str(i),
                     "permissions": _authz_holder.get(str(i), [])}
                    for i in ids
                ]
            })
        return httpx.Response(404, json={"detail": "Not Found"})

    _authz_mod.set_client_factory(
        lambda: httpx.Client(transport=httpx.MockTransport(_fake_authz))
    )
    _authz_mod.clear_cache()
    monkeypatch.setattr(
        _authz_mod.get_settings(), "AUTH_SERVICE_URL",
        "http://auth-service/api/v1",
    )
    monkeypatch.setattr(
        _authz_mod.get_settings(), "HERMES_S2S_TOKEN_CURRENT",
        "s2s-mcp-test-" + "z" * 32,
    )
    yield
    directory_client.set_client_factory(
        lambda: httpx.Client(timeout=5)
    )
    directory_client.clear_cache()
    _authz_mod.set_client_factory(lambda: httpx.Client(timeout=5))
    _authz_mod.clear_cache()
    _db_holder["session"] = None


_authz_holder: dict = {}


@pytest.fixture()
def authz_grants():
    """user_id(str) -> RBAC izin listesi (sahte authz upstream'i besler)."""
    return _authz_holder


@pytest.fixture(scope="session")
def mcp_http(core_asgi_app):
    """MCP sunucusunun kendisi (session-scoped: session_manager.run()
    tek kez). Upstream, core app'e ASGITransport ile baglanir."""
    from hermes_mcp import upstream
    from hermes_mcp.main import app as mcp_app

    upstream.set_client_factory(
        lambda: httpx.AsyncClient(
            transport=httpx.ASGITransport(app=core_asgi_app),
            timeout=15,
        )
    )
    with TestClient(mcp_app, raise_server_exceptions=False) as client:
        yield client


# WS3: CurrentUser/ApiClient artik tenant baglami ZORUNLU tasir.
TEST_TENANT_ID = "00000000-0000-0000-0000-0000000000a1"


# ── API client/token kurulumu (core test kalibinin kopyasi) ────────────


def make_api_client(s, name, bindings, *, client_type="service",
                    bound_user_id=None, scopes=None):
    from app.models.api_client import ApiClient, ApiClientAccess
    from app.services import api_client_service as svc

    client = ApiClient(
        # WS3: her API client TEK bir tenant'a baglidir.
        tenant_id=TEST_TENANT_ID,
        name=name,
        client_type=client_type,
        bound_user_id=bound_user_id,
        environment="dev",
        scopes=scopes if scopes is not None else ["tasks:read"],
        status="active",
        created_by=uuid.uuid4(),
    )
    s.add(client)
    s.flush()
    for b_type, target in bindings:
        s.add(
            ApiClientAccess(
                client_id=client.id, access_type=b_type, target_id=target
            )
        )
    plaintext, _row = svc.create_token(
        s, client, expires_at=None, created_by=uuid.uuid4()
    )
    return plaintext


# ── MCP JSON-RPC yardimi ────────────────────────────────────────────────

_RPC_ID = iter(range(1, 1_000_000))


def rpc(client, method, params=None, *, token=None):
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": next(_RPC_ID),
            "method": method,
            "params": params or {},
        },
        headers=headers,
    )


def call_tool(client, token, name, arguments=None):
    return rpc(
        client,
        "tools/call",
        {"name": name, "arguments": arguments or {}},
        token=token,
    )
