"""
=============================================================================
PM rework P1.3c — A7 hiyerarsi/baglar, A8 faturalanabilirlik
=============================================================================
A7  parent_id iki seviye + ayni proje (servis kurali); rollup sayilari
    yanitta; baglar relates|duplicates|blocks — `blocks` HICBIR tarih/durum
    degistirmez (kabul olcutu 8); dongu reddedilir.
A8  is_billable proje varsayilanindan miras; acik override izlenir
    (kim/ne zaman); efor kaydi is kaleminden miras alir, satir bazinda
    acik deger kazanir.
=============================================================================
"""
import uuid
from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text as sa_text

from shared.auth import CurrentUser, get_current_user
from shared.permissions import Perm

from app.database import get_db
from app.tenant_db import get_tenant_db
from app.main import app
from app.models.customer import Customer
from app.models.project import Project
from app.models.work_item import RoutingRelation, WorkItem
from app.models.work_type import WorkType
from app.schemas.work_log import WorkLogCreate
from app.services.work_log_service import WorkLogService

TEST_TENANT_ID = "00000000-0000-0000-0000-0000000000a1"

ADMIN = uuid.UUID("00000000-0000-4000-8000-00000000d201")
REPORTER = uuid.UUID("00000000-0000-4000-8000-00000000d202")
WORKER = uuid.UUID("00000000-0000-4000-8000-00000000d203")
STRANGER = uuid.UUID("00000000-0000-4000-8000-00000000d204")

BASE = "/api/v1/core/tasks"


@pytest.fixture()
def world(pg_session, authz_grants):
    s = pg_session
    s.execute(sa_text(
        "TRUNCATE work_item_links, work_item_participants, work_item_code_aliases, "
        "work_item_comments, work_item_events, work_items, routing_relations, "
        "project_memberships, work_logs, work_types, task_comments, task_activity_events, "
        "tasks, projects, customers CASCADE"
    ))
    s.commit()
    c = Customer(id=uuid.uuid4(), name="Vakko", is_active=True)
    p = Project(id=uuid.uuid4(), customer_id=c.id, name="ATM", is_active=True,
                is_billable_default=True)
    internal = Project(id=uuid.uuid4(), customer_id=c.id, name="Internal", is_active=True,
                       is_billable_default=False)
    wt = WorkType(id=uuid.uuid4(), name="Dev", is_active=True)
    s.add_all([c, p, internal, wt])
    s.commit()
    s.add(RoutingRelation(assigner_user_id=REPORTER, assignee_user_id=WORKER, scope="task"))
    s.commit()
    authz_grants[str(ADMIN)] = [Perm.TASKS_ADMIN, Perm.PROJECTS_MANAGE]
    authz_grants[str(REPORTER)] = [Perm.TASKS_ACCESS, Perm.TASKS_ASSIGN]
    authz_grants[str(WORKER)] = [Perm.TASKS_ACCESS]
    authz_grants[str(STRANGER)] = [Perm.TASKS_ACCESS]
    return {"s": s, "customer": c, "project": p, "internal": internal, "work_type": wt}


@pytest.fixture()
def http(world, pg_session):
    app.dependency_overrides[get_db] = lambda: pg_session
    app.dependency_overrides[get_tenant_db] = lambda: pg_session

    def _as(user_id):
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(
            id=str(user_id), email=f"{user_id}@x.com", full_name="U",
            is_admin=False, tenant_id=TEST_TENANT_ID,
        )
        return TestClient(app, raise_server_exceptions=False)

    yield _as
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_tenant_db, None)
    app.dependency_overrides.pop(get_current_user, None)


def _payload(world, *, project=None, title="Is", **over):
    project = project or world["project"]
    body = {
        "customer_id": str(world["customer"].id),
        "project_id": str(project.id),
        "title": title,
        "description": "aciklama",
        "assignee_user_id": str(WORKER),
        "scheduled_date": date.today().isoformat(),
        "due_date": "2026-12-31",
        "priority": "medium",
        "task_type": "task",
    }
    body.update(over)
    return body


def _create(http, world, **kw):
    res = http(REPORTER).post(BASE, json=_payload(world, **kw))
    assert res.status_code == 201, res.text
    return res.json()


# ── A8: faturalanabilirlik ─────────────────────────────────────────────


def test_billable_defaults_from_project(http, world):
    billable = _create(http, world)
    internal = _create(http, world, project=world["internal"])
    assert billable["is_billable"] is True and billable["billable_override_by"] is None
    assert internal["is_billable"] is False and internal["billable_override_by"] is None


