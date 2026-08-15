# =============================================================================
# HERMES - Sprint 8 final: assignment_context'in GERCEK cagri zinciri
# =============================================================================
# test_task_notification_emails.py servis fonksiyonunu dogrudan test eder;
# bu dosya ise ROUTER → BackgroundTasks → servis zincirini kilitler:
# template'i dogru cagirmak yetmez, 5 cagri yerinin her biri dogru
# baglami GERCEKTEN gecirmelidir. Ayrica idempotent replay'in bildirimi
# TEKRARLAMADIGI ve update/reassign'in atama e-postasi URETMEDIGI
# (mevcut urun davranisi) burada kanitlanir.
#
# Gercek PG + gercek izin tablolari kullanilir; yalnizca bildirim
# fonksiyonu kaydediciyle degistirilir (dis servis yok, e-posta yok).
# =============================================================================

import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient

from shared.auth import CurrentUser, get_current_user

from app.database import get_db
from app.tenant_db import get_tenant_db
from app.models.customer import Customer
from app.models.project import Project
from app.models.task import (
    TaskAssignmentGroupRelation,
    TaskAssignmentRelation,
)
from app.models.user_group import (
    UserGroup,
    UserGroupMember,
)

from .public_api.test_stage3a_tasks_read import make_api_client

# WS3: CurrentUser artik tenant baglami ZORUNLU tasir.
TEST_TENANT_ID = "00000000-0000-0000-0000-0000000000a1"

BU = uuid.uuid4()   # atayan
AS1 = uuid.uuid4()  # dogrudan atanabilir uye
AS2 = uuid.uuid4()  # dogrudan atanabilir uye (grup DISI — karma senaryo)
M1 = uuid.uuid4()   # grup uyesi
M2 = uuid.uuid4()   # grup uyesi

INTERNAL_TASKS = "/api/v1/core/tasks"
PUBLIC_TASKS = "/api/public/v1/tasks"
PUBLIC_GROUPS = "/api/public/v1/task-groups"


@pytest.fixture()
def world(pg_session, authz_grants):
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
    p1 = Project(id=uuid.uuid4(), customer_id=c1.id, name="ATM", is_active=True)
    g = UserGroup(id=uuid.uuid4(), name="Backend Team", is_active=True)
    s.add_all([c1, p1, g])
    s.commit()

    s.add_all(
        [
            # RBAC cutover: izinler authz_grants fixture'indan (rollerden)
            # gelir; legacy tablolara satir YAZILMAZ — karar kaynagi
            # degiller. Uyelik + hiyerarsi core tablolarinda kalir.
            UserGroupMember(group_id=g.id, user_id=M1, is_active=True),
            UserGroupMember(group_id=g.id, user_id=M2, is_active=True),
            # Hiyerarsi: BU → AS1/AS2/M1/M2 (task scope) + BU → grup.
            TaskAssignmentRelation(
                assigner_user_id=BU, assignee_user_id=AS1, scope="task"
            ),
            TaskAssignmentRelation(
                assigner_user_id=BU, assignee_user_id=AS2, scope="task"
            ),
            TaskAssignmentRelation(
                assigner_user_id=BU, assignee_user_id=M1, scope="task"
            ),
            TaskAssignmentRelation(
                assigner_user_id=BU, assignee_user_id=M2, scope="task"
            ),
            TaskAssignmentGroupRelation(
                assigner_user_id=BU, assignee_group_id=g.id, scope="task"
            ),
        ]
    )
    s.commit()

    OPS = ["tasks.access", "tasks.assign", "issues.access", "issues.assign"]
    authz_grants[str(BU)] = OPS
    authz_grants[str(AS1)] = ["tasks.access", "issues.access"]
    authz_grants[str(AS2)] = ["tasks.access", "issues.access"]
    authz_grants[str(M1)] = ["tasks.access", "issues.access"]
    authz_grants[str(M2)] = ["tasks.access", "issues.access"]
    return {"c1": c1, "p1": p1, "g": g}


@pytest.fixture()
def notif_calls(monkeypatch):
    """Iki router modulundeki bildirim fonksiyonunu kaydediciyle degistirir.
    Zincirin geri kalani (gate sorgusu, BackgroundTasks planlamasi,
    kwargs sozlesmesi) GERCEK kalir."""
    calls = []

    async def rec(**kwargs):
        calls.append(kwargs)

    import app.routers.tasks as internal_tasks
    import app.public_api.routers.tasks_write as public_tasks

    monkeypatch.setattr(internal_tasks, "send_assignment_notifications", rec)
    monkeypatch.setattr(public_tasks, "send_assignment_notifications", rec)
    return calls


@pytest.fixture()
def internal_http(pg_session):
    from app.main import app

    app.dependency_overrides[get_db] = lambda: pg_session
    # Internal router'lar tenant baglamli session kullanir.
    app.dependency_overrides[get_tenant_db] = lambda: pg_session
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id=str(BU), email="assigner@x.com", is_admin=False
    , tenant_id=TEST_TENANT_ID)
    c = TestClient(app, raise_server_exceptions=False)
    yield c
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_tenant_db, None)
    app.dependency_overrides.pop(get_current_user, None)


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


