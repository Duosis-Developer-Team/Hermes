# =============================================================================
# HERMES - POST /v1/task-groups testleri (grup fan-out, public yuzey)
# =============================================================================
# Amac: public uc, ic web router'iyle AYNI davranisi gostermeli. Bu yuzden
# testler is kurallarini public yuzeyden dogrular — grup aktifligi,
# can_assign_to_group izni, erisimsiz uyelerin atlanmasi, atayanin haric
# tutulmasi, ortak assignment_batch_id, idempotency.
#
# Mevcut POST /v1/tasks'a DOKUNULMADI; regresyonu asagida ayrica kilitli.
# =============================================================================

import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.models.task import (
    Task,
    TaskAssignmentGroupRelation,
    TaskUserPermission,
)
from app.models.customer import Customer
from app.models.project import Project
from app.models.user_group import (
    TaskGroupMemberOverride,
    TaskGroupPermission,
    UserGroup,
    UserGroupMember,
)

from .test_stage3a_tasks_read import make_api_client

BU = uuid.uuid4()        # bound user = atayan (grubun DA uyesi)
M1 = uuid.uuid4()        # erisimli uye
M2 = uuid.uuid4()        # erisimli uye
M_NOACCESS = uuid.uuid4()  # uye ama task erisimi YOK → atlanir
M_INACTIVE = uuid.uuid4()  # pasif uyelik → hic sayilmaz

WRITE_SCOPES = ["tasks:read", "tasks:write"]

URL = "/api/public/v1/task-groups"


@pytest.fixture()
def world(pg_session):
    s = pg_session
    from sqlalchemy import text as sa_text

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

    c1 = Customer(id=uuid.uuid4(), name="Vakko", is_active=True)
    p1 = Project(
        id=uuid.uuid4(), customer_id=c1.id, name="ATM", is_active=True
    )
    g = UserGroup(id=uuid.uuid4(), name="Backend Team", is_active=True)
    g_inactive = UserGroup(
        id=uuid.uuid4(), name="Retired Team", is_active=False
    )
    g_empty = UserGroup(id=uuid.uuid4(), name="Empty Team", is_active=True)
    s.add_all([c1, p1, g, g_inactive, g_empty])
    # Gruplar ONCE commit edilmeli: asagidaki satirlar user_groups'a FK
    # tasiyor ve tek flush'ta siralama garanti degil.
    s.commit()

    s.add_all(
        [
            # GERCEK IZIN MODELI (task_service._resolve_effective_for_user):
            # bir kullanicinin AKTIF grup uyeligi varsa direkt
            # task_user_permissions satiri YOK SAYILIR — cevabi grup
            # izinleri verir. Bu yuzden asagidaki gruplar icin
            # TaskGroupPermission zorunlu; direkt satirlar yalnizca
            # grupsuz kullanicilar (ornegin 403 testindeki "other") icin
            # anlamlidir.
            TaskGroupPermission(
                group_id=g.id,
                can_access_tasks_default=True,
                can_assign_tasks_default=True,
            ),
            TaskGroupPermission(
                group_id=g_inactive.id,
                can_access_tasks_default=True,
                can_assign_tasks_default=True,
            ),
            TaskGroupPermission(
                group_id=g_empty.id,
                can_access_tasks_default=True,
                can_assign_tasks_default=True,
            ),
            # M_NOACCESS: grup varsayilani ACIK ama uye override'i KAPALI
            # → fan-out onu atlamali.
            TaskGroupMemberOverride(
                group_id=g.id,
                user_id=M_NOACCESS,
                can_access_tasks_override=False,
            ),
            # Atayan → grup eslemesi (task scope). can_assign_to_group.
            TaskAssignmentGroupRelation(
                assigner_user_id=BU, assignee_group_id=g.id, scope="task"
            ),
            TaskAssignmentGroupRelation(
                assigner_user_id=BU,
                assignee_group_id=g_inactive.id,
                scope="task",
            ),
            TaskAssignmentGroupRelation(
                assigner_user_id=BU,
                assignee_group_id=g_empty.id,
                scope="task",
            ),
            # Uyelikler: BU DE grubun uyesi — fan-out onu atlamali.
            UserGroupMember(group_id=g.id, user_id=BU, is_active=True),
            UserGroupMember(group_id=g.id, user_id=M1, is_active=True),
            UserGroupMember(group_id=g.id, user_id=M2, is_active=True),
            UserGroupMember(
                group_id=g.id, user_id=M_NOACCESS, is_active=True
            ),
            UserGroupMember(
                group_id=g.id, user_id=M_INACTIVE, is_active=False
            ),
            UserGroupMember(
                group_id=g_inactive.id, user_id=M1, is_active=True
            ),
        ]
    )
    s.commit()
    return {"c1": c1, "p1": p1, "g": g, "g_inactive": g_inactive,
            "g_empty": g_empty}


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


