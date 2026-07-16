# =============================================================================
# hermes-mcp - Stage 5B testleri: tam read kapsami + contract lock
# =============================================================================
# Kapsam: 8 yeni read tool (customers/projects/work-logs/meetings),
# kompakt projeksiyonlar, truncation (H), private meeting maskesi,
# TAM tool→OpenAPI contract lock (F), eksiksiz hata eslemesi (G).
# NOT: users:read/groups:read dizin endpoint'leri S2S kaynak karari
# bekliyor — bu dosyada YOK (rapora bakin).
# =============================================================================

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import anyio
import pytest

from .conftest import call_tool, make_api_client, rpc

U1 = uuid.uuid4()
U2 = uuid.uuid4()
NOW = datetime(2026, 7, 16, 9, 0, tzinfo=timezone.utc)

ALL_READ_SCOPES = [
    "tasks:read",
    "customers:read",
    "projects:read",
    "work-logs:read",
    "meetings:read",
]

EXPECTED_TOOLS = sorted(
    [
        "hermes_whoami",
        "hermes_list_tasks",
        "hermes_get_task",
        "hermes_get_task_activity",
        "hermes_list_task_comments",
        "hermes_list_customers",
        "hermes_get_customer",
        "hermes_list_projects",
        "hermes_get_project",
        "hermes_list_work_logs",
        "hermes_get_work_log",
        "hermes_list_meetings",
        "hermes_get_meeting",
    ]
)


def _result(resp):
    body = resp.json()
    assert "error" not in body, body
    return body["result"]


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
    from app.models.meeting import Meeting, MeetingAttendee
    from app.models.project import Project
    from app.models.task import Task
    from app.models.work_log import WorkLog
    from app.models.work_type import WorkType

    s = pg_session
    s.execute(
        sa_text(
            "TRUNCATE work_logs, meeting_attendees, meetings, "
            "task_comments, task_activity_events, tasks, work_types, "
            "projects, customers CASCADE"
        )
    )
    s.commit()

    c1 = Customer(id=uuid.uuid4(), name="Vakko", is_active=True)
    c_hidden = Customer(id=uuid.uuid4(), name="Hidden Corp",
                        is_active=True)
    p1 = Project(id=uuid.uuid4(), customer_id=c1.id, name="ATM",
                 is_active=True)
    p_hidden = Project(id=uuid.uuid4(), customer_id=c_hidden.id,
                       name="Secret", is_active=True)
    wt = WorkType(id=uuid.uuid4(), name="Dev", is_active=True)
    s.add_all([c1, c_hidden, p1, p_hidden, wt])

    t1 = Task(
        id=uuid.uuid4(), task_number=601, type_number=601,
        task_type="task", title="mine", description="d",
        customer_id=c1.id, project_id=p1.id, assignee_user_id=U1,
        assigner_user_id=U2, scheduled_date=date(2026, 7, 1),
        status="pending", priority="medium",
    )
    s.add(t1)
    s.flush()

    w1 = WorkLog(
        user_id=U1, customer_id=c1.id, project_id=p1.id,
        work_type_id=wt.id, date_worked=date(2026, 7, 10),
        duration_hours=Decimal("2.5"), description="X" * 5000,
        task_id=t1.id,
    )
    w_hidden = WorkLog(
        user_id=U2, customer_id=c_hidden.id, project_id=p_hidden.id,
        work_type_id=wt.id, date_worked=date(2026, 7, 11),
        duration_hours=Decimal("1.0"), description="hidden",
    )
    s.add_all([w1, w_hidden])

    def meeting(ext, subject, start, private=False, cancelled=False):
        return Meeting(
            id=uuid.uuid4(), external_event_id=ext, source="graph",
            subject="Private Meeting" if private else subject,
            body_preview=None if private else "PREVIEW BODY",
            organizer_email="org@duosis.com", organizer_name="Org",
            start_datetime=start,
            end_datetime=start + timedelta(hours=1),
            duration_minutes=60, is_online_meeting=True,
            join_url="https://teams.example/j/1",
            is_cancelled=cancelled,
            sensitivity="private" if private else "normal",
        )

    m1 = meeting("e1", "Sprint Sync", NOW + timedelta(days=1))
    m_priv = meeting("e2", "SECRET SUBJECT", NOW + timedelta(days=2),
                     private=True)
    m_hidden = meeting("e3", "Other Team", NOW + timedelta(days=3))
    m_cancel = meeting("e4", "Cancelled One", NOW + timedelta(days=4),
                       cancelled=True)
    s.add_all([m1, m_priv, m_hidden, m_cancel])
    s.flush()
    for m, user in ((m1, U1), (m_priv, U1), (m_hidden, U2),
                    (m_cancel, U1)):
        s.add(
            MeetingAttendee(
                id=uuid.uuid4(), meeting_id=m.id, email="a@x.com",
                hermes_user_id=user,
            )
        )
    s.commit()
    return {
        "c1": c1, "c_hidden": c_hidden, "p1": p1, "p_hidden": p_hidden,
        "w1": w1, "w_hidden": w_hidden, "m1": m1, "m_priv": m_priv,
        "m_hidden": m_hidden, "m_cancel": m_cancel, "t1": t1,
    }


