# =============================================================================
# hermes-mcp - Stage 5A testleri
# =============================================================================
# Uctan uca: MCP JSON-RPC → hermes_mcp → gercek core Public API → PG.
# Onayli 5A kapsami: handshake, scope-filtreli tools/list, whoami +
# 4 task read tool'u, hata eslemesi, non-disclosure, sizinti/SSRF
# kontrolleri. Write tool'u YOK (5C).
# =============================================================================

import logging
import uuid
from datetime import date

import pytest

from .conftest import call_tool, make_api_client, rpc

U1 = uuid.uuid4()
U2 = uuid.uuid4()


def _result(resp):
    body = resp.json()
    assert "error" not in body, body
    return body["result"]


def _tool_names(resp):
    return sorted(t["name"] for t in _result(resp)["tools"])


def _structured(resp):
    res = _result(resp)
    assert res.get("isError") is not True, res
    return res["structuredContent"]


def _tool_error(resp):
    import json as _json

    res = _result(resp)
    assert res.get("isError") is True, res
    return _json.loads(res["content"][0]["text"])


@pytest.fixture()
def world(pg_session):
    from sqlalchemy import text as sa_text

    from app.models.customer import Customer
    from app.models.project import Project
    from app.models.task import Task
    from app.models.task_comment import TaskComment

    s = pg_session
    s.execute(
        sa_text(
            "TRUNCATE task_comments, task_activity_events, tasks, "
            "projects, customers CASCADE"
        )
    )
    s.commit()

    c1 = Customer(id=uuid.uuid4(), name="Vakko", is_active=True)
    p1 = Project(id=uuid.uuid4(), customer_id=c1.id, name="ATM",
                 is_active=True)
    s.add_all([c1, p1])

    def task(n, title, assignee):
        return Task(
            id=uuid.uuid4(), task_number=n, type_number=n, task_type="task",
            title=title, description="d", customer_id=c1.id,
            project_id=p1.id, assignee_user_id=assignee,
            assigner_user_id=U2, scheduled_date=date(2026, 7, 1),
            status="pending", priority="medium",
        )

    t1 = task(501, "Renew TLS certificate", U1)
    t2 = task(502, "Update firewall rules", U1)
    t3 = task(503, "Rotate backup keys", U1)
    t_hidden = task(504, "SECRET OTHER TEAM WORK", U2)
    s.add_all([t1, t2, t3, t_hidden])
    s.flush()
    s.add(
        TaskComment(
            id=uuid.uuid4(), task_id=t1.id, author_user_id=U1,
            body="Cert ordered.",
        )
    )
    s.commit()
    return {"c1": c1, "p1": p1, "t1": t1, "t_hidden": t_hidden}


def u1_token(pg_session, scopes=None):
    return make_api_client(
        pg_session,
        f"mcp-{uuid.uuid4().hex[:6]}",
        [("user", U1)],
        scopes=scopes if scopes is not None else ["tasks:read"],
    )


# ── Servis yuzeyi ───────────────────────────────────────────────────────


def test_health(mcp_http):
    r = mcp_http.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["service"] == "hermes-mcp"
    assert body["status"] == "ok"


def test_initialize_reports_server_identity(mcp_http, pg_session):
    token = u1_token(pg_session)
    r = rpc(
        mcp_http,
        "initialize",
        {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "pytest", "version": "0"},
        },
        token=token,
    )
    info = _result(r)["serverInfo"]
    assert info["name"] == "hermes-mcp"
    assert info["version"]


# ── Kimlik + tools/list ────────────────────────────────────────────────


def test_tools_list_requires_token(mcp_http):
    """5D: token'siz POST HTTP-katmaninda 401 + WWW-Authenticate
    challenge alir (RFC 9728 PRM kesfi) — internal-beta bearer modu
    yanitta acikca soylenir."""
    r = rpc(mcp_http, "tools/list")
    assert r.status_code == 401
    www = r.headers.get("WWW-Authenticate", "")
    assert "resource_metadata=" in www
    assert "internal-beta" in r.json()["detail"]


def test_tools_list_rejects_bad_token(mcp_http, pg_session):
    r = rpc(mcp_http, "tools/list", token="hms_dev_" + "x" * 43)
    err = r.json().get("error")
    assert err is not None
    assert "token" in err["message"].lower()
    assert "hms_dev_" not in err["message"]  # token degeri yansitilmaz


