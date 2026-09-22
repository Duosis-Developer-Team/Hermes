"""
=============================================================================
PM rework P3.1 — Ana sayfa "Islerim" blogu (D3) + `/tasks/key/{key}` (E6)
=============================================================================
Kilitlenen sozlesmeler (04-roller §4.2, §7; 05 D3/E6):
  1. Uc kova: gecikmis (< bugun) · bugun (= bugun) · bu hafta (bugun <
     termin <= Pazar). Gelecek hafta ve TERMINSIZ isler blokta YOK.
  2. done/cancelled kategorisi ve arsivli isler kovaya girmez; kendi
     payini bitirmis assignee icin is "benim isim" degildir.
  3. Kova ici PROJEYE gore gruplu (Musteri · Proje + sayi); grup ici
     sira termin → oncelik (urgent > high > medium > low).
  4. Izin: tasks.access VEYA issues.access VEYA tasks.admin; digeri 403.
  5. Kod ile cozum: buyuk/kucuk harf duyarsiz; A9 alias'i da cozulur;
     gorunmeyen kayit 404 (varlik sizmaz).
=============================================================================
"""
import uuid
from datetime import date, datetime, timezone

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
from app.models.work_item import RoutingRelation, WorkItemCodeAlias, WorkItemParticipant
from app.services import home_service

TEST_TENANT_ID = "00000000-0000-0000-0000-0000000000a1"

REPORTER = uuid.UUID("00000000-0000-4000-8000-00000000d301")
WORKER = uuid.UUID("00000000-0000-4000-8000-00000000d302")
ISSUE_ONLY = uuid.UUID("00000000-0000-4000-8000-00000000d303")
MATE = uuid.UUID("00000000-0000-4000-8000-00000000d306")
STRANGER = uuid.UUID("00000000-0000-4000-8000-00000000d304")
NOBODY = uuid.UUID("00000000-0000-4000-8000-00000000d305")

BASE = "/api/v1/core/tasks"
HOME = "/api/v1/core/home/my-work"

TODAY = date(2026, 9, 16)  # Carsamba → hafta 14–20 Eylul


@pytest.fixture()
def world(pg_session, authz_grants, monkeypatch):
    s = pg_session
    s.execute(sa_text(
        "TRUNCATE work_item_notifications, work_item_participants, work_item_code_aliases, "
        "work_item_comments, work_item_events, work_items, routing_relations, "
        "project_memberships, tasks, projects, customers CASCADE"
    ))
    s.commit()
    c = Customer(id=uuid.uuid4(), name="Vakko", is_active=True)
    c2 = Customer(id=uuid.uuid4(), name="Arcelik", is_active=True)
    p = Project(id=uuid.uuid4(), customer_id=c.id, name="ATM", is_active=True)
    p2 = Project(id=uuid.uuid4(), customer_id=c2.id, name="Portal", is_active=True)
    s.add_all([c, c2, p, p2])
    s.commit()
    s.add_all([
        RoutingRelation(assigner_user_id=REPORTER, assignee_user_id=WORKER, scope="task"),
        RoutingRelation(assigner_user_id=REPORTER, assignee_user_id=MATE, scope="task"),
    ])
    s.commit()
    authz_grants[str(REPORTER)] = [Perm.TASKS_ACCESS, Perm.TASKS_ASSIGN]
    authz_grants[str(WORKER)] = [Perm.TASKS_ACCESS]
    authz_grants[str(MATE)] = [Perm.TASKS_ACCESS]
    authz_grants[str(STRANGER)] = [Perm.TASKS_ACCESS]
    authz_grants[str(ISSUE_ONLY)] = [Perm.ISSUES_ACCESS]
    authz_grants[str(NOBODY)] = []
    monkeypatch.setattr(home_service, "today_in_tenant_tz", lambda: TODAY)
    return {"s": s, "customer": c, "project": p, "customer2": c2, "project2": p2}


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


def _create(http, world, title, *, due=None, priority="medium", project=None, customer=None,
            assignee=WORKER):
    body = {
        "customer_id": str((customer or world["customer"]).id),
        "project_id": str((project or world["project"]).id),
        "title": title, "description": "d", "assignee_user_id": str(assignee),
        "scheduled_date": "2026-09-01", "priority": priority, "task_type": "task",
    }
    if due:
        body["due_date"] = due.isoformat()
    res = http(REPORTER).post(BASE, json=body)
    assert res.status_code == 201, res.text
    return res.json()


def _titles(bucket):
    return [(g["project_name"], [i["title"] for i in g["items"]]) for g in bucket["groups"]]


