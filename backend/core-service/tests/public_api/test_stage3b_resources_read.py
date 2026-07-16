# =============================================================================
# HERMES - Stage 3B testleri: customers/projects/work-logs/meetings read
# =============================================================================
# Gercek Postgres: turetilmis referans gorunurlugu, work-log task/meeting
# baglari, meeting privacy maskesi + iliskisizlik kurali.
# =============================================================================

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.models.customer import Customer
from app.models.meeting import Meeting, MeetingAttendee
from app.models.project import Project
from app.models.task import Task
from app.models.work_log import WorkLog
from app.models.work_type import WorkType

from .test_stage3a_tasks_read import make_api_client

U1, U2 = uuid.uuid4(), uuid.uuid4()
NOW = datetime.now(timezone.utc)


@pytest.fixture()
def world(pg_session):
    s = pg_session
    from sqlalchemy import text as sa_text

    s.execute(
        sa_text(
            "TRUNCATE work_logs, meeting_attendees, meetings, tasks, "
            "work_types, projects, customers CASCADE"
        )
    )
    s.commit()

    c1 = Customer(id=uuid.uuid4(), name="Vakko", is_active=True)
    c2 = Customer(id=uuid.uuid4(), name="Acme", is_active=True)
    c3 = Customer(id=uuid.uuid4(), name="Hidden Corp", is_active=True)
    c4 = Customer(id=uuid.uuid4(), name="Old Co", is_active=False)
    p1 = Project(id=uuid.uuid4(), customer_id=c1.id, name="ATM", is_active=True)
    p2 = Project(id=uuid.uuid4(), customer_id=c2.id, name="Mon", is_active=True)
    p3 = Project(
        id=uuid.uuid4(), customer_id=c3.id, name="Secret", is_active=True
    )
    wt = WorkType(id=uuid.uuid4(), name="Dev", is_active=True)
    s.add_all([c1, c2, c3, c4, p1, p2, p3, wt])

    # U1'in eristigi kayitlar: c1/p1'de task, c2/p2'de work log.
    t1 = Task(
        id=uuid.uuid4(), task_number=201, type_number=201, task_type="task",
        title="t", description="d", customer_id=c1.id, project_id=p1.id,
        assignee_user_id=U1, assigner_user_id=U2,
        scheduled_date=date(2026, 7, 1), status="pending", priority="medium",
    )
    s.add(t1)
    s.flush()

    w1 = WorkLog(
        user_id=U1, customer_id=c2.id, project_id=p2.id, work_type_id=wt.id,
        date_worked=date(2026, 7, 10), duration_hours=Decimal("2.5"),
        description="log for acme", task_id=t1.id,
    )
    w2 = WorkLog(
        user_id=U2, customer_id=c3.id, project_id=p3.id, work_type_id=wt.id,
        date_worked=date(2026, 7, 11), duration_hours=Decimal("1.0"),
        description="hidden log",
    )
    s.add_all([w1, w2])

    # Meetings: m1 U1 katilimci (normal), m2 U1 katilimci (private),
    # m3 U2-only (U1 goremez), m4 cancelled U1.
    def meeting(ext, subject, start, private=False, cancelled=False):
        return Meeting(
            id=uuid.uuid4(), external_event_id=ext, source="graph",
            subject="Private Meeting" if private else subject,
            body_preview=None if private else "PREVIEW BODY",
            organizer_email="org@duosis.com", organizer_name="Org",
            start_datetime=start, end_datetime=start + timedelta(hours=1),
            duration_minutes=60, is_online_meeting=True,
            join_url="https://teams.example/j/1",
            is_cancelled=cancelled,
            sensitivity="private" if private else "normal",
        )

    m1 = meeting("e1", "Sprint Sync", NOW + timedelta(days=1))
    m2 = meeting("e2", "SECRET SUBJECT", NOW + timedelta(days=2), private=True)
    m3 = meeting("e3", "Other Team", NOW + timedelta(days=3))
    m4 = meeting("e4", "Cancelled One", NOW + timedelta(days=4), cancelled=True)
    s.add_all([m1, m2, m3, m4])
    s.flush()
    s.add_all(
        [
            MeetingAttendee(
                id=uuid.uuid4(), meeting_id=m1.id, email="u1@x.com",
                hermes_user_id=U1,
            ),
            MeetingAttendee(
                id=uuid.uuid4(), meeting_id=m2.id, email="u1@x.com",
                hermes_user_id=U1,
            ),
            MeetingAttendee(
                id=uuid.uuid4(), meeting_id=m3.id, email="u2@x.com",
                hermes_user_id=U2,
            ),
            MeetingAttendee(
                id=uuid.uuid4(), meeting_id=m4.id, email="u1@x.com",
                hermes_user_id=U1,
            ),
        ]
    )
    s.commit()
    return {
        "c1": c1, "c2": c2, "c3": c3, "c4": c4,
        "p1": p1, "p2": p2, "p3": p3,
        "w1": w1, "w2": w2, "t1": t1,
        "m1": m1, "m2": m2, "m3": m3, "m4": m4,
    }


