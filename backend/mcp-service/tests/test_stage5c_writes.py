# =============================================================================
# hermes-mcp - Stage 5C testleri: write tool'lari
# =============================================================================
# Onayli kurallar: user-bound only, write scope, service client write
# tool'u GORMEZ ve cagiramaz, iki katmanli idempotency (otomatik
# transport-retry + acik idempotency_key), annotation'lar, sahiplik
# override edilemez, log sizintisi yok. Public API tek otorite —
# hiyerarsi/atama/durum kurallari GERCEK zincirle sinanir.
# =============================================================================

import logging
import uuid
from datetime import date

import pytest

from .conftest import call_tool, make_api_client, rpc

BU = uuid.uuid4()   # bound user (assigner yetkili)
AS = uuid.uuid4()   # assignee
OUT = uuid.uuid4()  # hiyerarside olmayan

WRITE_SCOPES = [
    "tasks:read",
    "tasks:write",
    "tasks:comment",
    "tasks:complete",
    "work-logs:write",
]

WRITE_TOOLS = {
    "hermes_create_task",
    "hermes_create_task_for_group",
    "hermes_update_task",
    "hermes_add_task_comment",
    "hermes_complete_task",
    "hermes_change_task_status",
    "hermes_log_time",
}


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


def rpc_with_id(client, rpc_id, method, params, token):
    return client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": rpc_id,
            "method": method,
            "params": params,
        },
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "Authorization": f"Bearer {token}",
        },
    )


@pytest.fixture()
def world(pg_session, authz_grants):
    from sqlalchemy import text as sa_text

    from app.models.customer import Customer
    from app.models.project import Project
    from app.models.task import (
        Task,
        TaskAssignmentRelation,
    )
    from app.models.work_type import WorkType

    s = pg_session
    s.execute(
        sa_text(
            "TRUNCATE user_group_members, user_groups, work_logs, "
            "meeting_attendees, meetings, task_comments, "
            "task_activity_events, tasks, task_assignment_relations, "
            "task_user_permissions, work_types, projects, customers "
            "CASCADE"
        )
    )
    s.commit()

    c1 = Customer(id=uuid.uuid4(), name="Vakko", is_active=True)
    p1 = Project(id=uuid.uuid4(), customer_id=c1.id, name="ATM",
                 is_active=True)
    wt = WorkType(id=uuid.uuid4(), name="Dev", is_active=True)
    s.add_all([c1, p1, wt])
    # RBAC cutover: izinler rollerden (authz_grants); hiyerarsi BU→AS.
    authz_grants[str(BU)] = ["tasks.access", "tasks.assign"]
    authz_grants[str(AS)] = ["tasks.access"]
    s.add_all(
        [
            TaskAssignmentRelation(
                assigner_user_id=BU, assignee_user_id=AS, scope="task"
            ),
        ]
    )
    # AS'in tamamlayacagi hazir task.
    t1 = Task(
        id=uuid.uuid4(), task_number=901, type_number=901,
        task_type="task", title="assigned", description="d",
        customer_id=c1.id, project_id=p1.id, assignee_user_id=AS,
        assigner_user_id=BU, scheduled_date=date(2026, 7, 1),
        status="pending", priority="medium",
    )
    s.add(t1)
    s.commit()
    return {"c1": c1, "p1": p1, "wt": wt, "t1": t1}


def token_for(pg_session, user, scopes=None, client_type="user"):
    return make_api_client(
        pg_session,
        f"mcp5c-{uuid.uuid4().hex[:6]}",
        [("user", user)],
        client_type=client_type,
        bound_user_id=user if client_type == "user" else None,
        scopes=scopes or WRITE_SCOPES,
    )


def create_args(world, **over):
    base = {
        "title": "MCP created task",
        "description": "created via mcp",
        "customer_id": str(world["c1"].id),
        "project_id": str(world["p1"].id),
        "assignee_user_id": str(AS),
        "scheduled_date": "2026-07-20",
        "priority": "high",
    }
    base.update(over)
    return base


def _task_count(s, title):
    from app.models.task import Task

    return s.query(Task).filter(Task.title == title).count()


# ── Gorunurluk + annotation'lar ────────────────────────────────────────


def test_write_tools_visible_only_to_user_bound(mcp_http, pg_session):
    user_token = token_for(pg_session, BU)
    names = {
        t["name"]
        for t in _result(
            rpc(mcp_http, "tools/list", token=user_token)
        )["tools"]
    }
    assert WRITE_TOOLS <= names

    svc_token = token_for(pg_session, BU, client_type="service")
    svc_names = {
        t["name"]
        for t in _result(
            rpc(mcp_http, "tools/list", token=svc_token)
        )["tools"]
    }
    assert not (WRITE_TOOLS & svc_names)  # service HIC gormez