def test_three_buckets_ignore_undated_future_and_closed(http, world):
    _create(http, world, "Gecikmis", due=date(2026, 9, 10))
    _create(http, world, "Bugun", due=TODAY)
    _create(http, world, "Cuma", due=date(2026, 9, 18))
    _create(http, world, "Pazar", due=date(2026, 9, 20))
    _create(http, world, "Gelecek hafta", due=date(2026, 9, 21))
    _create(http, world, "Terminsiz")
    done = _create(http, world, "Bitmis", due=date(2026, 9, 11))
    assert http(WORKER).patch(f"{BASE}/{done['id']}/status", json={"status": "in_progress"}).status_code == 200
    assert http(WORKER).patch(f"{BASE}/{done['id']}/complete", json={"completed": True}).status_code == 200

    body = http(WORKER).get(HOME).json()
    assert body["today"] == "2026-09-16"
    assert body["week_start"] == "2026-09-14" and body["week_end"] == "2026-09-20"
    assert _titles(body["overdue"]) == [("ATM", ["Gecikmis"])]
    assert _titles(body["due_today"]) == [("ATM", ["Bugun"])]
    assert _titles(body["this_week"]) == [("ATM", ["Cuma", "Pazar"])]
    assert body["overdue"]["count"] == 1 and body["this_week"]["count"] == 2
    item = body["overdue"]["groups"][0]["items"][0]
    assert item["item_key"].startswith("TASK-") and item["state_category"] == "todo"
    assert body["overdue"]["groups"][0]["customer_name"] == "Vakko"


def test_groups_by_project_and_orders_due_then_priority(http, world):
    p2 = world["project2"]
    _create(http, world, "ATM orta", due=date(2026, 9, 17), priority="medium")
    _create(http, world, "ATM acil", due=date(2026, 9, 17), priority="urgent")
    _create(http, world, "ATM erken dusuk", due=date(2026, 9, 16 + 1), priority="low")
    _create(http, world, "Portal yarin", due=date(2026, 9, 17), project=p2, customer=world["customer2"])
    _create(http, world, "ATM gec", due=date(2026, 9, 19), priority="urgent")

    body = http(WORKER).get(HOME).json()
    week = body["this_week"]
    assert week["count"] == 5
    # Iki grup; ayni termin → musteri adi (Arcelik < Vakko) once.
    assert [g["project_name"] for g in week["groups"]] == ["Portal", "ATM"]
    atm = week["groups"][1]
    assert atm["customer_name"] == "Vakko" and atm["count"] == 4
    # Termin → oncelik: 17 Eylul (urgent, medium, low) sonra 19 Eylul.
    assert [i["title"] for i in atm["items"]] == ["ATM acil", "ATM orta", "ATM erken dusuk", "ATM gec"]


def test_only_my_open_share_counts(http, world):
    mine = _create(http, world, "Benim", due=TODAY)
    _create(http, world, "Baskasinin", due=TODAY, assignee=MATE)
    # Sahibi MATE; ben ikinci assignee'yim → acik payim varken benim kovamda.
    shared = _create(http, world, "Ortak", due=TODAY, assignee=MATE)
    s = world["s"]
    s.add(WorkItemParticipant(work_item_id=uuid.UUID(shared["id"]), user_id=WORKER,
                              role="assignee", added_by_user_id=REPORTER))
    s.commit()
    assert _titles(http(WORKER).get(HOME).json()["due_today"]) == [("ATM", ["Benim", "Ortak"])]

    # Kendi payimi bitirdim, is hala acik (sahibi bitirmedi) → artik benim isim degil.
    row = s.query(WorkItemParticipant).filter_by(work_item_id=uuid.UUID(shared["id"]), user_id=WORKER).one()
    row.completed_at = datetime.now(timezone.utc)
    s.commit()
    body = http(WORKER).get(HOME).json()
    assert _titles(body["due_today"]) == [("ATM", ["Benim"])]
    assert body["due_today"]["groups"][0]["items"][0]["id"] == mine["id"]
    assert body["due_today"]["groups"][0]["items"][0]["is_owner"] is True
    # Sahip (MATE) icin ortak is durur: sahiplik pay bitse de sorumluluk.
    assert _titles(http(MATE).get(HOME).json()["due_today"]) == [("ATM", ["Baskasinin", "Ortak"])]
    # Isi acan (reporter) sahibi degilse onun kovasinda gorunmez.
    assert http(REPORTER).get(HOME).json()["due_today"]["count"] == 0
    # Hicbir isi olmayan kullanici: uc kova bos, hata yok.
    empty = http(STRANGER).get(HOME).json()
    assert empty["overdue"] == {"count": 0, "groups": []}
    assert empty["due_today"]["count"] == 0 and empty["this_week"]["count"] == 0


def test_permission_gate(http, world):
    assert http(NOBODY).get(HOME).status_code == 403
    assert http(ISSUE_ONLY).get(HOME).status_code == 200


def test_lookup_by_key_and_alias(http, world):
    item = _create(http, world, "Kodlu", due=TODAY)
    key = item["task_code"]
    res = http(WORKER).get(f"{BASE}/key/{key.lower()}")
    assert res.status_code == 200 and res.json()["id"] == item["id"]
    # A9 alias: birlesmede kaybolan eski kod ayni kayda gider.
    world["s"].add(WorkItemCodeAlias(code="TASK-99999", work_item_id=uuid.UUID(item["id"])))
    world["s"].commit()
    assert http(WORKER).get(f"{BASE}/key/TASK-99999").json()["id"] == item["id"]
    assert http(WORKER).get(f"{BASE}/key/TASK-424242").status_code == 404
    # Gorunmeyen kayit = var olmayan kayit.
    assert http(STRANGER).get(f"{BASE}/key/{key}").status_code == 404
    assert http(NOBODY).get(f"{BASE}/key/{key}").status_code == 403
