"""
=============================================================================
PM rework P3.1/P3.2 — Ana sayfa "Islerim" (D3), Takvimim (D4) + `/tasks/key/{key}` (E6)
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
from datetime import date, datetime, timedelta, timezone

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


# =============================================================================
# D4 Takvimim — /home/week
# =============================================================================

def _seed_meeting(s, *, subject, start_utc, attendee, cancelled=False):
    from app.models.meeting import Meeting, MeetingAttendee
    m = Meeting(
        id=uuid.uuid4(), external_event_id=f"ev-{uuid.uuid4()}", subject=subject,
        start_datetime=start_utc, end_datetime=start_utc + timedelta(hours=1),
        is_online_meeting=True, is_cancelled=cancelled, join_url="https://teams.example/x",
    )
    s.add(m)
    s.flush()
    s.add(MeetingAttendee(meeting_id=m.id, email=f"{attendee}@x.com", hermes_user_id=attendee))
    s.commit()
    return m


def _seed_plan(s, world, *, start, end, recurrence="one_time", user=WORKER, status="pending",
               start_time="09:00", end_time="11:00"):
    from app.models.plan_time import PlanTime, PlanTimeAssignment
    p = PlanTime(
        id=uuid.uuid4(), created_by_id=REPORTER, customer_id=world["customer"].id,
        project_id=world["project"].id, start_date=start, end_date=end,
        start_time=start_time, end_time=end_time, recurrence=recurrence, description="plan",
    )
    s.add(p)
    s.flush()
    a = PlanTimeAssignment(id=uuid.uuid4(), plan_time_id=p.id, user_id=user, status=status)
    s.add(a)
    s.commit()
    return p


def test_week_merges_meetings_plans_and_due_items(http, world):
    from datetime import timezone as _tz
    s = world["s"]
    s.execute(sa_text("TRUNCATE meeting_attendees, meetings, plan_time_assignments, plan_times CASCADE"))
    s.commit()
    # 16 Eylul 06:30 UTC = 09:30 Istanbul → Carsamba; 20 Eylul 22:30 UTC = 21 Eylul 01:30 Istanbul → hafta DISI.
    _seed_meeting(s, subject="Standup", start_utc=datetime(2026, 9, 16, 6, 30, tzinfo=_tz.utc), attendee=WORKER)
    _seed_meeting(s, subject="Iptal", start_utc=datetime(2026, 9, 16, 8, 0, tzinfo=_tz.utc), attendee=WORKER, cancelled=True)
    _seed_meeting(s, subject="Baskasinin", start_utc=datetime(2026, 9, 16, 9, 0, tzinfo=_tz.utc), attendee=MATE)
    _seed_meeting(s, subject="Pazar gecesi", start_utc=datetime(2026, 9, 20, 22, 30, tzinfo=_tz.utc), attendee=WORKER)
    _seed_plan(s, world, start=date(2026, 9, 15), end=date(2026, 9, 16))                       # Sal + Car
    _seed_plan(s, world, start=date(2026, 9, 2), end=date(2026, 9, 2), recurrence="weekly")    # her Carsamba
    _seed_plan(s, world, start=date(2026, 9, 17), end=date(2026, 9, 17), status="rejected")    # reddedildi
    _seed_plan(s, world, start=date(2026, 9, 17), end=date(2026, 9, 17), user=MATE)            # baskasinin
    _create(http, world, "Termin Persembe", due=date(2026, 9, 17))
    _create(http, world, "Gecen hafta", due=date(2026, 9, 11))                                 # hafta disi
    _create(http, world, "Terminsiz")

    body = http(WORKER).get("/api/v1/core/home/week").json()
    assert body["week_start"] == "2026-09-14" and body["week_end"] == "2026-09-20" and body["today"] == "2026-09-16"
    days = {d["date"]: d for d in body["days"]}
    assert list(days) == [f"2026-09-{n}" for n in range(14, 21)]
    assert [d["is_today"] for d in body["days"]] == [False, False, True, False, False, False, False]

    wed = days["2026-09-16"]
    assert [m["subject"] for m in wed["meetings"]] == ["Standup"]
    assert wed["meetings"][0]["join_url"] == "https://teams.example/x"
    assert len(wed["plans"]) == 2 and {p["recurrence"] for p in wed["plans"]} == {"one_time", "weekly"}
    assert days["2026-09-15"]["plans"][0]["project_name"] == "ATM" and len(days["2026-09-15"]["plans"]) == 1
    assert days["2026-09-17"]["plans"] == []          # reddedilen ve baskasinin plani yok
    assert [i["title"] for i in days["2026-09-17"]["items"]] == ["Termin Persembe"]
    assert days["2026-09-20"]["meetings"] == []       # yerel saatte Pazartesi'ye tasan toplanti bu haftada degil
    assert sum(len(d["items"]) for d in body["days"]) == 1

    # Baska hafta: `start` haftanin herhangi bir gunu olabilir.
    prev = http(WORKER).get("/api/v1/core/home/week?start=2026-09-09").json()
    assert prev["week_start"] == "2026-09-07"
    assert [i["title"] for i in {d["date"]: d for d in prev["days"]}["2026-09-11"]["items"]] == ["Gecen hafta"]
    assert all(d["is_today"] is False for d in prev["days"])


def test_week_without_work_access_still_shows_calendar(http, world):
    from datetime import timezone as _tz
    s = world["s"]
    s.execute(sa_text("TRUNCATE meeting_attendees, meetings, plan_time_assignments, plan_times CASCADE"))
    s.commit()
    _seed_meeting(s, subject="Sohbet", start_utc=datetime(2026, 9, 14, 10, 0, tzinfo=_tz.utc), attendee=NOBODY)
    _seed_plan(s, world, start=date(2026, 9, 14), end=date(2026, 9, 14), user=NOBODY)
    res = http(NOBODY).get("/api/v1/core/home/week")
    assert res.status_code == 200
    mon = res.json()["days"][0]
    assert [m["subject"] for m in mon["meetings"]] == ["Sohbet"] and len(mon["plans"]) == 1
    assert all(d["items"] == [] for d in res.json()["days"])


def test_plan_recurrence_rule_matches_frontend():
    from types import SimpleNamespace as NS
    from app.services.home_service import plan_occurs_on
    weekly = NS(start_date=date(2026, 9, 2), end_date=date(2026, 9, 2), recurrence="weekly")
    monthly = NS(start_date=date(2026, 8, 19), end_date=date(2026, 8, 19), recurrence="monthly")
    once = NS(start_date=date(2026, 9, 15), end_date=date(2026, 9, 16), recurrence="one_time")
    assert plan_occurs_on(weekly, date(2026, 9, 16)) and not plan_occurs_on(weekly, date(2026, 9, 17))
    assert not plan_occurs_on(weekly, date(2026, 8, 26))                # baslangictan once
    assert plan_occurs_on(monthly, date(2026, 9, 16)) and not plan_occurs_on(monthly, date(2026, 9, 9))
    assert plan_occurs_on(once, date(2026, 9, 16)) and not plan_occurs_on(once, date(2026, 9, 17))
