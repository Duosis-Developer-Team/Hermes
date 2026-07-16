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
    import app.models  # noqa: F401

    from app.database import Base

    with engine.begin() as conn:
        conn.execute(sa_text("CREATE SEQUENCE IF NOT EXISTS task_number_seq"))
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        for seq in (
            "tasks_type_seq_task",
            "tasks_type_seq_issue",
            "tasks_type_seq_suggestion",
        ):
            conn.execute(sa_text(f"CREATE SEQUENCE IF NOT EXISTS {seq}"))
        conn.execute(
            sa_text(
                "CREATE OR REPLACE FUNCTION assign_task_type_number() "
                "RETURNS trigger AS $$ BEGIN "
                "  IF NEW.type_number IS NULL THEN "
                "    IF NEW.task_type = 'issue' THEN "
                "      NEW.type_number := nextval('tasks_type_seq_issue'); "
                "    ELSIF NEW.task_type = 'suggestion' THEN "
                "      NEW.type_number := "
                "nextval('tasks_type_seq_suggestion'); "
                "    ELSE "
                "      NEW.type_number := nextval('tasks_type_seq_task'); "
                "    END IF; "
                "  END IF; "
                "  RETURN NEW; "
                "END; $$ LANGUAGE plpgsql"
            )
        )
        conn.execute(
            sa_text("DROP TRIGGER IF EXISTS trg_assign_type_number ON tasks")
        )
        conn.execute(
            sa_text(
                "CREATE TRIGGER trg_assign_type_number BEFORE INSERT ON "
                "tasks FOR EACH ROW EXECUTE PROCEDURE "
                "assign_task_type_number()"
            )
        )
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
    yield
    _db_holder["session"] = None


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


# ── API client/token kurulumu (core test kalibinin kopyasi) ────────────


def make_api_client(s, name, bindings, *, client_type="service",
                    bound_user_id=None, scopes=None):
    from app.models.api_client import ApiClient, ApiClientAccess
    from app.services import api_client_service as svc

    client = ApiClient(
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
