"""
=============================================================================
PM rework P2.1 — B2 proje uyeleri (/projects/{id}/members)
=============================================================================
projects.manage her seyi yapar; proje lead'i kendi ekibini yonetir ama
lead veremez/alamaz; uye/yabanci yonetemez (403). Uyelik gorunurluk
verir: eklenen kisi projenin isini gorur, cikarilan gormez (A3 bagi).
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

MANAGER = uuid.UUID("00000000-0000-4000-8000-00000000a301")
LEAD = uuid.UUID("00000000-0000-4000-8000-00000000a302")
MEMBER = uuid.UUID("00000000-0000-4000-8000-00000000a303")
NEWBIE = uuid.UUID("00000000-0000-4000-8000-00000000a304")
STRANGER = uuid.UUID("00000000-0000-4000-8000-00000000a305")
WORKER = uuid.UUID("00000000-0000-4000-8000-00000000a306")


@pytest.fixture()
def world(pg_session, authz_grants):
    s = pg_session
    s.execute(sa_text(
        "TRUNCATE work_item_participants, work_item_code_aliases, work_item_comments, "
        "work_item_events, work_items, routing_relations, project_memberships, "
        "tasks, projects, customers CASCADE"
    ))
    s.commit()
    c = Customer(id=uuid.uuid4(), name="Vakko", is_active=True)
    p = Project(id=uuid.uuid4(), customer_id=c.id, name="ATM", is_active=True)
    other = Project(id=uuid.uuid4(), customer_id=c.id, name="Other", is_active=True)
    s.add_all([c, p, other])
    s.commit()
    s.add_all([
        ProjectMembership(project_id=p.id, user_id=LEAD, member_role="lead", is_active=True),
        ProjectMembership(project_id=p.id, user_id=MEMBER, member_role="member", is_active=True),
        RoutingRelation(assigner_user_id=MANAGER, assignee_user_id=WORKER, scope="task"),
    ])
    s.commit()
    authz_grants[str(MANAGER)] = [Perm.PROJECTS_MANAGE, Perm.TASKS_ACCESS, Perm.TASKS_ASSIGN]
    for uid in (LEAD, MEMBER, NEWBIE, STRANGER, WORKER):
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


def _url(world, project=None):
    return f"/api/v1/core/projects/{(project or world['project']).id}/members"


def _roles(body):
    return {i["user_id"]: i["member_role"] for i in body["items"] if i["is_active"]}


def test_list_exposes_manage_capabilities(http, world):
    for uid, manage, lead in ((MANAGER, True, True), (LEAD, True, False), (MEMBER, False, False), (STRANGER, False, False)):
        res = http(uid).get(_url(world))
        assert res.status_code == 200, res.text
        body = res.json()
        assert (body["can_manage"], body["can_assign_lead"]) == (manage, lead), uid
    assert _roles(http(MANAGER).get(_url(world)).json()) == {str(LEAD): "lead", str(MEMBER): "member"}


def test_lead_manages_members_but_not_leads(http, world):
    res = http(LEAD).post(_url(world), json={"user_id": str(NEWBIE), "member_role": "viewer"})
    assert res.status_code == 201, res.text
    assert _roles(res.json())[str(NEWBIE)] == "viewer"
    mid = next(i["id"] for i in res.json()["items"] if i["user_id"] == str(NEWBIE))
    # viewer → member: serbest
    assert http(LEAD).patch(f"{_url(world)}/{mid}", json={"member_role": "member"}).status_code == 200
    # lead verme: yasak
    assert http(LEAD).patch(f"{_url(world)}/{mid}", json={"member_role": "lead"}).status_code == 403
    assert http(LEAD).post(_url(world), json={"user_id": str(STRANGER), "member_role": "lead"}).status_code == 403
    # mevcut lead'i cikarma/degistirme: yasak
    lead_mid = next(i["id"] for i in res.json()["items"] if i["user_id"] == str(LEAD))
    assert http(LEAD).delete(f"{_url(world)}/{lead_mid}").status_code == 403
    assert http(LEAD).patch(f"{_url(world)}/{lead_mid}", json={"member_role": "member"}).status_code == 403
    # uyeyi cikarma: serbest
    res = http(LEAD).delete(f"{_url(world)}/{mid}")
    assert res.status_code == 200 and str(NEWBIE) not in _roles(res.json())


def test_manager_grants_and_revokes_lead(http, world):
    res = http(MANAGER).post(_url(world), json={"user_id": str(NEWBIE), "member_role": "lead"})
    assert res.status_code == 201, res.text
    assert _roles(res.json())[str(NEWBIE)] == "lead"
    mid = next(i["id"] for i in res.json()["items"] if i["user_id"] == str(NEWBIE))
    res = http(MANAGER).patch(f"{_url(world)}/{mid}", json={"member_role": "member"})
    assert res.status_code == 200 and _roles(res.json())[str(NEWBIE)] == "member"


def test_member_and_stranger_cannot_manage(http, world):
    for uid in (MEMBER, STRANGER):
        assert http(uid).post(_url(world), json={"user_id": str(NEWBIE)}).status_code == 403
    # Lead baska projeyi yonetemez.
    assert http(LEAD).post(_url(world, world["other"]), json={"user_id": str(NEWBIE)}).status_code == 403
    assert http(MANAGER).get(_url(world, Project(id=uuid.uuid4()))).status_code == 404


def test_duplicate_is_409_and_inactive_is_reactivated(http, world):
    assert http(MANAGER).post(_url(world), json={"user_id": str(MEMBER)}).status_code == 409
    body = http(MANAGER).get(_url(world)).json()
    mid = next(i["id"] for i in body["items"] if i["user_id"] == str(MEMBER))
    assert http(MANAGER).patch(f"{_url(world)}/{mid}", json={"is_active": False}).status_code == 200
    res = http(MANAGER).post(_url(world), json={"user_id": str(MEMBER), "member_role": "viewer"})
    assert res.status_code == 201
    assert _roles(res.json())[str(MEMBER)] == "viewer"
    assert sum(1 for i in res.json()["items"] if i["user_id"] == str(MEMBER)) == 1


def test_invalid_role_is_422(http, world):
    assert http(MANAGER).post(_url(world), json={"user_id": str(NEWBIE), "member_role": "owner"}).status_code == 422


def test_membership_changes_visibility_immediately(http, world):
    item = http(MANAGER).post("/api/v1/core/tasks", json={
        "customer_id": str(world["customer"].id), "project_id": str(world["project"].id),
        "title": "Is", "description": "d", "assignee_user_id": str(WORKER),
        "scheduled_date": date.today().isoformat(), "priority": "medium", "task_type": "task",
    })
    assert item.status_code == 201, item.text
    item_id = item.json()["id"]
    assert http(NEWBIE).get(f"/api/v1/core/tasks/{item_id}").status_code == 404
    res = http(LEAD).post(_url(world), json={"user_id": str(NEWBIE), "member_role": "viewer"})
    assert res.status_code == 201
    assert http(NEWBIE).get(f"/api/v1/core/tasks/{item_id}").status_code == 200
    mid = next(i["id"] for i in res.json()["items"] if i["user_id"] == str(NEWBIE))
    http(LEAD).delete(f"{_url(world)}/{mid}")
    assert http(NEWBIE).get(f"/api/v1/core/tasks/{item_id}").status_code == 404
