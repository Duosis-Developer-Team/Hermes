"""
=============================================================================
PM rework P1.3b — B5 takipci (watcher)
=============================================================================
Takipci isi GORUR ve durum degisiminde bildirim ALIR; duzenleyemez, durum
degistiremez. Kendini eklemek gorunurluk yeter; baskasini eklemek/cikarmak
reporter ya da proje lead'i ister. Idempotent; atanan zaten bildirim alir.
=============================================================================
"""
import asyncio
import uuid
from datetime import date
from types import SimpleNamespace

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
from app.routers import tasks as tasks_router
from app.services import task_notifications as tn

TEST_TENANT_ID = "00000000-0000-0000-0000-0000000000a1"

REPORTER = uuid.UUID("00000000-0000-4000-8000-00000000e101")
WORKER = uuid.UUID("00000000-0000-4000-8000-00000000e102")
WATCHER = uuid.UUID("00000000-0000-4000-8000-00000000e103")
MEMBER = uuid.UUID("00000000-0000-4000-8000-00000000e104")
STRANGER = uuid.UUID("00000000-0000-4000-8000-00000000e105")

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
    s.add_all([c, p])
    s.commit()
    s.add_all([
        # WATCHER ve MEMBER proje uyesi: isi gorur, takip edebilir.
        ProjectMembership(project_id=p.id, user_id=WATCHER, member_role="member", is_active=True),
        ProjectMembership(project_id=p.id, user_id=MEMBER, member_role="member", is_active=True),
        RoutingRelation(assigner_user_id=REPORTER, assignee_user_id=WORKER, scope="task"),
    ])
    s.commit()
    authz_grants[str(REPORTER)] = [Perm.TASKS_ACCESS, Perm.TASKS_ASSIGN]
    for uid in (WORKER, WATCHER, MEMBER, STRANGER):
        authz_grants[str(uid)] = [Perm.TASKS_ACCESS]
    return {"s": s, "customer": c, "project": p}


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


def _create(http, world):
    res = http(REPORTER).post(BASE, json={
        "customer_id": str(world["customer"].id),
        "project_id": str(world["project"].id),
        "title": "Takipli is",
        "description": "aciklama",
        "assignee_user_id": str(WORKER),
        "scheduled_date": date.today().isoformat(),
        "priority": "medium",
        "task_type": "task",
    })
    assert res.status_code == 201, res.text
    return res.json()


def _watchers(body):
    return {p["user_id"] for p in body["participants"] if p["role"] == "watcher"}


def test_self_watch_adds_watcher_participant_and_is_idempotent(http, world):
    item = _create(http, world)
    res = http(WATCHER).post(f"{BASE}/{item['id']}/watchers")
    assert res.status_code == 201, res.text
    assert _watchers(res.json()) == {str(WATCHER)}
    again = http(WATCHER).post(f"{BASE}/{item['id']}/watchers", json={})
    assert again.status_code == 201
    assert _watchers(again.json()) == {str(WATCHER)}
    events = http(WATCHER).get(f"{BASE}/{item['id']}/activity").json()
    assert [e for e in events if e["event_type"] == "watcher_added"]


def test_watcher_sees_item_but_cannot_edit_or_change_status(http, world):
    item = _create(http, world)
    # Uyeligi olmayan biri: once gormez (404); eklenince takipci olarak gorur.
    assert http(STRANGER).get(f"{BASE}/{item['id']}").status_code == 404
    res = http(REPORTER).post(f"{BASE}/{item['id']}/watchers", json={"user_id": str(STRANGER)})
    assert res.status_code == 201, res.text
    assert http(STRANGER).get(f"{BASE}/{item['id']}").status_code == 200
    assert item["id"] in {r["id"] for r in http(STRANGER).get(BASE).json()}
    # Duzenleyemez, durum degistiremez.
    assert http(STRANGER).put(f"{BASE}/{item['id']}", json={"title": "x"}).status_code == 403
    assert http(STRANGER).patch(
        f"{BASE}/{item['id']}/status", json={"status": "in_progress"}
    ).status_code == 403


def test_plain_member_cannot_add_others_but_reporter_can(http, world):
    item = _create(http, world)
    denied = http(MEMBER).post(f"{BASE}/{item['id']}/watchers", json={"user_id": str(STRANGER)})
    assert denied.status_code == 403
    ok = http(REPORTER).post(f"{BASE}/{item['id']}/watchers", json={"user_id": str(STRANGER)})
    assert ok.status_code == 201


