"""
=============================================================================
PM rework P1.3a — gorunurluk, duzenleme yetkisi, kendine is, yonlendirme
=============================================================================
A3  Proje uyesi kendisine atanmamis isi gorur; uye olmayan gormez (404).
B3  Sahip (owner) kendi isinin baslik/termin/oncelik alanlarini duzenler,
    cekirdek alanlari (proje/atanan) DEGISTIREMEZ; proje lead'i duzenler.
B4  Atama yetkisi olmayan kullanici KENDINE is acar; baskasina acamaz.
A4  Yonlendirme `routing_relations`tan okunur: admin ucundan eklenen
    esleme atamayi acar; gorunurlugu ETKILEMEZ.
=============================================================================
"""
import uuid
from datetime import date

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
from app.models.project_membership import ProjectMembership
from app.models.work_item import RoutingRelation

TEST_TENANT_ID = "00000000-0000-0000-0000-0000000000a1"

ADMIN = uuid.UUID("00000000-0000-4000-8000-00000000f001")
ASSIGNER = uuid.UUID("00000000-0000-4000-8000-00000000f002")
WORKER = uuid.UUID("00000000-0000-4000-8000-00000000f003")
MEMBER = uuid.UUID("00000000-0000-4000-8000-00000000f004")
LEAD = uuid.UUID("00000000-0000-4000-8000-00000000f005")
STRANGER = uuid.UUID("00000000-0000-4000-8000-00000000f006")
ASSIGNER2 = uuid.UUID("00000000-0000-4000-8000-00000000f007")

BASE = "/api/v1/core/tasks"


@pytest.fixture()
def world(pg_session, authz_grants):
    s = pg_session
    s.execute(sa_text(
        "TRUNCATE work_item_participants, work_item_code_aliases, work_item_comments, "
        "work_item_events, work_items, routing_relations, project_memberships, "
        "task_comments, task_activity_events, tasks, projects, customers CASCADE"
    ))
    s.commit()
    c = Customer(id=uuid.uuid4(), name="Vakko", is_active=True)
    p = Project(id=uuid.uuid4(), customer_id=c.id, name="ATM", is_active=True)
    other = Project(id=uuid.uuid4(), customer_id=c.id, name="Other", is_active=True)
    s.add_all([c, p, other])
    s.commit()
    s.add_all([
        ProjectMembership(project_id=p.id, user_id=MEMBER, member_role="member", is_active=True),
        ProjectMembership(project_id=p.id, user_id=LEAD, member_role="lead", is_active=True),
        # ASSIGNER → WORKER yonlendirmesi (routing_relations).
        RoutingRelation(assigner_user_id=ASSIGNER, assignee_user_id=WORKER, scope="task"),
    ])
    s.commit()

    authz_grants[str(ADMIN)] = [Perm.TASKS_ADMIN, Perm.TASK_PERMISSIONS_MANAGE]
    authz_grants[str(ASSIGNER)] = [Perm.TASKS_ACCESS, Perm.TASKS_ASSIGN]
    authz_grants[str(ASSIGNER2)] = [Perm.TASKS_ACCESS, Perm.TASKS_ASSIGN]
    for uid in (WORKER, MEMBER, LEAD, STRANGER):
        authz_grants[str(uid)] = [Perm.TASKS_ACCESS]
    return {"s": s, "customer": c, "project": p, "other": other}


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


def _payload(world, *, assignee, project=None, title="Is"):
    project = project or world["project"]
    return {
        "customer_id": str(world["customer"].id),
        "project_id": str(project.id),
        "title": title,
        "description": "aciklama",
        "assignee_user_id": str(assignee),
        "scheduled_date": date.today().isoformat(),
        "priority": "medium",
        "task_type": "task",
    }


def _create(http, world, *, by=ASSIGNER, assignee=WORKER, **kw):
    res = http(by).post(BASE, json=_payload(world, assignee=assignee, **kw))
    assert res.status_code == 201, res.text
    return res.json()


# ── A3: proje uyeligi gorunurluk verir ─────────────────────────────────


def test_project_member_sees_item_without_assignment(http, world):
    item = _create(http, world)
    listed = http(MEMBER).get(BASE).json()
    assert item["id"] in {r["id"] for r in listed}
    assert http(MEMBER).get(f"{BASE}/{item['id']}").status_code == 200


def test_non_member_non_participant_does_not_see_item(http, world):
    item = _create(http, world)
    assert item["id"] not in {r["id"] for r in http(STRANGER).get(BASE).json()}
    # Kapsam disi = var olmayan kayit (ayni 404).
    assert http(STRANGER).get(f"{BASE}/{item['id']}").status_code == 404