def u1_token(pg_session, scopes=None):
    return make_api_client(
        pg_session,
        f"mcp5b-{uuid.uuid4().hex[:6]}",
        [("user", U1)],
        scopes=scopes if scopes is not None else ALL_READ_SCOPES,
    )


# ── Tool envanteri ──────────────────────────────────────────────────────


def test_full_read_inventory_listed(mcp_http, pg_session):
    token = u1_token(pg_session)
    names = sorted(
        t["name"]
        for t in _result(rpc(mcp_http, "tools/list", token=token))["tools"]
    )
    assert names == EXPECTED_TOOLS


def test_scope_filtering_per_resource(mcp_http, pg_session):
    token = u1_token(pg_session, scopes=["meetings:read"])
    names = sorted(
        t["name"]
        for t in _result(rpc(mcp_http, "tools/list", token=token))["tools"]
    )
    assert names == [
        "hermes_get_meeting",
        "hermes_list_meetings",
        "hermes_whoami",
    ]


# ── Customers / Projects ───────────────────────────────────────────────


def test_customers_derived_visibility_and_search(
    world, mcp_http, pg_session
):
    token = u1_token(pg_session)
    out = _structured(call_tool(mcp_http, token, "hermes_list_customers"))
    names = [c["name"] for c in out["items"]]
    assert names == ["Vakko"]  # turetilmis gorunurluk: Hidden Corp YOK

    found = _structured(
        call_tool(mcp_http, token, "hermes_list_customers", {"q": "vak"})
    )
    assert found["count"] == 1

    hidden = _tool_error(
        call_tool(
            mcp_http, token, "hermes_get_customer",
            {"customer_id": str(world["c_hidden"].id)},
        )
    )
    missing = _tool_error(
        call_tool(
            mcp_http, token, "hermes_get_customer",
            {"customer_id": str(uuid.uuid4())},
        )
    )
    assert (
        hidden["error"]["message"]
        == missing["error"]["message"]
        == "Not found (or not visible to this token)."
    )


def test_projects_filter_by_customer(world, mcp_http, pg_session):
    token = u1_token(pg_session)
    out = _structured(
        call_tool(
            mcp_http, token, "hermes_list_projects",
            {"customer_id": str(world["c1"].id)},
        )
    )
    assert [p["name"] for p in out["items"]] == ["ATM"]
    detail = _structured(
        call_tool(
            mcp_http, token, "hermes_get_project",
            {"project_id": str(world["p1"].id)},
        )
    )
    assert detail["customer_id"] == str(world["c1"].id)


# ── Work logs ───────────────────────────────────────────────────────────


def test_work_logs_projection_detail_and_truncation(
    world, mcp_http, pg_session
):
    token = u1_token(pg_session)
    out = _structured(call_tool(mcp_http, token, "hermes_list_work_logs"))
    assert out["count"] == 1  # w_hidden gorunmez
    item = out["items"][0]
    assert "description" not in item  # kompakt projeksiyon
    assert "billable_duration_hours" not in item
    assert item["task_code"] == "TASK-601"
    assert item["customer"] == "Vakko"

    detail = _structured(
        call_tool(
            mcp_http, token, "hermes_get_work_log",
            {"work_log_id": item["id"]},
        )
    )
    # H: 5000 karakterlik aciklama ACIK isaretle 4000'e kirpilir.
    assert len(detail["description"]) == 4000
    assert detail["truncated"] == ["description"]
    assert detail["duration_hours"] == 2.5


def test_work_log_user_filter(world, mcp_http, pg_session):
    token = u1_token(pg_session)
    out = _structured(
        call_tool(
            mcp_http, token, "hermes_list_work_logs",
            {"user_id": str(U2)},
        )
    )
    assert out["count"] == 0  # U2'nin kaydi bu token'a gorunmez


# ── Meetings ────────────────────────────────────────────────────────────


def test_meetings_compact_private_and_cancelled(
    world, mcp_http, pg_session
):
    token = u1_token(pg_session)
    out = _structured(call_tool(mcp_http, token, "hermes_list_meetings"))
    subjects = {m["subject"] for m in out["items"]}
    assert subjects == {"Sprint Sync", "Private Meeting"}
    for m in out["items"]:
        assert "join_url" not in m  # kompakt projeksiyon
        assert "body_preview" not in m
    priv = next(m for m in out["items"] if m["is_private"])
    assert priv["subject"] == "Private Meeting"  # maske korunur

    withc = _structured(
        call_tool(
            mcp_http, token, "hermes_list_meetings",
            {"include_cancelled": True},
        )
    )
    assert withc["count"] == 3


def test_meeting_detail_and_nondisclosure(world, mcp_http, pg_session):
    token = u1_token(pg_session)
    detail = _structured(
        call_tool(
            mcp_http, token, "hermes_get_meeting",
            {"meeting_id": str(world["m1"].id)},
        )
    )
    assert detail["join_url"] == "https://teams.example/j/1"
    assert "body_preview" not in detail

    hidden = _tool_error(
        call_tool(
            mcp_http, token, "hermes_get_meeting",
            {"meeting_id": str(world["m_hidden"].id)},
        )
    )
    missing = _tool_error(
        call_tool(
            mcp_http, token, "hermes_get_meeting",
            {"meeting_id": str(uuid.uuid4())},
        )
    )
    assert hidden["error"]["message"] == missing["error"]["message"]