def test_write_annotations_and_approval_guidance(mcp_http, pg_session):
    token = token_for(pg_session, BU)
    tools = _result(rpc(mcp_http, "tools/list", token=token))["tools"]
    for t in tools:
        if t["name"] in WRITE_TOOLS:
            assert t["annotations"]["readOnlyHint"] is False, t["name"]
            assert t["annotations"]["destructiveHint"] is False
            assert "human approval" in t["description"]


def test_service_client_direct_call_rejected(world, mcp_http, pg_session):
    svc_token = token_for(pg_session, BU, client_type="service")
    err = _tool_error(
        call_tool(
            mcp_http, svc_token, "hermes_create_task",
            create_args(world),
        )
    )
    assert err["error"]["code"] == "resource_access_denied"
    assert "user-bound" in err["error"]["message"]
    assert _task_count(pg_session, "MCP created task") == 0


# ── Yasam dongusu: create → update → comment → status → complete ──────


def test_create_task_happy_path(world, mcp_http, pg_session):
    token = token_for(pg_session, BU)
    out = _structured(
        call_tool(mcp_http, token, "hermes_create_task",
                  create_args(world))
    )
    assert out["task_code"].startswith("TASK-")
    assert out["assignee_user_id"] == str(AS)
    assert out["assigner_user_id"] == str(BU)  # sahip = bagli kullanici
    assert _task_count(pg_session, "MCP created task") == 1


def test_hierarchy_and_permission_enforced(world, mcp_http, pg_session):
    # BU → OUT hiyerarside yok → 403.
    token = token_for(pg_session, BU)
    err = _tool_error(
        call_tool(
            mcp_http, token, "hermes_create_task",
            create_args(world, assignee_user_id=str(OUT)),
        )
    )
    assert err["error"]["http_status"] == 403
    # AS'in atama izni yok → 403.
    as_token = token_for(pg_session, AS)
    err = _tool_error(
        call_tool(
            mcp_http, as_token, "hermes_create_task",
            create_args(world, assignee_user_id=str(BU)),
        )
    )
    assert err["error"]["http_status"] == 403
    assert _task_count(pg_session, "MCP created task") == 0


def test_owner_cannot_be_overridden(world, mcp_http, pg_session):
    token = token_for(pg_session, BU)
    res = _result(
        call_tool(
            mcp_http, token, "hermes_create_task",
            create_args(world, assigner_user_id=str(AS)),
        )
    )
    # Sema additionalProperties=false → sahiplik alani REDDEDILIR.
    assert res.get("isError") is True
    assert "validation" in res["content"][0]["text"].lower()


def test_update_comment_status_complete_flow(world, mcp_http, pg_session):
    bu = token_for(pg_session, BU)
    as_ = token_for(pg_session, AS)
    code = "TASK-901"

    upd = _structured(
        call_tool(
            mcp_http, bu, "hermes_update_task",
            {"task_code": code, "priority": "urgent"},
        )
    )
    assert upd["priority"] == "urgent"

    com = _structured(
        call_tool(
            mcp_http, bu, "hermes_add_task_comment",
            {"task_code": code, "body": "Please start today."},
        )
    )
    assert com["body"] == "Please start today."

    # Workflow guard: kabul edilmeden tamamlanamaz (pending→completed
    # atlamasi yasak) — internal kural aynen geciyor.
    err = _tool_error(
        call_tool(mcp_http, as_, "hermes_complete_task",
                  {"task_code": code})
    )
    assert err["error"]["http_status"] == 400

    acc = _structured(
        call_tool(
            mcp_http, as_, "hermes_change_task_status",
            {"task_code": code, "action": "accept"},
        )
    )
    assert acc["status"] == "in_progress"

    # Internal kural: assignee VEYA assigner tamamlayabilir — assigner
    # (BU) ile dogrulanir (dokumantasyon bu kurala hizalandi).
    done = _structured(
        call_tool(mcp_http, bu, "hermes_complete_task",
                  {"task_code": code})
    )
    assert done["status"] == "completed"

    # Activity zinciri gercekten olustu.
    acts = _structured(
        call_tool(mcp_http, bu, "hermes_get_task_activity",
                  {"task_code": code})
    )
    types_seen = {a["event_type"] for a in acts["items"]}
    assert {"task_updated", "comment_added", "task_completed"} <= types_seen


# ── hermes_log_time ─────────────────────────────────────────────────────


