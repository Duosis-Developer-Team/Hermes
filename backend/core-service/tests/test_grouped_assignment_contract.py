"""
=============================================================================
Coklu atama gruplama SOZLESMESI (Explorer'in dayandigi kanonik iliski)
=============================================================================
Explorer/Board/List, ayni isin kisi basina tekrar kart uretmemesi icin
`tasks.assignment_batch_id` uzerinden gruplar. Bu dosya, o kimligin
GERCEKTEN dogru anda ve dogru sekilde yazildigini kilitler — yani
frontend'in gruplamasi bir tahmine degil, backend sozlesmesine dayanir.

Kilitlenenler:
  - Coklu assignee'li tek create eylemi TEK batch kimligi uretir.
  - Her assignee icin AYRI satir ve AYRI status korunur.
  - Tekil create batch kimligi YAZMAZ (singleton logical item).
  - Tarihsel/tekil kayitlar baslik benzerligiyle gruplanmaz — ayni
    baslikli iki ayri create AYRI batch alir.
  - Bir assignment'in status'u degisince kardesleri DEGISMEZ.
  - Liste ucu batch kimligini serialize eder (frontend okuyabilsin).
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
from app.main import app
from app.models.customer import Customer
from app.models.project import Project
from app.models.task import Task, TaskAssignmentRelation

ASSIGNER = uuid.UUID("00000000-0000-4000-8000-0000000000a1")
U1 = uuid.UUID("00000000-0000-4000-8000-0000000000b1")
U2 = uuid.UUID("00000000-0000-4000-8000-0000000000b2")
U3 = uuid.UUID("00000000-0000-4000-8000-0000000000b3")


@pytest.fixture()
def world(pg_session, authz_grants):
    s = pg_session
    s.execute(
        sa_text(
            "TRUNCATE task_comments, task_activity_events, tasks, "
            "task_assignment_relations, task_assignment_group_relations, "
            "task_user_permissions, task_group_member_overrides, "
            "task_group_permissions, user_group_members, user_groups, "
            "projects, customers CASCADE"
        )
    )
    s.commit()

    customer = Customer(id=uuid.uuid4(), name="Vakko", is_active=True)
    project = Project(
        id=uuid.uuid4(), customer_id=customer.id, name="ATM", is_active=True
    )
    s.add_all([customer, project])
    # Assigner uc kisiye de atayabilir.
    s.add_all(
        [
            TaskAssignmentRelation(
                assigner_user_id=ASSIGNER, assignee_user_id=uid, scope="task"
            )
            for uid in (U1, U2, U3)
        ]
    )
    s.commit()

    authz_grants[str(ASSIGNER)] = [Perm.TASKS_ACCESS, Perm.TASKS_ASSIGN]
    for uid in (U1, U2, U3):
        authz_grants[str(uid)] = [Perm.TASKS_ACCESS]
    return {"customer": customer, "project": project, "session": s}


@pytest.fixture()
def http(world, pg_session):
    app.dependency_overrides[get_db] = lambda: pg_session
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id=str(ASSIGNER), email="assigner@x.com", full_name="Assigner",
        is_admin=False,
    )
    client = TestClient(app, raise_server_exceptions=False)
    yield client
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_current_user, None)


def _payload(world, **over):
    base = {
        "customer_id": str(world["customer"].id),
        "project_id": str(world["project"].id),
        "title": "API rate limit",
        "description": "desc",
        "scheduled_date": date.today().isoformat(),
        "priority": "high",
        "task_type": "task",
    }
    base.update(over)
    return base


# ── Coklu atama TEK grup kimligi uretir ────────────────────────────────


def test_bulk_create_shares_one_batch_id(http, world):
    res = http.post(
        "/api/v1/core/tasks/bulk",
        json=_payload(
            world,
            assignee_user_ids=[str(U1), str(U2), str(U3)],
            assignee_group_ids=[],
        ),
    )
    assert res.status_code == 201, res.text
    rows = res.json()
    assert len(rows) == 3

    batch_ids = {r["assignment_batch_id"] for r in rows}
    assert len(batch_ids) == 1
    assert next(iter(batch_ids)) is not None


def test_bulk_create_keeps_one_row_per_assignee(http, world):
    res = http.post(
        "/api/v1/core/tasks/bulk",
        json=_payload(
            world,
            assignee_user_ids=[str(U1), str(U2), str(U3)],
            assignee_group_ids=[],
        ),
    )
    rows = res.json()
    assert {r["assignee_user_id"] for r in rows} == {str(U1), str(U2), str(U3)}
    # Ortak alanlar her satirda AYNI — logical item tek is demektir.
    assert {r["title"] for r in rows} == {"API rate limit"}
    assert {r["customer_id"] for r in rows} == {str(world["customer"].id)}
    # Her satir kendi status'unu tasir.
    assert {r["status"] for r in rows} == {"pending"}


def test_single_create_has_no_batch_id(http, world):
    res = http.post(
        "/api/v1/core/tasks",
        json=_payload(world, assignee_user_id=str(U1)),
    )
    assert res.status_code == 201, res.text
    # Tekil create singleton logical item'dir — grup kimligi YAZILMAZ.
    assert res.json()["assignment_batch_id"] is None


def test_same_title_twice_is_not_grouped(http, world):
    """Tarihsel kayitlar baslik benzerligiyle BIRLESTIRILMEZ."""
    first = http.post(
        "/api/v1/core/tasks/bulk",
        json=_payload(world, assignee_user_ids=[str(U1)], assignee_group_ids=[]),
    ).json()
    second = http.post(
        "/api/v1/core/tasks/bulk",
        json=_payload(world, assignee_user_ids=[str(U2)], assignee_group_ids=[]),
    ).json()
    assert first[0]["title"] == second[0]["title"]
    assert first[0]["assignment_batch_id"] != second[0]["assignment_batch_id"]


# ── Kismi kayit ve tutarlilik ──────────────────────────────────────────


def test_no_eligible_assignee_creates_nothing(http, world, pg_session):
    """Uygun assignee yoksa 400 doner ve HICBIR satir yazilmaz."""
    stranger = uuid.uuid4()
    before = pg_session.query(Task).count()
    res = http.post(
        "/api/v1/core/tasks/bulk",
        json=_payload(
            world, assignee_user_ids=[str(stranger)], assignee_group_ids=[]
        ),
    )
    assert res.status_code == 400
    assert pg_session.query(Task).count() == before


def test_assigner_is_never_assigned_to_self(http, world):
    res = http.post(
        "/api/v1/core/tasks/bulk",
        json=_payload(
            world,
            assignee_user_ids=[str(ASSIGNER), str(U1)],
            assignee_group_ids=[],
        ),
    )
    assert res.status_code == 201
    assert {r["assignee_user_id"] for r in res.json()} == {str(U1)}


# ── Bireysel status digerlerini ETKILEMEZ ──────────────────────────────


def test_status_change_does_not_touch_siblings(http, world, pg_session):
    rows = http.post(
        "/api/v1/core/tasks/bulk",
        json=_payload(
            world,
            assignee_user_ids=[str(U1), str(U2), str(U3)],
            assignee_group_ids=[],
        ),
    ).json()
    target = next(r for r in rows if r["assignee_user_id"] == str(U1))

    # U1 kendi atamasinin status'unu degistirir.
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id=str(U1), email="u1@x.com", full_name="U1", is_admin=False
    )
    res = http.patch(
        f"/api/v1/core/tasks/{target['id']}/status",
        json={"status": "in_progress"},
    )
    assert res.status_code == 200, res.text

    pg_session.expire_all()
    batch = str(target["assignment_batch_id"])
    siblings = (
        pg_session.query(Task)
        .filter(Task.assignment_batch_id == uuid.UUID(batch))
        .all()
    )
    by_user = {str(t.assignee_user_id): t.status for t in siblings}
    assert by_user[str(U1)] == "in_progress"
    assert by_user[str(U2)] == "pending"
    assert by_user[str(U3)] == "pending"


# ── Liste ucu sozlesmesi ───────────────────────────────────────────────


def test_list_endpoint_exposes_batch_id(http, world):
    http.post(
        "/api/v1/core/tasks/bulk",
        json=_payload(
            world, assignee_user_ids=[str(U1), str(U2)], assignee_group_ids=[]
        ),
    )
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id=str(U1), email="u1@x.com", full_name="U1", is_admin=False
    )
    res = http.get("/api/v1/core/tasks")
    assert res.status_code == 200, res.text
    rows = res.json()
    assert rows, "kullanici kendi atamasini gormeli"
    # Frontend gruplamasi bu alana dayanir; sozlesmeden DUSURULEMEZ.
    assert all("assignment_batch_id" in r for r in rows)