@pytest.fixture()
def public_http(pg_session):
    from app.main import app

    public_app = next(
        r.app for r in app.routes if getattr(r, "path", "") == "/api/public"
    )
    public_app.dependency_overrides[get_db] = lambda: pg_session
    http = TestClient(app, raise_server_exceptions=False)
    yield http
    public_app.dependency_overrides.pop(get_db, None)


ALL_READ = ["customers:read", "projects:read", "work-logs:read", "meetings:read"]


def names(resp):
    return sorted(x["name"] for x in resp.json()["data"])


# ── Customers/Projects: turetilmis gorunurluk ───────────────────────────


def test_global_sees_all_active_reference(world, public_http, pg_session):
    h = make_api_client(pg_session, "g", [("global", None)], scopes=ALL_READ)
    r = public_http.get("/api/public/v1/customers", headers=h)
    assert names(r) == ["Acme", "Hidden Corp", "Vakko"]  # inaktif Old Co yok
    r = public_http.get("/api/public/v1/projects", headers=h)
    assert names(r) == ["ATM", "Mon", "Secret"]


def test_user_binding_sees_only_referenced_reference_data(
    world, public_http, pg_session
):
    """U1: task'i c1/p1'de, work log'u c2/p2'de → c3 'Hidden Corp' ve p3
    ASLA gorunmez (envanter enumerasyonu engellenir)."""
    h = make_api_client(pg_session, "u", [("user", U1)], scopes=ALL_READ)
    r = public_http.get("/api/public/v1/customers", headers=h)
    assert names(r) == ["Acme", "Vakko"]
    r = public_http.get("/api/public/v1/projects", headers=h)
    assert names(r) == ["ATM", "Mon"]
    # Detay: kapsam disi = 404 (gercekten olmayanla ayni).
    out = public_http.get(
        f"/api/public/v1/customers/{world['c3'].id}", headers=h
    )
    missing = public_http.get(
        f"/api/public/v1/customers/{uuid.uuid4()}", headers=h
    )
    assert out.status_code == missing.status_code == 404
    assert out.json()["error"]["message"] == missing.json()["error"]["message"]


def test_explicit_customer_binding_reference(world, public_http, pg_session):
    h = make_api_client(
        pg_session, "c", [("customer", world["c1"].id)], scopes=ALL_READ
    )
    assert names(public_http.get("/api/public/v1/customers", headers=h)) == [
        "Vakko"
    ]
    # Musteri binding'i o musterinin projelerini acar.
    assert names(public_http.get("/api/public/v1/projects", headers=h)) == [
        "ATM"
    ]


def test_project_binding_exposes_parent_customer(
    world, public_http, pg_session
):
    h = make_api_client(
        pg_session, "p", [("project", world["p2"].id)], scopes=ALL_READ
    )
    assert names(public_http.get("/api/public/v1/customers", headers=h)) == [
        "Acme"
    ]
    assert names(public_http.get("/api/public/v1/projects", headers=h)) == [
        "Mon"
    ]


def test_no_binding_reference_fails_closed(world, public_http, pg_session):
    h = make_api_client(pg_session, "e", [], scopes=ALL_READ)
    assert public_http.get(
        "/api/public/v1/customers", headers=h
    ).json()["data"] == []
    assert public_http.get(
        "/api/public/v1/projects", headers=h
    ).json()["data"] == []


# ── Work logs ───────────────────────────────────────────────────────────


