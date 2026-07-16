# =============================================================================
# HERMES - Stage 3D testleri: POST /v1/work-logs (user-bound create)
# =============================================================================
# Onayli kurallar sinanir:
#   - yalnizca user-bound client yazar; log HER ZAMAN bagli kullanicinin
#   - task_code/meeting_id baglantilari AccessScope'tan gecer; kapsam
#     disi == var olmayan (AYNI 404 zarfi, request_id haric bayt-esit)
#   - task_code + meeting_id birlikte → 422 (tek-baglanti kurali)
#   - yasak alanlar (user_id, task_id, billable, created_by...) → 422
#   - idempotency: replay / farkli-govde conflict / in-flight
#     idempotency_request_in_progress
#   - internal parity: billable=duration default'u, log_time_created
#     activity event'i, internal endpoint korumasi bozulmadi
# =============================================================================

import json as _json
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.models.api_client import ApiIdempotencyKey
from app.models.customer import Customer
from app.models.meeting import Meeting, MeetingAttendee
from app.models.project import Project
from app.models.task import Task
from app.models.work_log import WorkLog
from app.models.work_type import WorkType

from .test_stage3a_tasks_read import make_api_client

BU = uuid.uuid4()  # bound user
U2 = uuid.uuid4()  # baska kullanici (kapsam disi kayitlarin sahibi)
NOW = datetime(2026, 7, 16, 9, 0, tzinfo=timezone.utc)

WL_SCOPES = ["work-logs:read", "work-logs:write"]
CREATE = "/api/public/v1/work-logs"