def test_explicit_billable_on_create_is_tracked_as_override(http, world):
    item = _create(http, world, project=world["internal"], is_billable=True)
    assert item["is_billable"] is True
    assert item["billable_override_by"] == str(REPORTER)


def test_billable_update_requires_core_authority_and_is_tracked(http, world):
    item = _create(http, world)
    # Sahip (owner) para alanini DEGISTIREMEZ.
    assert http(WORKER).put(f"{BASE}/{item['id']}", json={"is_billable": False}).status_code == 403
    res = http(REPORTER).put(f"{BASE}/{item['id']}", json={"is_billable": False})
    assert res.status_code == 200, res.text
    assert res.json()["is_billable"] is False
    assert res.json()["billable_override_by"] == str(REPORTER)
    events = http(REPORTER).get(f"{BASE}/{item['id']}/activity").json()
    changes = [e for e in events if e["event_type"] == "task_updated"]
    assert changes and "is_billable" in changes[0]["event_data"]["changes"]


def test_work_log_inherits_billability_from_item(http, world):
    internal = _create(http, world, project=world["internal"])
    svc = WorkLogService(world["s"])
    inherited = svc.create(WorkLogCreate(
        customer_id=world["customer"].id, project_id=world["internal"].id,
        work_type_id=world["work_type"].id, date_worked=date.today(),
        duration_hours=Decimal("2"), description="iç iş", task_id=uuid.UUID(internal["id"]),
    ), WORKER)
    assert inherited.work_item_id == uuid.UUID(internal["id"])
    assert Decimal(inherited.billable_duration_hours) == 0
    explicit = svc.create(WorkLogCreate(
        customer_id=world["customer"].id, project_id=world["internal"].id,
        work_type_id=world["work_type"].id, date_worked=date.today(),
        duration_hours=Decimal("2"), billable_duration_hours=Decimal("1.5"),
        description="acik deger", task_id=uuid.UUID(internal["id"]),
    ), WORKER)
    assert Decimal(explicit.billable_duration_hours) == Decimal("1.5")


def test_project_api_round_trips_billable_default(http, world):
    res = http(ADMIN).post("/api/v1/core/projects", json={
        "name": "Yeni", "customer_id": str(world["customer"].id), "is_billable_default": False,
    })
    assert res.status_code == 201, res.text
    assert res.json()["is_billable_default"] is False
    pid = res.json()["id"]
    upd = http(ADMIN).put(f"/api/v1/core/projects/{pid}", json={"is_billable_default": True})
    assert upd.status_code == 200, upd.text
    assert upd.json()["is_billable_default"] is True
    # Varsayilan verilmezse true.
    res = http(ADMIN).post("/api/v1/core/projects", json={
        "name": "Varsayilan", "customer_id": str(world["customer"].id),
    })
    assert res.status_code == 201 and res.json()["is_billable_default"] is True


# ── A7: hiyerarsi ──────────────────────────────────────────────────────


def test_child_creation_and_rollup(http, world):
    parent = _create(http, world, title="Ana is")
    child = _create(http, world, title="Alt is", parent_id=parent["id"])
    assert child["parent_id"] == parent["id"]
    assert child["parent_key"] == parent["task_code"]
    fresh = http(REPORTER).get(f"{BASE}/{parent['id']}").json()
    assert fresh["subtask_count"] == 1 and fresh["subtask_done_count"] == 0
    kids = http(REPORTER).get(f"{BASE}/{parent['id']}/children").json()
    assert [k["id"] for k in kids] == [child["id"]]
    # Alt is tamamlaninca rollup sayar.
    done = http(WORKER).patch(f"{BASE}/{child['id']}/status", json={"status": "completed"})
    assert done.status_code == 200, done.text
    fresh = http(REPORTER).get(f"{BASE}/{parent['id']}").json()
    assert fresh["subtask_done_count"] == 1
    # Listede de rollup var (selectin — satir basina sorgu yok).
    listed = {r["id"]: r for r in http(REPORTER).get(BASE).json()}
    assert listed[parent["id"]]["subtask_count"] == 1