def test_tools_list_scope_filtered(mcp_http, pg_session):
    full = u1_token(pg_session, scopes=["tasks:read"])
    assert _tool_names(rpc(mcp_http, "tools/list", token=full)) == [
        "hermes_get_task",
        "hermes_get_task_activity",
        "hermes_list_task_comments",
        "hermes_list_tasks",
        "hermes_whoami",
    ]
    # tasks:read olmayan token task tool'larini GORMEZ bile. (5B'den
    # itibaren read scope'larin kendi tool'lari var; hicbir read tool'u
    # olmayan bir scope'la dogrulanir.)
    narrow = u1_token(pg_session, scopes=["tasks:comment"])
    assert _tool_names(rpc(mcp_http, "tools/list", token=narrow)) == [
        "hermes_whoami"
    ]


def test_tools_are_read_only_annotated(mcp_http, pg_session):
    token = u1_token(pg_session)
    for tool in _result(rpc(mcp_http, "tools/list", token=token))["tools"]:
        assert tool["annotations"]["readOnlyHint"] is True, tool["name"]


# ── whoami + task read tool'lari ───────────────────────────────────────


def test_whoami_roundtrip(mcp_http, pg_session):
    token = u1_token(pg_session)
    out = _structured(call_tool(mcp_http, token, "hermes_whoami"))
    assert out["scopes"] == ["tasks:read"]
    assert out["client"]["environment"] == "dev"


def test_list_tasks_projection_and_paging(world, mcp_http, pg_session):
    token = u1_token(pg_session)
    out = _structured(
        call_tool(
            mcp_http, token, "hermes_list_tasks",
            {"limit": 2, "sort": "created_at"},
        )
    )
    assert out["count"] == 2
    assert out["has_more"] is True
    assert out["next_offset"] == 2
    item = out["items"][0]
    # Kompakt projeksiyon: description YOK, customer/project duz isim.
    assert "description" not in item
    assert item["customer"] == "Vakko"
    assert item["task_code"].startswith("TASK-")
    # Ikinci sayfa: kalan 1 gorunur kayit (U1'in 3 task'i var).
    out2 = _structured(
        call_tool(
            mcp_http, token, "hermes_list_tasks",
            {"limit": 2, "offset": 2, "sort": "created_at"},
        )
    )
    assert out2["count"] == 1
    assert out2["has_more"] is False
    assert out2["next_offset"] is None
    # Kapsam disi task hicbir sayfada yok.
    titles = [i["title"] for i in out["items"] + out2["items"]]
    assert "SECRET OTHER TEAM WORK" not in titles


def test_list_tasks_limit_schema_enforced(world, mcp_http, pg_session):
    token = u1_token(pg_session)
    res = _result(
        call_tool(mcp_http, token, "hermes_list_tasks", {"limit": 200})
    )
    assert res.get("isError") is True
    assert "validation" in res["content"][0]["text"].lower()


def test_get_task_case_insensitive_full_schema(world, mcp_http, pg_session):
    token = u1_token(pg_session)
    out = _structured(
        call_tool(
            mcp_http, token, "hermes_get_task", {"task_code": "task-501"}
        )
    )
    assert out["task_code"] == "TASK-501"
    assert out["description"] == "d"  # detay = tam public sema


def test_get_task_nondisclosure_identical(world, mcp_http, pg_session):
    token = u1_token(pg_session)
    hidden = _tool_error(
        call_tool(
            mcp_http, token, "hermes_get_task", {"task_code": "TASK-504"}
        )
    )
    missing = _tool_error(
        call_tool(
            mcp_http, token, "hermes_get_task", {"task_code": "TASK-99999"}
        )
    )
    assert hidden["error"]["code"] == "resource_not_found"
    assert (
        hidden["error"]["message"]
        == missing["error"]["message"]
        == "Not found (or not visible to this token)."
    )
    assert "outside this token's data access" in hidden["guidance"]


def test_comments_and_activity(world, mcp_http, pg_session):
    token = u1_token(pg_session)
    comments = _structured(
        call_tool(
            mcp_http, token, "hermes_list_task_comments",
            {"task_code": "TASK-501"},
        )
    )
    assert comments["count"] == 1
    assert comments["items"][0]["body"] == "Cert ordered."
    activity = _structured(
        call_tool(
            mcp_http, token, "hermes_get_task_activity",
            {"task_code": "TASK-501"},
        )
    )
    assert activity["items"] == [] and activity["has_more"] is False


# ── Hata eslemesi + yetki ──────────────────────────────────────────────