@pytest.fixture()
def world(pg_session):
    s = pg_session
    from sqlalchemy import text as sa_text

    s.execute(
        sa_text(
            "TRUNCATE task_activity_events, work_logs, meeting_attendees, "
            "meetings, tasks, work_types, projects, customers CASCADE"
        )
    )
    s.commit()

    c1 = Customer(id=uuid.uuid4(), name="Vakko", is_active=True)
    c_off = Customer(id=uuid.uuid4(), name="Old Co", is_active=False)
    p1 = Project(id=uuid.uuid4(), customer_id=c1.id, name="ATM", is_active=True)
    wt = WorkType(id=uuid.uuid4(), name="Dev", is_active=True)
    wt_off = WorkType(id=uuid.uuid4(), name="Retired", is_active=False)
    s.add_all([c1, c_off, p1, wt, wt_off])

    # t1 bagli kullaniciya gorunur (assignee=BU); t_hidden degil.
    t1 = Task(
        id=uuid.uuid4(), task_number=301, type_number=301, task_type="task",
        title="mine", description="d", customer_id=c1.id, project_id=p1.id,
        assignee_user_id=BU, assigner_user_id=U2,
        scheduled_date=date(2026, 7, 1), status="pending", priority="medium",
    )
    t_hidden = Task(
        id=uuid.uuid4(), task_number=302, type_number=302, task_type="task",
        title="theirs", description="d", customer_id=c1.id, project_id=p1.id,
        assignee_user_id=U2, assigner_user_id=U2,
        scheduled_date=date(2026, 7, 1), status="pending", priority="medium",
    )
    s.add_all([t1, t_hidden])

    def meeting(ext, subject, start):
        return Meeting(
            id=uuid.uuid4(), external_event_id=ext, source="graph",
            subject=subject, body_preview=None,
            organizer_email="org@duosis.com", organizer_name="Org",
            start_datetime=start, end_datetime=start + timedelta(hours=1),
            duration_minutes=60, is_online_meeting=False,
            is_cancelled=False, sensitivity="normal",
        )

    m1 = meeting("e1", "Sprint Sync", NOW + timedelta(days=1))
    m_hidden = meeting("e2", "Other Team", NOW + timedelta(days=2))
    s.add_all([m1, m_hidden])
    s.flush()
    s.add_all(
        [
            MeetingAttendee(
                id=uuid.uuid4(), meeting_id=m1.id, email="bu@x.com",
                hermes_user_id=BU,
            ),
            MeetingAttendee(
                id=uuid.uuid4(), meeting_id=m_hidden.id, email="u2@x.com",
                hermes_user_id=U2,
            ),
        ]
    )
    s.commit()
    return {
        "c1": c1, "c_off": c_off, "p1": p1, "wt": wt, "wt_off": wt_off,
        "t1": t1, "t_hidden": t_hidden, "m1": m1, "m_hidden": m_hidden,
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


def bound_client(pg_session, user_id, name=None, scopes=None):
    return make_api_client(
        pg_session,
        name or f"wl-{uuid.uuid4().hex[:6]}",
        [("user", user_id)],
        client_type="user",
        bound_user_id=user_id,
        scopes=scopes if scopes is not None else WL_SCOPES,
    )


def wl_payload(world, **overrides):
    base = {
        "customer_id": str(world["c1"].id),
        "project_id": str(world["p1"].id),
        "work_type_id": str(world["wt"].id),
        "date_worked": "2026-07-15",
        "duration_hours": 2.5,
        "description": "public api time entry",
    }
    base.update(overrides)
    return base


def _count_logs(s):
    return s.query(WorkLog).count()


def _envelope_without_rid(resp):
    body = resp.json()
    body["error"].pop("request_id", None)
    return resp.status_code, body


# ── Client-type ve scope kapilari ───────────────────────────────────────


def test_service_client_with_write_scope_rejected(
    world, public_http, pg_session
):
    h = make_api_client(
        pg_session, "svc-wl", [("global", None)], scopes=WL_SCOPES
    )
    r = public_http.post(CREATE, headers=h, json=wl_payload(world))
    assert r.status_code == 403
    err = r.json()["error"]
    assert err["code"] == "resource_access_denied"
    assert "user-bound" in err["message"]
    assert _count_logs(pg_session) == 0


def test_bound_client_without_write_scope_rejected(
    world, public_http, pg_session
):
    h = bound_client(pg_session, BU, scopes=["work-logs:read"])
    r = public_http.post(CREATE, headers=h, json=wl_payload(world))
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "insufficient_scope"
    assert _count_logs(pg_session) == 0


# ── Mutlu yol + internal parity ─────────────────────────────────────────


def test_create_work_log_success(world, public_http, pg_session):
    h = bound_client(pg_session, BU)
    r = public_http.post(CREATE, headers=h, json=wl_payload(world))
    assert r.status_code == 201
    body = r.json()
    assert isinstance(body["id"], int)
    assert body["user_id"] == str(BU)  # log HER ZAMAN bagli kullanicinin
    assert body["duration_hours"] == 2.5
    assert body["customer"]["name"] == "Vakko"
    assert body["project"]["name"] == "ATM"
    assert body["task_code"] is None
    assert body["meeting_id"] is None
    # Internal-only alanlar public govdede YOK.
    assert "billable_duration_hours" not in body
    assert "work_type_id" not in body

    row = pg_session.query(WorkLog).one()
    assert row.user_id == BU
    assert row.duration_hours == Decimal("2.5")
    # Internal kural parity: billable default = duration.
    assert row.billable_duration_hours == Decimal("2.5")


def test_created_log_readable_via_public_read(world, public_http, pg_session):
    h = bound_client(pg_session, BU)
    created = public_http.post(CREATE, headers=h, json=wl_payload(world))
    log_id = created.json()["id"]
    r = public_http.get(f"{CREATE}/{log_id}", headers=h)
    assert r.status_code == 200
    assert r.json()["id"] == log_id
    listed = public_http.get(CREATE, headers=h)
    assert log_id in [x["id"] for x in listed.json()["data"]]


# ── Govde dogrulama ─────────────────────────────────────────────────────


def test_forbidden_fields_rejected(world, public_http, pg_session):
    h = bound_client(pg_session, BU)
    for field, value in [
        ("user_id", str(U2)),
        ("target_user_id", str(U2)),
        ("task_id", str(world["t1"].id)),  # internal UUID kabul edilmez
        ("billable_duration_hours", 1.0),
        ("created_by", str(U2)),
        ("is_approved", True),
        ("issue_id", str(uuid.uuid4())),
    ]:
        r = public_http.post(
            CREATE, headers=h, json=wl_payload(world, **{field: value})
        )
        assert r.status_code == 422, field
        assert r.json()["error"]["code"] == "validation_error"
    assert _count_logs(pg_session) == 0


def test_duration_bounds_enforced(world, public_http, pg_session):
    h = bound_client(pg_session, BU)
    for bad in (0.1, 25, 0, -1):
        r = public_http.post(
            CREATE, headers=h, json=wl_payload(world, duration_hours=bad)
        )
        assert r.status_code == 422, bad
    assert _count_logs(pg_session) == 0


def test_task_and_meeting_together_rejected(world, public_http, pg_session):
    h = bound_client(pg_session, BU)
    r = public_http.post(
        CREATE,
        headers=h,
        json=wl_payload(
            world, task_code="TASK-301", meeting_id=str(world["m1"].id)
        ),
    )
    assert r.status_code == 422
    assert "not both" in r.json()["error"]["message"]
    assert _count_logs(pg_session) == 0


# ── Referans dogrulama (var olmayan == aktif olmayan) ──────────────────


def test_unknown_and_inactive_customer_same_404(
    world, public_http, pg_session
):
    h = bound_client(pg_session, BU)
    r_missing = public_http.post(
        CREATE,
        headers=h,
        json=wl_payload(world, customer_id=str(uuid.uuid4())),
    )
    r_inactive = public_http.post(
        CREATE,
        headers=h,
        json=wl_payload(world, customer_id=str(world["c_off"].id)),
    )
    assert _envelope_without_rid(r_missing) == _envelope_without_rid(
        r_inactive
    )
    assert r_missing.status_code == 404
    msg = r_missing.json()["error"]["message"]
    assert msg == "Referenced customer_id not found."
    # Internal Turkce mesaj / ham UUID sizmaz.
    assert "Müşteri" not in msg
    assert str(world["c_off"].id) not in msg
    assert _count_logs(pg_session) == 0


def test_inactive_work_type_404(world, public_http, pg_session):
    h = bound_client(pg_session, BU)
    r = public_http.post(
        CREATE,
        headers=h,
        json=wl_payload(world, work_type_id=str(world["wt_off"].id)),
    )
    assert r.status_code == 404
    assert r.json()["error"]["message"] == "Referenced work_type_id not found."
    assert _count_logs(pg_session) == 0


# ── Baglantilar: gorunurluk + kapsam ────────────────────────────────────


def test_task_link_case_insensitive_and_recorded(
    world, public_http, pg_session
):
    h = bound_client(pg_session, BU)
    r = public_http.post(
        CREATE, headers=h, json=wl_payload(world, task_code="task-301")
    )
    assert r.status_code == 201
    assert r.json()["task_code"] == "TASK-301"
    row = pg_session.query(WorkLog).one()
    assert row.task_id == world["t1"].id
    # Internal parity: log_time_created activity event'i uretildi.
    from sqlalchemy import text as sa_text

    events = pg_session.execute(
        sa_text(
            "SELECT event_type FROM task_activity_events "
            "WHERE task_id = :tid"
        ),
        {"tid": str(world["t1"].id)},
    ).fetchall()
    assert ("log_time_created",) in events


def test_out_of_scope_task_link_identical_404(world, public_http, pg_session):
    """Kapsam disi task == var olmayan task (bayt-esit zarf, request_id
    haric); is kaydi OLUSMAZ."""
    h = bound_client(pg_session, BU)
    r_hidden = public_http.post(
        CREATE, headers=h, json=wl_payload(world, task_code="TASK-302")
    )
    r_missing = public_http.post(
        CREATE, headers=h, json=wl_payload(world, task_code="TASK-99999")
    )
    assert r_hidden.status_code == 404
    assert _envelope_without_rid(r_hidden) == _envelope_without_rid(r_missing)
    assert _count_logs(pg_session) == 0


def test_meeting_link_success(world, public_http, pg_session):
    h = bound_client(pg_session, BU)
    r = public_http.post(
        CREATE,
        headers=h,
        json=wl_payload(world, meeting_id=str(world["m1"].id)),
    )
    assert r.status_code == 201
    assert r.json()["meeting_id"] == str(world["m1"].id)
    assert pg_session.query(WorkLog).one().meeting_id == world["m1"].id


def test_out_of_scope_meeting_link_identical_404(
    world, public_http, pg_session
):
    h = bound_client(pg_session, BU)
    r_hidden = public_http.post(
        CREATE,
        headers=h,
        json=wl_payload(world, meeting_id=str(world["m_hidden"].id)),
    )
    r_missing = public_http.post(
        CREATE,
        headers=h,
        json=wl_payload(world, meeting_id=str(uuid.uuid4())),
    )
    assert r_hidden.status_code == 404
    assert _envelope_without_rid(r_hidden) == _envelope_without_rid(r_missing)
    assert _count_logs(pg_session) == 0


# ── Idempotency ─────────────────────────────────────────────────────────


def test_idempotent_replay_single_row(world, public_http, pg_session):
    h = bound_client(pg_session, BU)
    payload = wl_payload(world)
    key = {"Idempotency-Key": "wl-key-00001"}
    r1 = public_http.post(CREATE, headers={**h, **key}, json=payload)
    r2 = public_http.post(CREATE, headers={**h, **key}, json=payload)
    assert r1.status_code == r2.status_code == 201
    assert r2.headers.get("Idempotency-Replayed") == "true"
    assert r1.json() == r2.json()
    assert _count_logs(pg_session) == 1


def test_same_key_different_payload_conflicts(world, public_http, pg_session):
    h = bound_client(pg_session, BU)
    key = {"Idempotency-Key": "wl-key-00002"}
    r1 = public_http.post(
        CREATE, headers={**h, **key}, json=wl_payload(world)
    )
    r2 = public_http.post(
        CREATE,
        headers={**h, **key},
        json=wl_payload(world, duration_hours=3.0),
    )
    assert r1.status_code == 201
    assert r2.status_code == 409
    assert r2.json()["error"]["code"] == "conflict"
    assert _count_logs(pg_session) == 1


def test_in_flight_key_returns_in_progress(world, public_http, pg_session):
    """Rezervasyon (response_status NULL) varken ayni anahtar stabil
    `idempotency_request_in_progress` kodunu doner; kayit OLUSMAZ."""
    h = bound_client(pg_session, BU, name="wl-inflight")
    from app.models.api_client import ApiClient
    from app.public_api.idempotency import canonical_hash
    from app.public_api.schemas.resources import PublicWorkLogCreate

    client_row = (
        pg_session.query(ApiClient)
        .filter(ApiClient.name == "wl-inflight")
        .first()
    )
    payload = wl_payload(world)
    normalized = _json.loads(
        PublicWorkLogCreate(**payload).model_dump_json()
    )
    pg_session.add(
        ApiIdempotencyKey(
            client_id=client_row.id,
            key="wl-race-0001",
            request_hash=canonical_hash(
                client_row.id, "POST", "/v1/work-logs", normalized
            ),
        )
    )
    pg_session.commit()

    r = public_http.post(
        CREATE,
        headers={**h, "Idempotency-Key": "wl-race-0001"},
        json=payload,
    )
    assert r.status_code == 409
    err = r.json()["error"]
    assert err["code"] == "idempotency_request_in_progress"
    assert "safe to retry" in err["message"]
    assert _count_logs(pg_session) == 0


# ── Kesif/dokumantasyon + internal regresyon ───────────────────────────


def test_capabilities_document_write_rules(public_http):
    r = public_http.get("/api/public/v1/capabilities")
    writes = r.json()["writes"]
    assert writes["client_types"] == ["user"]
    assert writes["service_clients"] == "read-only"
    assert writes["destructive_operations"] == "unavailable"
    idem = writes["idempotency"]
    assert idem["retention_hours"] == 24
    assert (
        idem["in_progress_error_code"] == "idempotency_request_in_progress"
    )


def test_openapi_documents_idempotency_and_write_limits(public_http):
    r = public_http.get("/api/public/v1/openapi.json")
    spec = r.json()
    desc = spec["info"]["description"]
    assert "idempotency_request_in_progress" in desc
    assert "Service clients are read-only" in desc
    # E-posta paritesi IDDIA EDILMEZ (onayli 3C follow-up).
    # CTO'nun birebir cumlesi (3F'te sabitlendi); markdown kirilimina
    # duyarsiz kontrol.
    flat = " ".join(desc.replace("*", "").split())
    assert (
        "email delivery parity with browser-triggered actions "
        "is not yet guaranteed" in flat
    )
    post_op = spec["paths"]["/v1/work-logs"]["post"]
    assert "work-logs:write" in _json.dumps(post_op)
    # DELETE / PUT / PATCH public work-log yuzeyinde YOK.
    assert "delete" not in spec["paths"]["/v1/work-logs"]
    assert "delete" not in spec["paths"]["/v1/work-logs/{log_id}"]
    assert "patch" not in spec["paths"]["/v1/work-logs/{log_id}"]


def test_internal_work_log_endpoint_still_protected(public_http):
    """Internal Time Entry yuzeyi API token'iyla ACILMAZ (cookie/JWT
    zinciri degismedi)."""
    r = public_http.get("/api/v1/core/work-logs")
    assert r.status_code in (401, 403)