def test_unwatch_removes_and_missing_is_404(http, world):
    item = _create(http, world)
    http(WATCHER).post(f"{BASE}/{item['id']}/watchers")
    res = http(WATCHER).delete(f"{BASE}/{item['id']}/watchers/{WATCHER}")
    assert res.status_code == 200, res.text
    assert _watchers(res.json()) == set()
    assert http(WATCHER).delete(f"{BASE}/{item['id']}/watchers/{WATCHER}").status_code == 404
    # Baskasini cikarmak cekirdek yetki ister.
    http(WATCHER).post(f"{BASE}/{item['id']}/watchers")
    assert http(MEMBER).delete(f"{BASE}/{item['id']}/watchers/{WATCHER}").status_code == 403


def test_assignee_is_not_duplicated_as_watcher(http, world):
    item = _create(http, world)
    res = http(WORKER).post(f"{BASE}/{item['id']}/watchers")
    assert res.status_code == 201
    assert _watchers(res.json()) == set()


def test_status_change_notification_carries_watchers(http, world, monkeypatch):
    item = _create(http, world)
    http(WATCHER).post(f"{BASE}/{item['id']}/watchers")
    calls = []

    async def fake_send_status(**kw):
        calls.append(kw)

    monkeypatch.setattr(tasks_router, "send_status_notifications", fake_send_status)
    res = http(WORKER).patch(f"{BASE}/{item['id']}/status", json={"status": "in_progress"})
    assert res.status_code == 200, res.text
    assert calls, "ilk kabul bildirimi tetiklenmeli"
    assert calls[0]["event"] == "accept"
    assert calls[0]["watcher_user_ids"] == [str(WATCHER)]


# ── E-posta: takipci ayri bir mail alir; atanan/atayan cift almaz ────────


class _Settings(SimpleNamespace):
    NOTIFICATIONS_ENABLED = True
    NOTIF_MAIL_SENDER = "hermes@example.com"
    NOTIF_NOTIFY_ASSIGNER = True
    APP_BASE_URL = "https://hermes.example.com"


class _Graph(SimpleNamespace):
    is_configured = True


DIRECTORY = {
    "u-assigner": {"full_name": "Gencay", "email": "gencay@x.com"},
    "u-ayse": {"full_name": "Ayse", "email": "ayse@x.com"},
    "u-watch": {"full_name": "Deniz", "email": "deniz@x.com"},
    "u-noemail": {"full_name": "Adressiz", "email": None},
}


@pytest.fixture
def mail(monkeypatch):
    sent = []

    async def fake_send(sender, to_email, subject, html_body):
        sent.append({"to": to_email, "subject": subject, "html": html_body})

    async def fake_resolve(token, ids, **_kw):
        return {i: DIRECTORY[i] for i in ids if i in DIRECTORY}

    monkeypatch.setattr(tn, "_send", fake_send)
    monkeypatch.setattr(tn, "_resolve_users", fake_resolve)
    monkeypatch.setattr(tn, "get_settings", lambda: _Settings())
    monkeypatch.setattr(tn, "get_graph_client", lambda: _Graph())
    return sent


def _task_payload():
    return {
        "id": "t-1", "task_code": "TASK-1", "task_type": "task", "title": "Takipli is",
        "description": "desc", "customer_name": "Vakko", "project_name": "ATM",
        "sub_project_name": None, "priority": "high", "scheduled_date": "01.08.2026",
        "due_date": "05.08.2026", "assignee_user_id": "u-ayse", "assigner_user_id": "u-assigner",
    }


def test_watcher_receives_status_mail_once_and_actors_are_not_duplicated(mail):
    asyncio.run(tn.send_status_notifications(
        token="tok", tenant_id=TEST_TENANT_ID, task=_task_payload(),
        assigner_user_id="u-assigner", event="complete",
        # Atanan ve atayan takipci listesinde olsa da ikinci mail ALMAZ;
        # adressiz takipci atlanir.
        watcher_user_ids=["u-watch", "u-ayse", "u-assigner", "u-noemail"],
    ))
    by_to = {}
    for m in mail:
        by_to.setdefault(m["to"], []).append(m)
    assert len(by_to["deniz@x.com"]) == 1
    assert "you follow was completed" in by_to["deniz@x.com"][0]["subject"]
    assert "Ayse" in by_to["deniz@x.com"][0]["html"]
    assert len(by_to["ayse@x.com"]) == 1
    assert len(by_to["gencay@x.com"]) == 1
