"""
=============================================================================
Otomatik arsiv (retention) job'i — sozlesme kilitleri
=============================================================================
Bu job Active havuzu temizler. Yanlis calisirsa hala acik bir isi
gizler ya da hicbir seyi temizlemez; ikisi de sessiz hatalardir.

Kilitlenenler: retention siniri, aktif is dokunulmazligi, grup
butunlugu, idempotency, advisory lock, dry-run, Never politikasi ve
work_logs degismezligi.
=============================================================================
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text as sa_text

from app.models.customer import Customer
from app.models.project import Project
from app.models.task import Task, TaskLifecyclePolicy
from app.models.work_log import WorkLog
from app.models.work_type import WorkType
from app.services import task_lifecycle as lc
from app.services.task_archive_service import run_auto_archive

ASSIGNER = uuid.UUID("00000000-0000-4000-8000-00000000d001")


@pytest.fixture()
def world(pg_session):
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
    return {"s": s, "customer": c, "project": p, "work_type": wt}


def _task(world, status, *, closed_days_ago=None, batch=None, **over):
    s = world["s"]
    assignee = over.pop("assignee", None) or uuid.uuid4()
    closed_at = None
    if closed_days_ago is not None:
        closed_at = datetime.now(timezone.utc) - timedelta(days=closed_days_ago)
    if status == "completed":
        over.setdefault("completed_at", closed_at or datetime.now(timezone.utc))
        over.setdefault("completed_by_user_id", assignee)
    row = Task(
        id=uuid.uuid4(),
        customer_id=world["customer"].id,
        project_id=world["project"].id,
        title="Work item",
        assignee_user_id=assignee,
        assigner_user_id=ASSIGNER,
        scheduled_date=datetime.now(timezone.utc).date(),
        status=status,
        priority="medium",
        task_type="task",
        assignment_batch_id=batch,
        closed_at=closed_at,
        **over,
    )
    s.add(row)
    s.commit()
    return row


def _set_policy(world, days):
    s = world["s"]
    row = s.query(TaskLifecyclePolicy).first()
    if row is None:
        row = TaskLifecyclePolicy(singleton=True, retention_days=days)
        s.add(row)
    row.retention_days = days
    s.commit()


# ── Retention siniri ───────────────────────────────────────────────────


def test_closed_six_days_23h_is_not_archived(world):
    _set_policy(world, 7)
    t = _task(world, "completed", closed_days_ago=0)
    t.closed_at = datetime.now(timezone.utc) - timedelta(days=6, hours=23)
    world["s"].commit()

    summary = run_auto_archive(world["s"])
    world["s"].expire_all()
    assert summary["status"] == "success"
    assert summary["logical_items_archived"] == 0
    assert world["s"].query(Task).get(t.id).archived_at is None


def test_closed_seven_days_is_archived(world):
    _set_policy(world, 7)
    t = _task(world, "completed", closed_days_ago=7)
    summary = run_auto_archive(world["s"])
    world["s"].expire_all()
    assert summary["logical_items_archived"] == 1
    row = world["s"].query(Task).get(t.id)
    assert row.archived_at is not None
    assert row.archive_reason == "auto_retention"
    # Otomatik arsiv AKTOR uretmez.
    assert row.archived_by_user_id is None


def test_fifty_day_old_terminal_item_is_archived(world):
    _set_policy(world, 7)
    t = _task(world, "completed", closed_days_ago=50)
    run_auto_archive(world["s"])
    world["s"].expire_all()
    assert world["s"].query(Task).get(t.id).archived_at is not None


@pytest.mark.parametrize("status", ["pending", "in_progress"])
def test_old_open_item_is_never_archived(world, status):
    """Yasindan BAGIMSIZ: acik is Active kalir."""
    _set_policy(world, 7)
    t = _task(world, status)
    # closed_at zaten NULL — yas ne olursa olsun aday degil.
    summary = run_auto_archive(world["s"])
    world["s"].expire_all()
    assert summary["logical_items_archived"] == 0
    assert world["s"].query(Task).get(t.id).archived_at is None


def test_mixed_group_is_not_archived(world):
    _set_policy(world, 7)
    batch = uuid.uuid4()
    a = _task(world, "completed", closed_days_ago=30, batch=batch)
    b = _task(world, "in_progress", batch=batch)
    run_auto_archive(world["s"])
    world["s"].expire_all()
    assert world["s"].query(Task).get(a.id).archived_at is None
    assert world["s"].query(Task).get(b.id).archived_at is None


# ── Grup butunlugu ─────────────────────────────────────────────────────


def test_whole_group_archived_together(world):
    _set_policy(world, 7)
    batch = uuid.uuid4()
    rows = [
        _task(world, "completed", closed_days_ago=10, batch=batch),
        _task(world, "completed", closed_days_ago=10, batch=batch),
        _task(world, "completed", closed_days_ago=10, batch=batch),
    ]
    summary = run_auto_archive(world["s"])
    world["s"].expire_all()
    # UC satir ama TEK logical item.
    assert summary["logical_items_archived"] == 1
    assert summary["assignment_rows_updated"] == 3
    stamps = {world["s"].query(Task).get(r.id).archived_at for r in rows}
    assert len(stamps) == 1 and None not in stamps


def test_batch_limit_never_splits_a_group(world):
    _set_policy(world, 7)
    batch = uuid.uuid4()
    for _ in range(5):
        _task(world, "completed", closed_days_ago=10, batch=batch)
    # Batch 1 olsa bile grup BOLUNMEZ: batch logical anahtar bazindadir.
    summary = run_auto_archive(world["s"], batch_size=1)
    world["s"].expire_all()
    assert summary["logical_items_archived"] == 1
    assert summary["assignment_rows_updated"] == 5
    remaining = (
        world["s"].query(Task)
        .filter(Task.assignment_batch_id == batch, Task.archived_at.is_(None))
        .count()
    )
    assert remaining == 0


# ── Politika ───────────────────────────────────────────────────────────


def test_never_policy_skips_safely(world):
    _set_policy(world, None)
    t = _task(world, "completed", closed_days_ago=999)
    summary = run_auto_archive(world["s"])
    world["s"].expire_all()
    assert summary["ok"] is True
    assert summary["status"] == "disabled"
    assert summary["policy_days"] is None
    assert world["s"].query(Task).get(t.id).archived_at is None


def test_policy_default_is_seven_days(world):
    policy = lc.get_policy(world["s"])
    world["s"].commit()
    assert policy.retention_days == 7


def test_policy_rejects_unsupported_values(world):
    with pytest.raises(ValueError):
        lc.set_policy(world["s"], retention_days=5, actor_user_id=ASSIGNER)


def test_policy_accepts_catalogue_values(world):
    for days in (1, 7, 14, 30, None):
        lc.set_policy(world["s"], retention_days=days, actor_user_id=ASSIGNER)
        world["s"].commit()
        assert lc.get_policy(world["s"]).retention_days == days


def test_policy_is_singleton_at_db_level(world):
    lc.get_policy(world["s"])
    world["s"].commit()
    world["s"].add(TaskLifecyclePolicy(singleton=True, retention_days=30))
    with pytest.raises(Exception):
        world["s"].commit()
    world["s"].rollback()


# ── Dry-run / idempotency / kilit ──────────────────────────────────────


def test_dry_run_changes_nothing(world):
    _set_policy(world, 7)
    t = _task(world, "completed", closed_days_ago=10)
    summary = run_auto_archive(world["s"], dry_run=True)
    world["s"].expire_all()
    assert summary["dry_run"] is True
    assert summary["logical_items_archived"] == 1  # ADAY sayisi
    assert summary["assignment_rows_updated"] == 0
    assert world["s"].query(Task).get(t.id).archived_at is None


def test_second_run_is_idempotent(world):
    _set_policy(world, 7)
    _task(world, "completed", closed_days_ago=10)
    first = run_auto_archive(world["s"])
    second = run_auto_archive(world["s"])
    assert first["logical_items_archived"] == 1
    assert second["logical_items_archived"] == 0


def test_advisory_lock_blocks_concurrent_run(world):
    _set_policy(world, 7)
    _task(world, "completed", closed_days_ago=10)
    engine = world["s"].get_bind()
    other = engine.connect()
    try:
        with other.begin():
            other.execute(
                sa_text("SELECT pg_advisory_lock(:k)"),
                {"k": 947_310_281},
            )
        summary = run_auto_archive(world["s"])
        assert summary["status"] == "skipped_already_running"
        assert summary["ok"] is True
    finally:
        with other.begin():
            other.execute(
                sa_text("SELECT pg_advisory_unlock(:k)"),
                {"k": 947_310_281},
            )
        other.close()


# ── Degismezlikler ─────────────────────────────────────────────────────


def test_no_row_is_ever_deleted(world):
    _set_policy(world, 7)
    _task(world, "completed", closed_days_ago=10)
    _task(world, "pending")
    before = world["s"].query(Task).count()
    run_auto_archive(world["s"])
    world["s"].expire_all()
    assert world["s"].query(Task).count() == before


def test_work_logs_are_untouched(world):
    _set_policy(world, 7)
    t = _task(world, "completed", closed_days_ago=10)
    wl = WorkLog(
        user_id=t.assignee_user_id,
        customer_id=world["customer"].id,
        project_id=world["project"].id,
        work_type_id=world["work_type"].id,
        date_worked=datetime.now(timezone.utc).date(),
        duration_hours=3,
        billable_duration_hours=3,
        description="keep",
        task_id=t.id,
    )
    world["s"].add(wl)
    world["s"].commit()
    before = (wl.id, wl.duration_hours, wl.task_id, wl.description)

    run_auto_archive(world["s"])
    world["s"].expire_all()
    again = world["s"].query(WorkLog).get(before[0])
    assert again is not None
    assert (again.id, again.duration_hours, again.task_id, again.description) == before
    assert world["s"].query(WorkLog).count() == 1


def test_audit_uses_archive_terminology(world):
    _set_policy(world, 7)
    t = _task(world, "completed", closed_days_ago=10)
    run_auto_archive(world["s"])
    world["s"].expire_all()
    kinds = {
        r[0]
        for r in world["s"].execute(sa_text(
            "SELECT event_type FROM task_activity_events WHERE task_id = :i"
        ), {"i": t.id}).fetchall()
    }
    assert "task_archived_auto" in kinds
    # Yeni islemlerde eski 'task_deleted' terminolojisi URETILMEZ.
    assert "task_deleted" not in kinds


def test_summary_has_no_business_data(world):
    _set_policy(world, 7)
    t = _task(world, "completed", closed_days_ago=10)
    t.title = "Gizli baslik"
    world["s"].commit()
    summary = run_auto_archive(world["s"])
    blob = str(summary)
    assert "Gizli baslik" not in blob
    assert "SELECT" not in blob and "UPDATE" not in blob
    for key in ("ok", "status", "dry_run", "policy_days",
                "logical_items_scanned", "logical_items_archived",
                "assignment_rows_updated", "batches", "duration_ms"):
        assert key in summary
