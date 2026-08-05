"""
=============================================================================
Arsiv API sozlesmesi — archive_state, manuel arsiv, restore, RBAC
=============================================================================
Arsiv yeni bir VERI SIZINTI YUZEYI acmamali: gorunurluk sorgu
seviyesinde uygulanir, gizli kayit ne listede ne sayida ne de hata
zarfinda kendini belli eder.
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
from app.main import app
from app.models.customer import Customer
from app.models.project import Project
from app.models.task import Task
from app.models.work_type import WorkType
from app.models.work_log import WorkLog

ADMIN = uuid.UUID("00000000-0000-4000-8000-00000000e001")
ASSIGNER = uuid.UUID("00000000-0000-4000-8000-00000000e002")
WORKER = uuid.UUID("00000000-0000-4000-8000-00000000e003")
STRANGER = uuid.UUID("00000000-0000-4000-8000-00000000e004")


@pytest.fixture()
def world(pg_session, authz_grants):
    s = pg_session
    s.execute(sa_text(
        "TRUNCATE task_comments, task_activity_events, work_logs, tasks, "
        "task_lifecycle_policy, projects, customers CASCADE"
    ))
    s.commit()
    c = Customer(id=uuid.uuid4(), name="Vakko", is_active=True)
    p = Project(id=uuid.uuid4(), customer_id=c.id, name="ATM", is_active=True)
    wt = WorkType(id=uuid.uuid4(), name="Dev", is_active=True)
    s.add_all([c, p, wt])
    s.commit()

    authz_grants[str(ADMIN)] = [Perm.TASKS_ADMIN, Perm.TASK_PERMISSIONS_MANAGE]
    for uid in (ASSIGNER, WORKER, STRANGER):
        authz_grants[str(uid)] = [Perm.TASKS_ACCESS]
    return {"s": s, "customer": c, "project": p, "work_type": wt}


@pytest.fixture()
def http(world, pg_session):
    app.dependency_overrides[get_db] = lambda: pg_session

    def _as(user_id):
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(
            id=str(user_id), email=f"{user_id}@x.com", full_name="U",
            is_admin=False,
        )
        return TestClient(app, raise_server_exceptions=False)

    yield _as
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_current_user, None)


def _task(world, *, status="completed", assignee=WORKER, batch=None,
          archived=False, closed_days_ago=1, **over):
    s = world["s"]
    closed_at = (
        datetime.now(timezone.utc) - timedelta(days=closed_days_ago)
        if status in ("completed", "rejected") else None
    )
    if status == "completed":
        over.setdefault("completed_at", closed_at)
        over.setdefault("completed_by_user_id", assignee)
    row = Task(
        id=uuid.uuid4(),
        customer_id=world["customer"].id,
        project_id=world["project"].id,
        title="Work item",
        assignee_user_id=assignee,
        assigner_user_id=ASSIGNER,
        scheduled_date=date.today(),
        status=status,
        priority="medium",
        task_type="task",
        assignment_batch_id=batch,
        closed_at=closed_at,
        archived_at=datetime.now(timezone.utc) if archived else None,
        archive_reason="auto_retention" if archived else None,
        **over,
    )
    s.add(row)
    s.commit()
    return row


def _log_time(world, task):
    world["s"].add(WorkLog(
        user_id=task.assignee_user_id,
        customer_id=world["customer"].id,
        project_id=world["project"].id,
        work_type_id=world["work_type"].id,
        date_worked=date.today(),
        duration_hours=1,
        billable_duration_hours=1,
        description="done",
        task_id=task.id,
    ))
    world["s"].commit()


# ── archive_state sozlesmesi ───────────────────────────────────────────


def test_default_list_returns_active_only(world, http):
    _task(world, status="pending")
    _task(world, archived=True)
    res = http(ADMIN).get("/api/v1/core/tasks")
    assert res.status_code == 200
    assert all(r["archived_at"] is None for r in res.json())
    assert len(res.json()) == 1


def test_archive_state_archived_returns_only_archived(world, http):
    _task(world, status="pending")
    _task(world, archived=True)
    res = http(ADMIN).get("/api/v1/core/tasks?archive_state=archived")
    assert res.status_code == 200
    rows = res.json()
    assert len(rows) == 1 and rows[0]["archived_at"] is not None


def test_archive_state_all_returns_both(world, http):
    _task(world, status="pending")
    _task(world, archived=True)
    res = http(ADMIN).get("/api/v1/core/tasks?archive_state=all")
    assert len(res.json()) == 2


def test_invalid_archive_state_is_422(world, http):
    res = http(ADMIN).get("/api/v1/core/tasks?archive_state=weird")
    assert res.status_code == 422


def test_legacy_include_archived_still_works(world, http):
    _task(world, status="pending")
    _task(world, archived=True)
    res = http(ADMIN).get("/api/v1/core/tasks?include_archived=true")
    assert res.status_code == 200
    assert len(res.json()) == 2


def test_non_admin_sees_own_archived_items(world, http):
    mine = _task(world, assignee=WORKER, archived=True)
    _task(world, assignee=STRANGER, archived=True)
    res = http(WORKER).get("/api/v1/core/tasks?archive_state=archived")
    assert res.status_code == 200
    ids = {r["id"] for r in res.json()}
    assert str(mine.id) in ids
    assert len(ids) == 1


def test_non_admin_cannot_see_other_users_archived_items(world, http):
    other = _task(world, assignee=STRANGER, archived=True)
    res = http(WORKER).get("/api/v1/core/tasks?archive_state=archived")
    assert str(other.id) not in {r["id"] for r in res.json()}


def test_archived_count_does_not_leak(world, http):
    for _ in range(4):
        _task(world, assignee=STRANGER, archived=True)
    res = http(WORKER).get("/api/v1/core/tasks?archive_state=archived")
    # Sayidan bile baskasinin kayitlari sizmaz.
    assert res.json() == []


# ── Manuel arsiv ───────────────────────────────────────────────────────


def test_assigner_can_archive_terminal_item(world, http):
    t = _task(world, status="completed")
    _log_time(world, t)
    res = http(ASSIGNER).post(f"/api/v1/core/tasks/{t.id}/archive")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["archive_reason"] == "manual"
    world["s"].expire_all()
    assert world["s"].query(Task).get(t.id).archived_at is not None


def test_plain_assignee_cannot_archive(world, http):
    t = _task(world, status="completed", assignee=WORKER)
    res = http(WORKER).post(f"/api/v1/core/tasks/{t.id}/archive")
    assert res.status_code == 403


def test_active_item_cannot_be_archived(world, http):
    t = _task(world, status="in_progress")
    res = http(ASSIGNER).post(f"/api/v1/core/tasks/{t.id}/archive")
    assert res.status_code == 409


def test_mixed_group_cannot_be_archived(world, http):
    batch = uuid.uuid4()
    a = _task(world, status="completed", batch=batch)
    _task(world, status="pending", batch=batch)
    res = http(ASSIGNER).post(f"/api/v1/core/tasks/{a.id}/archive")
    assert res.status_code == 409


def test_completed_without_log_time_can_still_be_archived(world, http):
    """KULLANICI KARARI (2026-08-06): Log Time arsivin ON KOSULU DEGIL.

    Kilit kalsaydi saatini girmeyen birinin isi Active'te SONSUZA KADAR
    kalir ve hicbir zaman arsivlenmezdi.
    """
    t = _task(world, status="completed")
    res = http(ASSIGNER).post(f"/api/v1/core/tasks/{t.id}/archive")
    assert res.status_code == 200, res.text


def test_completed_with_log_time_can_be_archived(world, http):
    t = _task(world, status="completed")
    _log_time(world, t)
    res = http(ASSIGNER).post(f"/api/v1/core/tasks/{t.id}/archive")
    assert res.status_code == 200, res.text


def test_archiving_one_row_archives_whole_group(world, http):
    batch = uuid.uuid4()
    rows = [_task(world, status="completed", batch=batch) for _ in range(3)]
    for r in rows:
        _log_time(world, r)
    res = http(ASSIGNER).post(f"/api/v1/core/tasks/{rows[0].id}/archive")
    assert res.status_code == 200
    world["s"].expire_all()
    assert all(
        world["s"].query(Task).get(r.id).archived_at is not None for r in rows
    )


def test_archive_is_idempotent(world, http):
    t = _task(world, status="completed")
    _log_time(world, t)
    first = http(ASSIGNER).post(f"/api/v1/core/tasks/{t.id}/archive")
    second = http(ASSIGNER).post(f"/api/v1/core/tasks/{t.id}/archive")
    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["archived_at"] == second.json()["archived_at"]


def test_invisible_item_returns_404_not_403(world, http):
    t = _task(world, assignee=STRANGER, status="rejected")
    res = http(WORKER).post(f"/api/v1/core/tasks/{t.id}/archive")
    # Var olmayan kayitla AYNI zarf — varligi sizmaz.
    assert res.status_code == 404


def test_archive_never_deletes_rows_or_work_logs(world, http):
    t = _task(world, status="completed")
    _log_time(world, t)
    before_tasks = world["s"].query(Task).count()
    before_logs = world["s"].query(WorkLog).count()
    http(ASSIGNER).post(f"/api/v1/core/tasks/{t.id}/archive")
    world["s"].expire_all()
    assert world["s"].query(Task).count() == before_tasks
    assert world["s"].query(WorkLog).count() == before_logs


# ── Restore + reopen ───────────────────────────────────────────────────


def test_restore_reopens_only_selected_assignment(world, http):
    batch = uuid.uuid4()
    a = _task(world, status="completed", batch=batch, archived=True)
    b = _task(world, status="completed", batch=batch, archived=True)
    res = http(ASSIGNER).post(
        f"/api/v1/core/tasks/{a.id}/restore",
        json={"assignment_task_id": str(a.id), "target_status": "in_progress"},
    )
    assert res.status_code == 200, res.text
    world["s"].expire_all()
    assert world["s"].query(Task).get(a.id).status == "in_progress"
    # Secilmeyen sibling DEGISMEDI.
    assert world["s"].query(Task).get(b.id).status == "completed"


def test_restore_clears_archive_for_whole_group(world, http):
    batch = uuid.uuid4()
    a = _task(world, status="completed", batch=batch, archived=True)
    b = _task(world, status="completed", batch=batch, archived=True)
    http(ASSIGNER).post(
        f"/api/v1/core/tasks/{a.id}/restore",
        json={"assignment_task_id": str(a.id), "target_status": "pending"},
    )
    world["s"].expire_all()
    for row in (a, b):
        fresh = world["s"].query(Task).get(row.id)
        assert fresh.archived_at is None
        assert fresh.archive_reason is None
        assert fresh.closed_at is None


def test_restore_requires_assignment_selection(world, http):
    t = _task(world, status="completed", archived=True)
    res = http(ASSIGNER).post(f"/api/v1/core/tasks/{t.id}/restore", json={})
    assert res.status_code == 422


def test_restore_rejects_foreign_assignment(world, http):
    t = _task(world, status="completed", archived=True)
    other = _task(world, status="completed", archived=True)
    res = http(ASSIGNER).post(
        f"/api/v1/core/tasks/{t.id}/restore",
        json={"assignment_task_id": str(other.id), "target_status": "pending"},
    )
    assert res.status_code == 422


def test_restore_rejects_invalid_target_status(world, http):
    t = _task(world, status="completed", archived=True)
    res = http(ASSIGNER).post(
        f"/api/v1/core/tasks/{t.id}/restore",
        json={"assignment_task_id": str(t.id), "target_status": "completed"},
    )
    assert res.status_code == 422


def test_restore_creates_no_work_log(world, http):
    t = _task(world, status="completed", archived=True)
    before = world["s"].query(WorkLog).count()
    http(ASSIGNER).post(
        f"/api/v1/core/tasks/{t.id}/restore",
        json={"assignment_task_id": str(t.id), "target_status": "in_progress"},
    )
    world["s"].expire_all()
    assert world["s"].query(WorkLog).count() == before


def test_restored_item_returns_to_active_list(world, http):
    t = _task(world, status="completed", archived=True)
    http(ASSIGNER).post(
        f"/api/v1/core/tasks/{t.id}/restore",
        json={"assignment_task_id": str(t.id), "target_status": "in_progress"},
    )
    res = http(ADMIN).get("/api/v1/core/tasks")
    assert str(t.id) in {r["id"] for r in res.json()}


# ── Politika API ───────────────────────────────────────────────────────


def test_policy_defaults_to_seven_days(world, http):
    res = http(ADMIN).get("/api/v1/core/admin/lifecycle-policy")
    assert res.status_code == 200, res.text
    assert res.json()["retention_days"] == 7


def test_policy_update_accepts_never(world, http):
    res = http(ADMIN).put(
        "/api/v1/core/admin/lifecycle-policy",
        json={"retention_days": None},
    )
    assert res.status_code == 200, res.text
    assert res.json()["retention_days"] is None
    # "Never" GERCEKTEN kalici — ilk kayitta sessizce 7'ye donmez.
    again = http(ADMIN).get("/api/v1/core/admin/lifecycle-policy")
    assert again.json()["retention_days"] is None


def test_policy_rejects_off_catalogue_value(world, http):
    res = http(ADMIN).put(
        "/api/v1/core/admin/lifecycle-policy",
        json={"retention_days": 5},
    )
    assert res.status_code == 422


def test_policy_requires_management_permission(world, http):
    res = http(WORKER).get("/api/v1/core/admin/lifecycle-policy")
    assert res.status_code == 403
    res = http(WORKER).put(
        "/api/v1/core/admin/lifecycle-policy",
        json={"retention_days": 30},
    )
    assert res.status_code == 403