def test_membership_in_other_project_does_not_leak(http, world):
    item = _create(http, world, project=world["other"])
    assert item["id"] not in {r["id"] for r in http(MEMBER).get(BASE).json()}


def test_routing_relation_does_not_grant_visibility(http, world):
    """A4: ASSIGNER2 → STRANGER yonlendirmesi var; STRANGER yine de
    baskasina atanmis isi GORMEZ (yonlendirme gorunurluk degil)."""
    world["s"].add(RoutingRelation(assigner_user_id=ASSIGNER2, assignee_user_id=STRANGER, scope="task"))
    world["s"].commit()
    item = _create(http, world)
    assert http(STRANGER).get(f"{BASE}/{item['id']}").status_code == 404


# ── B3: duzenleme yetkisi ──────────────────────────────────────────────


def test_owner_edits_own_fields_but_not_core(http, world):
    item = _create(http, world)
    ok = http(WORKER).put(f"{BASE}/{item['id']}", json={"due_date": "2026-12-31", "priority": "high"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["due_date"] == "2026-12-31"
    # Cekirdek alan (proje) sahip icin KAPALI.
    denied = http(WORKER).put(f"{BASE}/{item['id']}", json={"project_id": str(world["other"].id)})
    assert denied.status_code == 403
    denied = http(WORKER).put(f"{BASE}/{item['id']}", json={"assignee_user_id": str(MEMBER)})
    assert denied.status_code == 403


def test_project_lead_edits_core_fields(http, world):
    item = _create(http, world)
    res = http(LEAD).put(f"{BASE}/{item['id']}", json={"title": "Lead duzenledi"})
    assert res.status_code == 200, res.text
    assert res.json()["title"] == "Lead duzenledi"


def test_plain_member_cannot_edit(http, world):
    item = _create(http, world)
    assert http(MEMBER).put(f"{BASE}/{item['id']}", json={"title": "x"}).status_code == 403


# ── B4: kendine is acma ────────────────────────────────────────────────


def test_user_without_assign_permission_creates_for_self(http, world):
    res = http(WORKER).post(BASE, json=_payload(world, assignee=WORKER, title="Kendime"))
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["assignee_user_id"] == str(WORKER)
    assert body["assigner_user_id"] == str(WORKER)
    assert body["owner_user_id"] == str(WORKER)


def test_user_without_assign_permission_cannot_assign_to_others(http, world):
    res = http(WORKER).post(BASE, json=_payload(world, assignee=MEMBER))
    assert res.status_code == 403


def test_bulk_self_only_is_allowed_without_assign_permission(http, world):
    payload = {**_payload(world, assignee=WORKER), "assignee_user_ids": [str(WORKER)], "assignee_group_ids": []}
    payload.pop("assignee_user_id")
    res = http(WORKER).post(f"{BASE}/bulk", json=payload)
    assert res.status_code == 201, res.text
    assert [r["assignee_user_id"] for r in res.json()] == [str(WORKER)]


def test_permissions_me_advertises_self_assign(http, world):
    me = http(WORKER).get(f"{BASE}/permissions/me").json()
    assert me["task"]["can_self_assign"] is True
    assert me["task"]["can_assign"] is False
    assert str(WORKER) in me["task"]["assignable_user_ids"]


# ── A4: yonlendirme routing_relations'tan ──────────────────────────────


def test_admin_routing_endpoint_writes_routing_relations_and_enables_assignment(http, world):
    # ASSIGNER2'nin henuz kimseye yonlendirmesi yok → WORKER'a acamaz.
    assert http(ASSIGNER2).post(BASE, json=_payload(world, assignee=WORKER)).status_code == 403
    res = http(ADMIN).post(
        "/api/v1/core/admin/task-assignment-relations",
        json={"assigner_user_id": str(ASSIGNER2), "assignee_user_ids": [str(WORKER)], "scope": "task"},
    )
    assert res.status_code == 201, res.text
    rows = world["s"].query(RoutingRelation).filter(
        RoutingRelation.assigner_user_id == ASSIGNER2, RoutingRelation.assignee_user_id == WORKER
    ).all()
    assert len(rows) == 1
    assert http(ASSIGNER2).post(BASE, json=_payload(world, assignee=WORKER)).status_code == 201
    # Yonlendirme olmayan hedef hala kapali.
    assert http(ASSIGNER2).post(BASE, json=_payload(world, assignee=STRANGER)).status_code == 403


def test_self_routing_relation_is_accepted(http, world):
    """B4: assigner == assignee kisiti kalkti."""
    res = http(ADMIN).post(
        "/api/v1/core/admin/task-assignment-relations",
        json={"assigner_user_id": str(ASSIGNER2), "assignee_user_ids": [str(ASSIGNER2)], "scope": "task"},
    )
    assert res.status_code == 201, res.text