def _base_payload(world, **over):
    d = {
        "title": "Context flow probe",
        "description": "probe",
        "customer_id": str(world["c1"].id),
        "project_id": str(world["p1"].id),
        "scheduled_date": str(date(2026, 8, 10)),
        "priority": "high",
        "task_type": "task",
    }
    d.update(over)
    return d


def _ctx(call):
    return call["assignment_context"]


# ── Internal router (3 cagri yeri) ─────────────────────────────────────


def test_internal_single_create_passes_direct_context(
    world, internal_http, notif_calls
):
    r = internal_http.post(
        INTERNAL_TASKS,
        json=_base_payload(world, assignee_user_id=str(AS1)),
    )
    assert r.status_code == 201, r.text
    assert len(notif_calls) == 1
    ctx = _ctx(notif_calls[0])
    assert ctx["direct_user_ids"] == [str(AS1)]
    assert ctx["group_names"] == []
    assert notif_calls[0]["assigner_user_id"] == str(BU)


def test_internal_group_create_passes_group_name_and_fanout_rows(
    world, internal_http, notif_calls
):
    r = internal_http.post(
        INTERNAL_TASKS + "/group",
        json=_base_payload(world, assignee_group_id=str(world["g"].id)),
    )
    assert r.status_code == 201, r.text
    assert len(notif_calls) == 1
    ctx = _ctx(notif_calls[0])
    assert ctx["direct_user_ids"] == []
    assert ctx["group_names"] == ["Backend Team"]
    # Alici listesi fan-out satirlarinin kendisidir (snapshot kurali):
    got = {t["assignee_user_id"] for t in notif_calls[0]["tasks"]}
    assert got == {str(M1), str(M2)}


def test_internal_bulk_passes_mixed_context(
    world, internal_http, notif_calls
):
    r = internal_http.post(
        INTERNAL_TASKS + "/bulk",
        json=_base_payload(
            world,
            assignee_user_ids=[str(AS2)],
            assignee_group_ids=[str(world["g"].id)],
        ),
    )
    assert r.status_code == 201, r.text
    assert len(notif_calls) == 1
    ctx = _ctx(notif_calls[0])
    assert ctx["direct_user_ids"] == [str(AS2)]
    assert ctx["group_names"] == ["Backend Team"]
    got = {t["assignee_user_id"] for t in notif_calls[0]["tasks"]}
    assert got == {str(AS2), str(M1), str(M2)}


def test_internal_update_reassign_sends_no_assignment_email(
    world, internal_http, notif_calls
):
    """Mevcut urun kurali: update/reassign atama e-postasi URETMEZ
    (yalnizca status bildirimleri var). Sprint 8 bunu DEGISTIRMEDI."""
    r = internal_http.post(
        INTERNAL_TASKS,
        json=_base_payload(world, assignee_user_id=str(AS1)),
    )
    assert r.status_code == 201
    task_id = r.json()["id"]
    notif_calls.clear()

    r2 = internal_http.put(
        f"{INTERNAL_TASKS}/{task_id}",
        json={"assignee_user_id": str(AS2)},
    )
    assert r2.status_code == 200, r2.text
    assert notif_calls == []


# ── Public router (2 cagri yeri) ───────────────────────────────────────


def _bound_headers(pg_session):
    return make_api_client(
        pg_session,
        f"ub-{uuid.uuid4().hex[:6]}",
        [("user", BU)],
        client_type="user",
        bound_user_id=BU,
        scopes=["tasks:read", "tasks:write"],
    )


def test_public_single_create_passes_direct_context(
    world, public_http, pg_session, notif_calls
):
    h = _bound_headers(pg_session)
    r = public_http.post(
        PUBLIC_TASKS, headers=h,
        json=_base_payload(world, assignee_user_id=str(AS1)),
    )
    assert r.status_code == 201, r.text
    assert len(notif_calls) == 1
    ctx = _ctx(notif_calls[0])
    assert ctx["direct_user_ids"] == [str(AS1)]
    assert ctx["group_names"] == []


def test_public_group_create_passes_group_context(
    world, public_http, pg_session, notif_calls
):
    h = _bound_headers(pg_session)
    r = public_http.post(
        PUBLIC_GROUPS, headers=h,
        json=_base_payload(world, assignee_group_id=str(world["g"].id)),
    )
    assert r.status_code == 201, r.text
    assert len(notif_calls) == 1
    ctx = _ctx(notif_calls[0])
    assert ctx["direct_user_ids"] == []
    assert ctx["group_names"] == ["Backend Team"]


def test_public_idempotent_replay_does_not_resend(
    world, public_http, pg_session, notif_calls
):
    """Ayni Idempotency-Key ile tekrar: handler yeniden KOSMAZ →
    bildirim de tekrarlanmaz (retry duplicate mail uretmez)."""
    h = _bound_headers(pg_session)
    h = {**h, "Idempotency-Key": "sprint8-ctx-replay-1"}
    body = _base_payload(world, assignee_user_id=str(AS1))

    r1 = public_http.post(PUBLIC_TASKS, headers=h, json=body)
    assert r1.status_code == 201, r1.text
    r2 = public_http.post(PUBLIC_TASKS, headers=h, json=body)
    assert r2.status_code == 201
    assert r2.headers.get("Idempotency-Replayed") == "true"

    assert len(notif_calls) == 1
