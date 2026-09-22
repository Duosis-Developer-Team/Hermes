"""
=============================================================================
PM rework P2.2 — C2 uygulama ici bildirim + C3 kanal ayrimi
=============================================================================
Bildirim olayla AYNI transaction'da yazilir; alici kumesi aktoru haric
katilimci/reporter/owner; kullanici yalniz kendi bildirimlerini gorur.
Kural tablosu kanal bazinda: in_app kapaliyken bildirim yazilmaz, e-posta
kapaliyken e-posta kapisi kapanir (ve tersi).
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
from app.models.task import TaskNotificationSetting
from app.models.work_item import RoutingRelation, WorkItemNotification
from app.services.task_service import notification_allowed

TEST_TENANT_ID = "00000000-0000-0000-0000-0000000000a1"

ADMIN = uuid.UUID("00000000-0000-4000-8000-00000000b401")
REPORTER = uuid.UUID("00000000-0000-4000-8000-00000000b402")
WORKER = uuid.UUID("00000000-0000-4000-8000-00000000b403")
WATCHER = uuid.UUID("00000000-0000-4000-8000-00000000b404")
STRANGER = uuid.UUID("00000000-0000-4000-8000-00000000b405")

BASE = "/api/v1/core/tasks"
NOTIF = "/api/v1/core/notifications"


@pytest.fixture()
def world(pg_session, authz_grants):
    s = pg_session
    s.execute(sa_text(
        "TRUNCATE work_item_notifications, work_item_participants, work_item_code_aliases, "
        "work_item_comments, work_item_events, work_items, routing_relations, "
        "project_memberships, task_notification_settings, tasks, projects, customers CASCADE"
    ))
    s.commit()
    c = Customer(id=uuid.uuid4(), name="Vakko", is_active=True)
    p = Project(id=uuid.uuid4(), customer_id=c.id, name="ATM", is_active=True)
    s.add_all([c, p])
    s.commit()
    s.add_all([
        ProjectMembership(project_id=p.id, user_id=WATCHER, member_role="member", is_active=True),
        RoutingRelation(assigner_user_id=REPORTER, assignee_user_id=WORKER, scope="task"),
    ])
    s.commit()
    authz_grants[str(ADMIN)] = [Perm.TASKS_ADMIN, Perm.TASK_PERMISSIONS_MANAGE]
    authz_grants[str(REPORTER)] = [Perm.TASKS_ACCESS, Perm.TASKS_ASSIGN]
    for uid in (WORKER, WATCHER, STRANGER):
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


def _create(http, world, title="Is"):
    res = http(REPORTER).post(BASE, json={
        "customer_id": str(world["customer"].id), "project_id": str(world["project"].id),
        "title": title, "description": "d", "assignee_user_id": str(WORKER),
        "scheduled_date": date.today().isoformat(), "priority": "medium", "task_type": "task",
    })
    assert res.status_code == 201, res.text
    return res.json()


def _kinds(http, uid):
    return [n["kind"] for n in http(uid).get(NOTIF).json()["items"]]


def test_assignment_notifies_assignee_not_actor(http, world):
    item = _create(http, world)
    assert _kinds(http, WORKER) == ["task_created"]
    assert _kinds(http, REPORTER) == []
    body = http(WORKER).get(NOTIF).json()
    assert body["unread_count"] == 1
    n = body["items"][0]
    assert n["work_item_id"] == item["id"] and n["item_key"] == item["task_code"]
    assert n["actor_user_id"] == str(REPORTER) and n["read_at"] is None
    assert http(WORKER).get(f"{NOTIF}/unread-count").json() == {"unread_count": 1}


def test_status_and_comment_reach_reporter_and_watchers(http, world):
    item = _create(http, world)
    assert http(WATCHER).post(f"{BASE}/{item['id']}/watchers").status_code == 201
    # Watcher kendini ekledi → kendisine bildirim YOK (aktor).
    assert _kinds(http, WATCHER) == []
    assert http(WORKER).patch(f"{BASE}/{item['id']}/status", json={"status": "in_progress"}).status_code == 200
    assert http(WORKER).post(f"{BASE}/{item['id']}/comments", json={"body": "basladim"}).status_code == 201
    assert _kinds(http, REPORTER) == ["comment_added", "task_status_changed"]
    assert _kinds(http, WATCHER) == ["comment_added", "task_status_changed"]
    # Aktor (WORKER) kendi olaylarindan bildirim almaz; ilk atama duruyor.
    assert _kinds(http, WORKER) == ["task_created"]
    # Yabanci hicbir sey gormez.
    assert http(STRANGER).get(NOTIF).json() == {"items": [], "unread_count": 0}


def test_mark_read_and_read_all_are_user_scoped(http, world):
    _create(http, world, "A")
    _create(http, world, "B")
    items = http(WORKER).get(NOTIF).json()["items"]
    assert len(items) == 2
    res = http(WORKER).post(f"{NOTIF}/{items[0]['id']}/read")
    assert res.status_code == 200 and res.json()["read_at"] is not None
    assert http(WORKER).get(f"{NOTIF}/unread-count").json()["unread_count"] == 1
    # Baskasinin bildirimi → 404 (varligi sizmaz).
    assert http(STRANGER).post(f"{NOTIF}/{items[1]['id']}/read").status_code == 404
    assert http(WORKER).get(f"{NOTIF}?unread=true").json()["unread_count"] == 1
    assert len(http(WORKER).get(f"{NOTIF}?unread=true").json()["items"]) == 1
    res = http(WORKER).post(f"{NOTIF}/read-all")
    assert res.status_code == 200 and res.json() == {"marked": 1, "unread_count": 0}


def test_in_app_channel_off_writes_nothing_but_email_gate_stays(http, world):
    res = http(ADMIN).put("/api/v1/core/admin/notification-settings/task", json={
        "enabled": True, "notify_assignment": True, "notify_accept": True, "notify_complete": True,
        "email_enabled": True, "in_app_enabled": False,
        "priorities": ["low", "medium", "high", "urgent"], "due_date_rule": "any",
    })
    assert res.status_code == 200, res.text
    assert res.json()["in_app_enabled"] is False and res.json()["email_enabled"] is True
    _create(http, world)
    assert world["s"].query(WorkItemNotification).count() == 0
    assert notification_allowed(world["s"], task_type="task", priority="medium", due_date=None,
                                event="assignment", channel="email") is True
    assert notification_allowed(world["s"], task_type="task", priority="medium", due_date=None,
                                event="assignment", channel="in_app") is False


def test_email_channel_off_keeps_in_app(http, world):
    http(ADMIN).put("/api/v1/core/admin/notification-settings/task", json={
        "enabled": True, "notify_assignment": True, "notify_accept": True, "notify_complete": True,
        "email_enabled": False, "in_app_enabled": True,
        "priorities": ["low", "medium", "high", "urgent"], "due_date_rule": "any",
    })
    _create(http, world)
    assert _kinds(http, WORKER) == ["task_created"]
    assert notification_allowed(world["s"], task_type="task", priority="medium", due_date=None,
                                event="assignment", channel="email") is False
    # Eski istemci (kanal alanlari yok) → iki kanal da acik kalir.
    res = http(ADMIN).put("/api/v1/core/admin/notification-settings/issue", json={
        "enabled": True, "notify_assignment": True, "notify_accept": True, "notify_complete": True,
        "priorities": ["low"], "due_date_rule": "any",
    })
    assert res.status_code == 200 and res.json()["email_enabled"] is True and res.json()["in_app_enabled"] is True
    rows = http(ADMIN).get("/api/v1/core/admin/notification-settings").json()
    assert all("in_app_enabled" in r and "email_enabled" in r for r in rows)


def test_priority_rule_applies_to_in_app(http, world):
    http(ADMIN).put("/api/v1/core/admin/notification-settings/task", json={
        "enabled": True, "notify_assignment": True, "notify_accept": True, "notify_complete": True,
        "priorities": ["urgent"], "due_date_rule": "any",
    })
    _create(http, world)  # medium → kural disi
    assert _kinds(http, WORKER) == []


def test_purge_read_only_deletes_old_read_rows(world, http):
    from datetime import datetime, timedelta, timezone
    from app.services.notification_service import purge_read
    _create(http, world)
    items = http(WORKER).get(NOTIF).json()["items"]
    http(WORKER).post(f"{NOTIF}/{items[0]['id']}/read")
    s = world["s"]
    assert purge_read(s, dry_run=True)["candidates"] == 0
    row = s.query(WorkItemNotification).first()
    row.read_at = datetime.now(timezone.utc) - timedelta(days=120)
    s.commit()
    assert purge_read(s)["deleted"] == 1
    assert s.query(WorkItemNotification).count() == 0


def test_cleanup_accepts_tenant_runner_contract(world, http):
    """Job yolu: tenant_runner `work(db, tenant_id=..., dry_run=..., trigger=...)`
    cagirir — servis fazla anahtari kabul etmeli (canli TypeError bulgusu,
    dev 22.09). Runner'in kendi oturumu test DB'sine baglanamadigi icin
    sozlesme dogrudan cagriyla kilitlenir."""
    from app.services.notification_service import purge_read
    out = purge_read(world["s"], tenant_id=uuid.UUID(TEST_TENANT_ID), dry_run=True, trigger="cron")
    assert out["ok"] is True and out["dry_run"] is True
    assert out["tenant_id"] == TEST_TENANT_ID