def test_only_two_levels_and_same_project(http, world):
    parent = _create(http, world, title="Ana")
    child = _create(http, world, title="Alt", parent_id=parent["id"])
    # Torun yok.
    res = http(REPORTER).post(BASE, json=_payload(world, title="Torun", parent_id=child["id"]))
    assert res.status_code == 400 and "two levels" in res.json()["detail"]
    # Alt isi olan kalem baskasinin altina giremez.
    other = _create(http, world, title="Baska")
    res = http(REPORTER).put(f"{BASE}/{parent['id']}", json={"parent_id": other["id"]})
    assert res.status_code == 400
    # Farkli proje.
    foreign = _create(http, world, project=world["internal"], title="Ic")
    res = http(REPORTER).post(BASE, json=_payload(world, title="Yanlis", parent_id=foreign["id"]))
    assert res.status_code == 400 and "same project" in res.json()["detail"]
    # Kendisi.
    res = http(REPORTER).put(f"{BASE}/{other['id']}", json={"parent_id": other["id"]})
    assert res.status_code == 400
    # Gorunmeyen ust = 404.
    res = http(STRANGER).post(BASE, json=_payload(world, title="x", assignee_user_id=str(STRANGER), parent_id=parent["id"]))
    assert res.status_code == 404
    # clear_parent kaldirir.
    res = http(REPORTER).put(f"{BASE}/{child['id']}", json={"clear_parent": True})
    assert res.status_code == 200 and res.json()["parent_id"] is None


# ── A7: baglar ─────────────────────────────────────────────────────────


def test_links_crud_and_directions(http, world):
    a = _create(http, world, title="A")
    b = _create(http, world, title="B")
    res = http(REPORTER).post(f"{BASE}/{a['id']}/links", json={"to_item_id": b["id"], "link_type": "relates"})
    assert res.status_code == 201, res.text
    links = res.json()
    assert links[0]["direction"] == "outbound" and links[0]["item_key"] == b["task_code"]
    # Karsi taraf inbound gorur.
    other_side = http(REPORTER).get(f"{BASE}/{b['id']}/links").json()
    assert other_side[0]["direction"] == "inbound" and other_side[0]["item_id"] == a["id"]
    # Ayni bag iki kez (ters yonden bile) → 409.
    dup = http(REPORTER).post(f"{BASE}/{b['id']}/links", json={"to_item_id": a["id"], "link_type": "relates"})
    assert dup.status_code == 409
    # Kendine bag → 400; gorunmeyen hedef → 404.
    assert http(REPORTER).post(f"{BASE}/{a['id']}/links", json={"to_item_id": a["id"]}).status_code == 400
    assert http(STRANGER).get(f"{BASE}/{a['id']}/links").status_code == 404
    # Sil.
    res = http(REPORTER).delete(f"{BASE}/{a['id']}/links/{links[0]['id']}")
    assert res.status_code == 200 and res.json() == []


def test_blocks_link_changes_nothing_and_rejects_cycles(http, world):
    a = _create(http, world, title="A")
    b = _create(http, world, title="B")
    c = _create(http, world, title="C")
    before = http(REPORTER).get(f"{BASE}/{b['id']}").json()
    assert http(REPORTER).post(f"{BASE}/{a['id']}/links", json={"to_item_id": b["id"], "link_type": "blocks"}).status_code == 201
    assert http(REPORTER).post(f"{BASE}/{b['id']}/links", json={"to_item_id": c["id"], "link_type": "blocks"}).status_code == 201
    after = http(REPORTER).get(f"{BASE}/{b['id']}").json()
    # Kabul olcutu 8: bag hicbir tarih/durum degistirmez.
    for key in ("due_date", "scheduled_date", "status", "state", "closed_at"):
        assert before[key] == after[key], key
    # C → A dongu olusturur.
    cyc = http(REPORTER).post(f"{BASE}/{c['id']}/links", json={"to_item_id": a["id"], "link_type": "blocks"})
    assert cyc.status_code == 400 and "cycle" in cyc.json()["detail"]
    # relates icin dongu kavrami yok.
    assert http(REPORTER).post(f"{BASE}/{c['id']}/links", json={"to_item_id": a["id"], "link_type": "relates"}).status_code == 201


def test_only_involved_users_can_link(http, world):
    a = _create(http, world, title="A")
    b = _create(http, world, title="B")
    # Atanan (owner) baglayabilir; goren ama ilgisi olmayan baglayamaz.
    assert http(WORKER).post(f"{BASE}/{a['id']}/links", json={"to_item_id": b["id"]}).status_code == 201
    world["s"].add(__import__("app.models.project_membership", fromlist=["ProjectMembership"]).ProjectMembership(
        project_id=world["project"].id, user_id=STRANGER, member_role="member", is_active=True,
    ))
    world["s"].commit()
    assert http(STRANGER).post(f"{BASE}/{a['id']}/links", json={"to_item_id": b["id"], "link_type": "duplicates"}).status_code == 403