def bound_client(pg_session, user_id=BU, scopes=None):
    return make_api_client(
        pg_session,
        f"ub-{uuid.uuid4().hex[:6]}",
        [("user", user_id)],
        client_type="user",
        bound_user_id=user_id,
        scopes=WRITE_SCOPES if scopes is None else scopes,
    )


def payload(world, **overrides):
    base = {
        "title": "Rotate staging credentials",
        "description": "Each member rotates their own token.",
        "customer_id": str(world["c1"].id),
        "project_id": str(world["p1"].id),
        "assignee_group_id": str(world["g"].id),
        "scheduled_date": "2026-07-20",
        "priority": "high",
        "task_type": "task",
    }
    base.update(overrides)
    return base


# ── Mutlu yol + fan-out semantigi ──────────────────────────────────────


def test_fan_out_creates_one_task_per_eligible_member(
    world, public_http, pg_session
):
    h = bound_client(pg_session)
    r = public_http.post(URL, headers=h, json=payload(world))
    assert r.status_code == 201, r.text
    body = r.json()

    # Grup 4 AKTIF uyeli (BU, M1, M2, M_NOACCESS; M_INACTIVE pasif).
    # Uygun olan yalnizca M1+M2 → 2 olusur, 2 atlanir (BU + M_NOACCESS).
    assert body["created_count"] == 2
    assert body["skipped_count"] == 2
    assert body["group_id"] == str(world["g"].id)
    assert body["group_name"] == "Backend Team"
    assert len(body["created_tasks"]) == 2

    assignees = {t["assignee_user_id"] for t in body["created_tasks"]}
    assert assignees == {str(M1), str(M2)}


def test_assigner_never_receives_a_fan_out_row(
    world, public_http, pg_session
):
    """BU grubun uyesi olmasina RAGMEN kendine task acilmaz."""
    h = bound_client(pg_session)
    r = public_http.post(URL, headers=h, json=payload(world))
    assert r.status_code == 201
    assignees = {t["assignee_user_id"] for t in r.json()["created_tasks"]}
    assert str(BU) not in assignees
    for t in r.json()["created_tasks"]:
        assert t["assigner_user_id"] == str(BU)


def test_member_without_access_is_skipped(world, public_http, pg_session):
    h = bound_client(pg_session)
    r = public_http.post(URL, headers=h, json=payload(world))
    assignees = {t["assignee_user_id"] for t in r.json()["created_tasks"]}
    assert str(M_NOACCESS) not in assignees


def test_all_rows_share_one_assignment_batch_id(
    world, public_http, pg_session
):
    h = bound_client(pg_session)
    r = public_http.post(URL, headers=h, json=payload(world))
    batch = r.json()["assignment_batch_id"]
    assert batch

    codes = [t["task_code"] for t in r.json()["created_tasks"]]
    rows = (
        pg_session.query(Task)
        .filter(Task.assignment_batch_id == uuid.UUID(batch))
        .all()
    )
    assert len(rows) == len(codes) == 2
    assert len({str(row.assignment_batch_id) for row in rows}) == 1


def test_group_task_honours_dates_priority_and_type(
    world, public_http, pg_session
):
    h = bound_client(pg_session)
    r = public_http.post(
        URL,
        headers=h,
        json=payload(
            world,
            due_date="2026-07-30",
            priority="urgent",
            estimated_duration_minutes=90,
        ),
    )
    assert r.status_code == 201
    for t in r.json()["created_tasks"]:
        assert t["priority"] == "urgent"
        assert t["due_date"] == "2026-07-30"
        assert t["scheduled_date"] == "2026-07-20"
        assert t["task_type"] == "task"


# ── Hata yollari (ic kurallar public zarfa cevriliyor) ─────────────────


def test_unknown_group_is_404(world, public_http, pg_session):
    h = bound_client(pg_session)
    r = public_http.post(
        URL, headers=h, json=payload(world, assignee_group_id=str(uuid.uuid4()))
    )
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "resource_not_found"