def test_insufficient_scope_maps_cleanly(world, mcp_http, pg_session):
    token = u1_token(pg_session, scopes=["customers:read"])
    err = _tool_error(call_tool(mcp_http, token, "hermes_list_tasks"))
    assert err["error"]["code"] == "insufficient_scope"
    assert err["retryable"] is False
    assert "administrator" in err["guidance"]


def test_revoked_token_fails_at_invocation(world, mcp_http, pg_session):
    from app.models.api_client import ApiToken

    token = u1_token(pg_session)
    ok = _structured(call_tool(mcp_http, token, "hermes_whoami"))
    assert ok["client"]["type"] == "service"

    pg_session.query(ApiToken).update({"status": "revoked"})
    pg_session.commit()
    from hermes_mcp.auth import clear_visibility_cache

    clear_visibility_cache()

    # Invocation ANINDA reddedilir (yetki API'de, cache degil).
    err = _tool_error(call_tool(mcp_http, token, "hermes_whoami"))
    assert err["error"]["code"] == "revoked_token"
    # tools/list de artik hata verir.
    r = rpc(mcp_http, "tools/list", token=token)
    assert r.json().get("error") is not None


def test_unknown_tool_rejected(mcp_http, pg_session):
    token = u1_token(pg_session)
    res = _result(call_tool(mcp_http, token, "hermes_delete_everything"))
    # SDK, handler istisnasini isError sonucuna cevirir — protokol
    # hatasi degil, model-okur hata: bilinmeyen arac reddedilir.
    assert res.get("isError") is True
    assert "Unknown tool" in res["content"][0]["text"]


# ── Sizinti + SSRF kontrolleri ─────────────────────────────────────────


def test_no_token_or_content_leak_in_logs(
    world, mcp_http, pg_session, caplog
):
    token = u1_token(pg_session)
    with caplog.at_level(logging.INFO):
        _structured(
            call_tool(
                mcp_http, token, "hermes_get_task",
                {"task_code": "TASK-501"},
            )
        )
    joined = " ".join(r.getMessage() for r in caplog.records)
    assert token not in joined  # bearer plaintext asla loglanmaz
    assert "Renew TLS certificate" not in joined  # icerik loglanmaz


def test_upstream_rejects_absolute_paths():
    import anyio

    from hermes_mcp.upstream import api_request

    async def attempt(path):
        with pytest.raises(ValueError):
            await api_request("GET", path, token="t", tool="x")

    anyio.run(attempt, "http://evil.example/steal")
    anyio.run(attempt, "/etc/passwd")


def test_path_traversal_in_task_code_is_quoted(world, mcp_http, pg_session):
    token = u1_token(pg_session)
    err = _tool_error(
        call_tool(
            mcp_http, token, "hermes_get_task", {"task_code": "../me"}
        )
    )
    # Quote edilen segment API'de gecersiz koda donusur → ayni 404 zarfi;
    # baska bir route'a KACAMAZ.
    assert err["error"]["code"] == "resource_not_found"


# ── Kayit tutarliligi (5A-lite contract lock) ──────────────────────────


def test_registry_names_and_scopes_consistent(mcp_http, pg_session):
    import re

    from hermes_mcp.registry import REGISTRY

    caps_token = u1_token(pg_session)  # capabilities auth istemiyor ama
    del caps_token  # token uretimi DB fixtures'i isitir
    import anyio

    from hermes_mcp.upstream import api_request

    async def caps():
        status, body = await api_request(
            "GET", "capabilities", token="", tool="__test__"
        )
        return body

    body = anyio.run(caps)
    catalog = set(body["scopes"].keys())
    names = [t.name for t in REGISTRY]
    assert len(names) == len(set(names))
    for spec in REGISTRY:
        assert re.match(r"^hermes_[a-z_]+$", spec.name)
        assert spec.scope is None or spec.scope in catalog
        assert "untrusted" in spec.description


def test_runtime_imports_no_core_or_db():
    """Yapisal garanti (D5-1): hermes_mcp kaynak kodu core-service'i,
    SQLAlchemy'yi veya bir DB surucusunu IMPORT EDEMEZ."""
    import pathlib
    import re

    pkg = pathlib.Path(__file__).parent.parent / "hermes_mcp"
    banned = re.compile(
        r"^\s*(from|import)\s+(app\b|shared\b|sqlalchemy|psycopg|asyncpg)"
    )
    for f in pkg.glob("*.py"):
        for i, line in enumerate(f.read_text().splitlines(), 1):
            assert not banned.match(line), f"{f.name}:{i}: {line.strip()}"
