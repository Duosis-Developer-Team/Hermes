# =============================================================================
# hermes-mcp - hermes_create_task_for_group entegrasyon testleri
# =============================================================================
# Zincir GERCEK: MCP JSON-RPC → hermes_mcp → core Public API
# (POST /v1/task-groups) → gercek Postgres. Fan-out semantigi burada
# UCTAN UCA dogrulanir; hermes_mcp'nin kendisi is kurali TASIMAZ.
#
# Not: izin modeli geregi (task_service._resolve_effective_for_user) bir
# kullanicinin AKTIF grup uyeligi varsa direkt izin satiri YOK SAYILIR —
# bu yuzden fixture grup izinlerini seed eder.
# =============================================================================

import uuid

import pytest

from .conftest import call_tool, make_api_client, rpc

BU = uuid.uuid4()          # bound user = atayan, grubun DA uyesi
M1 = uuid.uuid4()
M2 = uuid.uuid4()
M_NOACCESS = uuid.uuid4()

WRITE_SCOPES = ["tasks:read", "tasks:write"]

TOOL = "hermes_create_task_for_group"


def _structured(resp):
    body = resp.json()
    assert "error" not in body, body
    res = body["result"]
    assert res.get("isError") is not True, res
    return res["structuredContent"]


def _tool_error(resp):
    import json as _json

    res = resp.json()["result"]
    assert res.get("isError") is True, res
    return _json.loads(res["content"][0]["text"])


@pytest.fixture()
def world(pg_session):
    from sqlalchemy import text as sa_text

    from app.models.customer import Customer
    from app.models.project import Project
    from app.models.task import TaskAssignmentGroupRelation
    from app.models.user_group import (
        TaskGroupMemberOverride,
        TaskGroupPermission,
        UserGroup,
        UserGroupMember,
    )

    s = pg_session
    s.execute(
        sa_text(
            "TRUNCATE task_comments, task_activity_events, tasks, "
            "task_assignment_relations, task_assignment_group_relations, "
            "task_user_permissions, task_group_member_overrides, "
            "task_group_permissions, user_group_members, user_groups, "
            "projects, customers CASCADE"
        )
    )
    s.commit()

    c1 = Customer(id=uuid.uuid4(), name="Vakko", is_active=True)
    p1 = Project(
        id=uuid.uuid4(), customer_id=c1.id, name="ATM", is_active=True
    )
    g = UserGroup(id=uuid.uuid4(), name="Backend Team", is_active=True)
    s.add_all([c1, p1, g])
    s.commit()  # FK: asagidaki satirlar user_groups'a bagli.

    s.add_all(
        [
            TaskGroupPermission(
                group_id=g.id,
                can_access_tasks_default=True,
                can_assign_tasks_default=True,
            ),
            TaskGroupMemberOverride(
                group_id=g.id,
                user_id=M_NOACCESS,
                can_access_tasks_override=False,
            ),
            TaskAssignmentGroupRelation(
                assigner_user_id=BU, assignee_group_id=g.id, scope="task"
            ),
            UserGroupMember(group_id=g.id, user_id=BU, is_active=True),
            UserGroupMember(group_id=g.id, user_id=M1, is_active=True),
            UserGroupMember(group_id=g.id, user_id=M2, is_active=True),
            UserGroupMember(
                group_id=g.id, user_id=M_NOACCESS, is_active=True
            ),
        ]
    )
    s.commit()
    return {"c1": c1, "p1": p1, "g": g}


def _bound_token(pg_session, user_id=BU, scopes=None):
    return make_api_client(
        pg_session,
        f"ub-{uuid.uuid4().hex[:6]}",
        [("user", user_id)],
        client_type="user",
        bound_user_id=user_id,
        scopes=WRITE_SCOPES if scopes is None else scopes,
    )


def _args(world, **over):
    base = {
        "title": "Rotate staging credentials",
        "description": "Each member rotates their own token.",
        "customer_id": str(world["c1"].id),
        "project_id": str(world["p1"].id),
        "assignee_group_id": str(world["g"].id),
        "scheduled_date": "2026-07-20",
        "priority": "high",
    }
    base.update(over)
    return base


def test_tool_fans_out_through_the_real_chain(
    mcp_http, world, pg_session
):
    token = _bound_token(pg_session)
    out = _structured(call_tool(mcp_http, token, TOOL, _args(world)))

    # 4 aktif uye (BU, M1, M2, M_NOACCESS) → uygun olan M1+M2.
    assert out["created_count"] == 2
    assert out["skipped_count"] == 2
    assert out["group_name"] == "Backend Team"
    assert out["assignment_batch_id"]
    assignees = {t["assignee_user_id"] for t in out["created_tasks"]}
    assert assignees == {str(M1), str(M2)}
    # Atayan grubun uyesi OLMASINA ragmen kendine task acilmaz.
    assert str(BU) not in assignees


def test_tool_listed_only_for_user_bound(mcp_http, world, pg_session):
    ub = _bound_token(pg_session)
    names = {
        t["name"]
        for t in rpc(mcp_http, "tools/list", token=ub).json()["result"][
            "tools"
        ]
    }
    assert TOOL in names

    svc = make_api_client(
        pg_session, "svc-g", [("global", None)], scopes=WRITE_SCOPES
    )
    svc_names = {
        t["name"]
        for t in rpc(mcp_http, "tools/list", token=svc).json()["result"][
            "tools"
        ]
    }
    assert TOOL not in svc_names


def test_service_client_call_rejected_by_api(mcp_http, world, pg_session):
    """Tool listelenmese bile dogrudan cagri API'de 403 olur —
    yetki tek otorite Public API."""
    svc = make_api_client(
        pg_session, "svc-g2", [("global", None)], scopes=WRITE_SCOPES
    )
    err = _tool_error(call_tool(mcp_http, svc, TOOL, _args(world)))
    assert err["error"]["code"] == "resource_access_denied"


def test_unknown_group_maps_to_not_found(mcp_http, world, pg_session):
    token = _bound_token(pg_session)
    err = _tool_error(
        call_tool(
            mcp_http,
            token,
            TOOL,
            _args(world, assignee_group_id=str(uuid.uuid4())),
        )
    )
    assert err["error"]["code"] == "resource_not_found"


def test_member_list_argument_is_rejected(mcp_http, world, pg_session):
    """Alicilar gruptan turetilir; sema uye listesini kabul etmez
    (additionalProperties=false)."""
    token = _bound_token(pg_session)
    resp = call_tool(
        mcp_http, token, TOOL, _args(world, assignee_user_ids=[str(M1)])
    )
    body = resp.json()
    assert "error" in body or body["result"].get("isError") is True


def test_transport_retry_does_not_double_fan_out(
    mcp_http, world, pg_session
):
    """Ayni JSON-RPC request id ile iki kez → tek fan-out (otomatik
    transport-retry katmani)."""
    from app.models.task import Task

    token = _bound_token(pg_session)
    payload = {
        "jsonrpc": "2.0",
        "id": 909100,
        "method": "tools/call",
        "params": {"name": TOOL, "arguments": _args(world)},
    }
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Authorization": f"Bearer {token}",
    }
    r1 = mcp_http.post("/mcp", json=payload, headers=headers)
    r2 = mcp_http.post("/mcp", json=payload, headers=headers)
    assert r1.status_code == 200 and r2.status_code == 200

    batches = {
        str(row.assignment_batch_id)
        for row in pg_session.query(Task).all()
    }
    assert len(batches) == 1  # tek fan-out
    assert pg_session.query(Task).count() == 2