def test_inactive_group_rejected(world, public_http, pg_session):
    h = bound_client(pg_session)
    r = public_http.post(
        URL,
        headers=h,
        json=payload(world, assignee_group_id=str(world["g_inactive"].id)),
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] in ("invalid_request", "validation_error")
    assert pg_session.query(Task).count() == 0


def test_group_without_active_members_rejected(
    world, public_http, pg_session
):
    h = bound_client(pg_session)
    r = public_http.post(
        URL,
        headers=h,
        json=payload(world, assignee_group_id=str(world["g_empty"].id)),
    )
    assert r.status_code == 400
    # Hicbir sey olusmadi.
    assert pg_session.query(Task).count() == 0


def test_no_group_assignment_permission_is_403(
    world, public_http, pg_session
):
    """Grup eslemesi OLMAYAN bir atayan → 403, hicbir satir olusmaz."""
    other = uuid.uuid4()
    pg_session.add(
        TaskUserPermission(
            user_id=other, can_access_tasks=True, can_assign_tasks=True
        )
    )
    pg_session.commit()
    h = bound_client(pg_session, user_id=other)
    r = public_http.post(URL, headers=h, json=payload(world))
    assert r.status_code == 403
    assert pg_session.query(Task).count() == 0


def test_service_client_cannot_fan_out(world, public_http, pg_session):
    """Write kurali degismedi: service client, scope'u olsa bile 403."""
    h = make_api_client(
        pg_session, "svc-g", [("global", None)], scopes=WRITE_SCOPES
    )
    r = public_http.post(URL, headers=h, json=payload(world))
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "resource_access_denied"


def test_missing_write_scope_is_403(world, public_http, pg_session):
    h = bound_client(pg_session, scopes=["tasks:read"])
    r = public_http.post(URL, headers=h, json=payload(world))
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "insufficient_scope"


def test_member_list_cannot_be_injected(world, public_http, pg_session):
    """Alicilar gruptan TURETILIR; cagiran uye listesi veremez."""
    h = bound_client(pg_session)
    r = public_http.post(
        URL,
        headers=h,
        json=payload(world, assignee_user_ids=[str(M1)]),
    )
    assert r.status_code == 422


# ── Idempotency ────────────────────────────────────────────────────────


def test_idempotent_replay_does_not_double_fan_out(
    world, public_http, pg_session
):
    h = dict(bound_client(pg_session))
    h["Idempotency-Key"] = "group-fanout-key-001"
    body = payload(world)

    r1 = public_http.post(URL, headers=h, json=body)
    assert r1.status_code == 201
    r2 = public_http.post(URL, headers=h, json=body)
    assert r2.status_code == 201
    assert r2.headers.get("Idempotency-Replayed") == "true"

    assert r1.json() == r2.json()
    # Tek fan-out: 2 satir, tek batch.
    assert pg_session.query(Task).count() == 2


def test_same_key_different_payload_conflicts(
    world, public_http, pg_session
):
    h = dict(bound_client(pg_session))
    h["Idempotency-Key"] = "group-fanout-key-002"
    public_http.post(URL, headers=h, json=payload(world))
    r = public_http.post(
        URL, headers=h, json=payload(world, title="Something else")
    )
    assert r.status_code == 409


# ── Mevcut sozlesme korunuyor ──────────────────────────────────────────


def test_single_task_endpoint_still_rejects_group_field(
    world, public_http, pg_session
):
    """POST /v1/tasks DEGISMEDI: grup alanini kabul etmez."""
    h = bound_client(pg_session)
    r = public_http.post(
        "/api/public/v1/tasks",
        headers=h,
        json={
            "title": "x",
            "description": "y",
            "customer_id": str(world["c1"].id),
            "project_id": str(world["p1"].id),
            "assignee_group_id": str(world["g"].id),
            "scheduled_date": "2026-07-20",
        },
    )
    assert r.status_code == 422


def test_single_task_endpoint_unchanged_happy_path(
    world, public_http, pg_session
):
    """Tekil uc aynen calisiyor (regresyon)."""
    h = bound_client(pg_session)
    r = public_http.post(
        "/api/public/v1/tasks",
        headers=h,
        json={
            "title": "single",
            "description": "still works",
            "customer_id": str(world["c1"].id),
            "project_id": str(world["p1"].id),
            "assignee_user_id": str(M1),
            "scheduled_date": "2026-07-20",
        },
    )
    assert r.status_code == 201
    assert r.json()["assignee_user_id"] == str(M1)
    assert "assignment_batch_id" not in r.json()