# ── Girdi dogrulama ────────────────────────────────────────────────────


def test_malformed_enum_rejected(world, mcp_http, pg_session):
    token = u1_token(pg_session)
    res = _result(
        call_tool(
            mcp_http, token, "hermes_list_meetings", {"sort": "bogus"}
        )
    )
    assert res.get("isError") is True
    assert "validation" in res["content"][0]["text"].lower()


# ── G: eksiksiz hata eslemesi ──────────────────────────────────────────


def test_error_mapping_covers_all_api_codes():
    from app.public_api.errors import ERROR_STATUS
    from hermes_mcp.errors import map_api_error

    for code, status in ERROR_STATUS.items():
        payload = map_api_error(
            status,
            {
                "error": {
                    "code": code,
                    "message": "m",
                    "request_id": "req_x1",
                }
            },
        )
        assert payload["error"]["code"] == code
        assert payload["error"]["request_id"] == "req_x1"
        assert payload["guidance"], code
        assert isinstance(payload["retryable"], bool)
        # Internal istisna adi / stack sizmaz.
        assert "Traceback" not in str(payload)
    # Ozel sozlesmeler:
    assert (
        map_api_error(404, {"error": {"code": "resource_not_found"}})[
            "error"
        ]["message"]
        == "Not found (or not visible to this token)."
    )
    assert map_api_error(
        429, {"error": {"code": "rate_limit_exceeded"}}
    )["retryable"] is True
    assert map_api_error(
        409, {"error": {"code": "idempotency_request_in_progress"}}
    )["retryable"] is True


# ── F: TAM contract lock ───────────────────────────────────────────────


def _fetch_openapi():
    from hermes_mcp.upstream import api_request

    async def go():
        # openapi.json /api/public altinda /v1 disinda yasar — testte
        # base'in bir ust seviyesinden cekilir (yalnizca test).
        import httpx

        from hermes_mcp import upstream

        client = await upstream._get_client()
        resp = await client.get(
            "http://core-test/api/public/v1/openapi.json"
        )
        return resp.json()

    return anyio.run(go)


def test_full_contract_lock(mcp_http, pg_session):
    """Her tool: metod+path OpenAPI'de var; scope endpoint'inkiyle
    birebir; annotation GET ile tutarli; input alanlari endpoint
    parametrelerinin alt kumesi; projeksiyon alanlari yanit semasinin
    KESIN alt kumesi; internal path/host yok. Drift = CI kirmizi."""
    from hermes_mcp.registry import (
        CONTRACT,
        PATH_PARAM_ALIASES,
        REGISTRY,
        TOOLS_BY_NAME,
    )

    spec = _fetch_openapi()
    paths = spec["paths"]
    schemas = spec["components"]["schemas"]

    assert set(CONTRACT.keys()) == set(TOOLS_BY_NAME.keys())

    for tool in REGISTRY:
        method, path, projection = CONTRACT[tool.name]
        assert path.startswith("/v1/") and "://" not in path, tool.name
        op = paths[path][method.lower()]

        # Scope birebir eslesir (whoami: scope'suz endpoint).
        required = op.get("x-required-scopes")
        if tool.scope is None:
            assert not required, tool.name
        else:
            assert required == [tool.scope], tool.name

        # 5B'de tum tool'lar read-only ⇔ GET.
        assert method == "GET", tool.name
        assert tool.to_mcp_tool().annotations.readOnlyHint is True

        # Input alanlari ⊆ endpoint query+path parametreleri.
        op_params = {
            p["name"] for p in op.get("parameters", [])
        }
        for prop in tool.input_schema.get("properties", {}):
            mapped = PATH_PARAM_ALIASES.get(prop, prop)
            assert mapped in op_params, f"{tool.name}.{prop}"

        # Liste projeksiyonu ⊆ yanit item semasi property'leri.
        if projection is not None:
            ref = op["responses"]["200"]["content"]["application/json"][
                "schema"
            ]["$ref"]
            page_schema = schemas[ref.split("/")[-1]]
            item_ref = page_schema["properties"]["data"]["items"]["$ref"]
            item_props = set(
                schemas[item_ref.split("/")[-1]]["properties"].keys()
            )
            extra = set(projection) - item_props
            assert not extra, f"{tool.name}: {extra}"


# ── 5A guard'lari 5B sonrasi da gecerli ────────────────────────────────


def test_import_guard_still_holds():
    import pathlib
    import re

    pkg = pathlib.Path(__file__).parent.parent / "hermes_mcp"
    banned = re.compile(
        r"^\s*(from|import)\s+(app\b|shared\b|sqlalchemy|psycopg|asyncpg)"
    )
    for f in pkg.glob("*.py"):
        for i, line in enumerate(f.read_text().splitlines(), 1):
            assert not banned.match(line), f"{f.name}:{i}"
