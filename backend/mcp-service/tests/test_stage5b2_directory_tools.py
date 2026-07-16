# =============================================================================
# hermes-mcp - Stage 5B-2: directory tool'lari
# =============================================================================
# hermes_mcp auth-service'i HICBIR ZAMAN dogrudan cagirmaz — zincir:
# MCP → core Public API → (core'un S2S istemcisi, testte mock).
# =============================================================================

import uuid
from datetime import date

import pytest

from .conftest import call_tool, make_api_client, rpc

U1 = uuid.uuid4()
U2 = uuid.uuid4()

DIR_SCOPES = ["tasks:read", "users:read", "groups:read"]


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
    from app.models.project import Project
    from app.models.task import Task
    from app.models.user_group import UserGroup, UserGroupMember

    s = pg_session
    s.execute(
        sa_text(
            "TRUNCATE user_group_members, user_groups, work_logs, "
            "meeting_attendees, meetings, task_comments, "
            "task_activity_events, tasks, projects, customers CASCADE"
        )
    )
    s.commit()
    c1 = Customer(id=uuid.uuid4(), name="Vakko", is_active=True)
    p1 = Project(id=uuid.uuid4(), customer_id=c1.id, name="ATM",
                 is_active=True)
    s.add_all([c1, p1])
    s.add(
        Task(
            id=uuid.uuid4(), task_number=801, type_number=801,
            task_type="task", title="t", description="d",
            customer_id=c1.id, project_id=p1.id,
            assignee_user_id=U1, assigner_user_id=U2,
            scheduled_date=date(2026, 7, 1), status="pending",
            priority="medium",
        )
    )
    g1 = UserGroup(id=uuid.uuid4(), name="Platform Team",
                   is_active=True)
    s.add(g1)
    s.flush()
    s.add(
        UserGroupMember(id=uuid.uuid4(), group_id=g1.id, user_id=U1,
                        is_active=True)
    )
    s.commit()
    return {"g1": g1}


def token_for(pg_session, scopes=None):
    return make_api_client(
        pg_session,
        f"mcp5b2-{uuid.uuid4().hex[:6]}",
        [("user", U1)],
        client_type="user",
        bound_user_id=U1,
        scopes=scopes or DIR_SCOPES,
    )


def test_directory_tools_listed_with_scopes(mcp_http, pg_session):
    token = token_for(pg_session)
    names = sorted(
        t["name"]
        for t in _result(rpc(mcp_http, "tools/list", token=token))["tools"]
    )
    for expected in (
        "hermes_list_users",
        "hermes_get_user",
        "hermes_list_groups",
        "hermes_get_group",
    ):
        assert expected in names
    # users:read'siz token dizin tool'larini gormez.
    narrow = token_for(pg_session, scopes=["tasks:read"])
    names = sorted(
        t["name"]
        for t in _result(
            rpc(mcp_http, "tools/list", token=narrow)
        )["tools"]
    )
    assert "hermes_list_users" not in names


def test_list_users_derived_visibility(world, mcp_http, pg_session):
    token = token_for(pg_session)
    out = _structured(call_tool(mcp_http, token, "hermes_list_users"))
    ids = {u["id"] for u in out["items"]}
    assert {str(U1), str(U2)} <= ids  # kendisi + task atayani
    for u in out["items"]:
        assert set(u.keys()) == {
            "id", "display_name", "work_email", "is_active",
        }


def test_get_user_nondisclosure(world, mcp_http, pg_session):
    token = token_for(pg_session)
    stranger = _tool_error(
        call_tool(
            mcp_http, token, "hermes_get_user",
            {"user_id": str(uuid.uuid4())},
        )
    )
    assert stranger["error"]["code"] == "resource_not_found"
    assert (
        stranger["error"]["message"]
        == "Not found (or not visible to this token)."
    )


def test_groups_tools(world, mcp_http, pg_session):
    token = token_for(pg_session)
    out = _structured(call_tool(mcp_http, token, "hermes_list_groups"))
    assert [g["name"] for g in out["items"]] == ["Platform Team"]
    assert out["items"][0]["member_count"] == 1
    detail = _structured(
        call_tool(
            mcp_http, token, "hermes_get_group",
            {"group_id": str(world["g1"].id)},
        )
    )
    assert detail["name"] == "Platform Team"
    assert "members" not in detail


def test_mcp_never_calls_auth_service_directly():
    """Yapisal: hermes_mcp'de auth-service/dizin URL'i yok; tek upstream
    Public API base'idir."""
    import pathlib

    pkg = pathlib.Path(__file__).parent.parent / "hermes_mcp"
    for f in pkg.glob("*.py"):
        text = f.read_text()
        assert "auth-service" not in text, f.name
        assert "internal/directory" not in text, f.name