def test_log_time_with_task_link_and_xor(world, mcp_http, pg_session):
    token = token_for(pg_session, BU)
    out = _structured(
        call_tool(
            mcp_http, token, "hermes_log_time",
            {
                "customer_id": str(world["c1"].id),
                "project_id": str(world["p1"].id),
                "work_type_id": str(world["wt"].id),
                "date_worked": "2026-07-15",
                "duration_hours": 1.5,
                "task_code": "task-901",
            },
        )
    )
    assert out["user_id"] == str(BU)  # sahip HER ZAMAN bagli kullanici
    assert out["task_code"] == "TASK-901"

    err = _tool_error(
        call_tool(
            mcp_http, token, "hermes_log_time",
            {
                "customer_id": str(world["c1"].id),
                "project_id": str(world["p1"].id),
                "work_type_id": str(world["wt"].id),
                "date_worked": "2026-07-15",
                "duration_hours": 1.0,
                "task_code": "TASK-901",
                "meeting_id": str(uuid.uuid4()),
            },
        )
    )
    assert err["error"]["code"] == "validation_error"  # XOR kurali


# ── Idempotency: iki katman ─────────────────────────────────────────────


def test_transport_retry_same_request_id_single_record(
    world, mcp_http, pg_session
):
    """Ayni JSON-RPC id ile TEKRAR gonderim (transport retry) tek kayit
    olusturur — otomatik anahtar request id'den turetilir."""
    token = token_for(pg_session, BU)
    args = create_args(world, title="Transport retry task")
    params = {"name": "hermes_create_task", "arguments": args}
    r1 = rpc_with_id(mcp_http, 777001, "tools/call", params, token)
    r2 = rpc_with_id(mcp_http, 777001, "tools/call", params, token)
    assert _structured(r1)["task_code"] == _structured(r2)["task_code"]
    assert _task_count(pg_session, "Transport retry task") == 1


def test_explicit_key_replays_and_conflicts(world, mcp_http, pg_session):
    token = token_for(pg_session, BU)
    args = create_args(
        world, title="Logical retry task",
        idempotency_key="agent-op-2026-0001",
    )
    out1 = _structured(
        call_tool(mcp_http, token, "hermes_create_task", args)
    )
    out2 = _structured(
        call_tool(mcp_http, token, "hermes_create_task", args)
    )
    assert out1["task_code"] == out2["task_code"]
    assert _task_count(pg_session, "Logical retry task") == 1

    # Ayni acik anahtar + FARKLI govde → conflict.
    err = _tool_error(
        call_tool(
            mcp_http, token, "hermes_create_task",
            create_args(
                world, title="Different payload",
                idempotency_key="agent-op-2026-0001",
            ),
        )
    )
    assert err["error"]["code"] == "conflict"


def test_no_semantic_dedup_without_shared_key(world, mcp_http, pg_session):
    """DURUST iddia: farkli tool-call id'leri + acik anahtar YOK →
    iki ayri kayit olusur (semantik dedup IDDIA EDILMEZ)."""
    token = token_for(pg_session, BU)
    args = create_args(world, title="Two turns task")
    _structured(call_tool(mcp_http, token, "hermes_create_task", args))
    _structured(call_tool(mcp_http, token, "hermes_create_task", args))
    assert _task_count(pg_session, "Two turns task") == 2


# ── Guvenlik ────────────────────────────────────────────────────────────


def test_revoked_token_rejected_on_write(world, mcp_http, pg_session):
    from app.models.api_client import ApiToken

    token = token_for(pg_session, BU)
    pg_session.query(ApiToken).update({"status": "revoked"})
    pg_session.commit()
    from hermes_mcp.auth import clear_visibility_cache

    clear_visibility_cache()
    err = _tool_error(
        call_tool(mcp_http, token, "hermes_create_task",
                  create_args(world))
    )
    assert err["error"]["code"] == "revoked_token"
    assert _task_count(pg_session, "MCP created task") == 0


def test_no_token_or_argument_leak_in_logs(
    world, mcp_http, pg_session, caplog
):
    token = token_for(pg_session, BU)
    secret_title = "SENSITIVE TITLE zx9"
    secret_desc = "SENSITIVE DESCRIPTION qy7"
    with caplog.at_level(logging.INFO):
        _structured(
            call_tool(
                mcp_http, token, "hermes_create_task",
                create_args(
                    world, title=secret_title, description=secret_desc
                ),
            )
        )
    joined = " ".join(r.getMessage() for r in caplog.records)
    assert token not in joined
    assert secret_title not in joined
    assert secret_desc not in joined