def test_work_logs_user_binding_and_links(world, public_http, pg_session):
    h = make_api_client(pg_session, "wu", [("user", U1)], scopes=ALL_READ)
    r = public_http.get("/api/public/v1/work-logs", headers=h)
    assert r.status_code == 200
    data = r.json()["data"]
    assert len(data) == 1  # yalniz U1'in logu; hidden log yok
    log = data[0]
    assert log["description"] == "log for acme"
    assert log["task_code"] == "TASK-201"  # task baglantisi kod olarak
    assert log["duration_hours"] == 2.5
    # Internal alanlar sizmiyor.
    for forbidden in ("billable_duration_hours", "work_type_id", "task_id"):
        assert forbidden not in log
    assert "hidden log" not in r.text


def test_work_logs_filters_and_detail_404(world, public_http, pg_session):
    h = make_api_client(pg_session, "wg", [("global", None)], scopes=ALL_READ)
    r = public_http.get(
        "/api/public/v1/work-logs",
        headers=h,
        params={"task_code": "TASK-201"},
    )
    assert [x["id"] for x in r.json()["data"]] == [world["w1"].id]
    r = public_http.get(
        "/api/public/v1/work-logs",
        headers=h,
        params={"date_from": "2026-07-11"},
    )
    assert [x["description"] for x in r.json()["data"]] == ["hidden log"]

    # Kapsam disi detay 404 == olmayan id 404.
    h_u1 = make_api_client(pg_session, "wu2", [("user", U1)], scopes=ALL_READ)
    out = public_http.get(
        f"/api/public/v1/work-logs/{world['w2'].id}", headers=h_u1
    )
    missing = public_http.get(
        "/api/public/v1/work-logs/999999999", headers=h_u1
    )
    assert out.status_code == missing.status_code == 404
    assert out.json()["error"]["message"] == missing.json()["error"]["message"]


# ── Meetings ────────────────────────────────────────────────────────────


def test_meetings_attendee_visibility_and_privacy(
    world, public_http, pg_session
):
    h = make_api_client(pg_session, "mu", [("user", U1)], scopes=ALL_READ)
    r = public_http.get("/api/public/v1/meetings", headers=h)
    assert r.status_code == 200
    subjects = sorted(m["subject"] for m in r.json()["data"])
    # m1 + m2 (private, maskeli); m3 (U2-only) yok; m4 cancelled default yok.
    assert subjects == ["Private Meeting", "Sprint Sync"]
    text = r.text
    assert "SECRET SUBJECT" not in text
    assert "PREVIEW BODY" not in text  # body alanlari public semada yok
    assert "body_preview" not in text
    priv = next(m for m in r.json()["data"] if m["is_private"])
    assert priv["subject"] == "Private Meeting"
    assert priv["join_url"]  # gorunurluk kapisini gecen token'a join_url var


def test_meetings_customer_project_binding_gets_nothing(
    world, public_http, pg_session
):
    """Meetings'in musteri/proje iliskisi yok → yalniz customer/project
    binding'li token hic meeting goremez."""
    h = make_api_client(
        pg_session,
        "mc",
        [("customer", world["c1"].id), ("project", world["p1"].id)],
        scopes=ALL_READ,
    )
    r = public_http.get("/api/public/v1/meetings", headers=h)
    assert r.status_code == 200
    assert r.json()["data"] == []
    # Detay da 404 (var olan ama erisilemeyen meeting).
    out = public_http.get(
        f"/api/public/v1/meetings/{world['m1'].id}", headers=h
    )
    assert out.status_code == 404


def test_meetings_include_cancelled_and_range(world, public_http, pg_session):
    h = make_api_client(pg_session, "mg", [("global", None)], scopes=ALL_READ)
    r = public_http.get(
        "/api/public/v1/meetings",
        headers=h,
        params={"include_cancelled": "true"},
    )
    assert len(r.json()["data"]) == 4
    r = public_http.get(
        "/api/public/v1/meetings",
        headers=h,
        params={"start_from": (NOW + timedelta(days=2, hours=-1)).isoformat()},
    )
    assert sorted(m["subject"] for m in r.json()["data"]) == [
        "Other Team",
        "Private Meeting",
    ]


# ── Scope ayrimi ────────────────────────────────────────────────────────


def test_each_resource_requires_its_scope(world, public_http, pg_session):
    h = make_api_client(
        pg_session, "only-cust", [("global", None)], scopes=["customers:read"]
    )
    assert public_http.get("/api/public/v1/customers", headers=h).status_code == 200
    for path in ("/api/public/v1/projects", "/api/public/v1/work-logs",
                 "/api/public/v1/meetings"):
        r = public_http.get(path, headers=h)
        assert r.status_code == 403, path
        assert r.json()["error"]["code"] == "insufficient_scope"
