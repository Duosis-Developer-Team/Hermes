"""
=============================================================================
Work item lifecycle — kapanis (closed_at) ve backfill sozlesmesi
=============================================================================
Bu kurallar otomatik arsivin TEMELIDIR: yanlis bir closed_at, hala acik
bir isi arsive gonderir. Bu yuzden dogrudan domain servisi uzerinden
kilitlenir (HTTP katmanindan bagimsiz).
=============================================================================
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text as sa_text

from app.models.customer import Customer
from app.models.project import Project
from app.models.task import Task
from app.models.work_log import WorkLog
from app.models.work_type import WorkType
from app.services import task_lifecycle as lc

ASSIGNER = uuid.UUID("00000000-0000-4000-8000-00000000c001")


@pytest.fixture()
def world(pg_session):
    s = pg_session
    s.execute(sa_text(
        "TRUNCATE task_comments, task_activity_events, work_logs, tasks, "
        "projects, customers CASCADE"
    ))
    s.commit()
    c = Customer(id=uuid.uuid4(), name="Vakko", is_active=True)
    p = Project(id=uuid.uuid4(), customer_id=c.id, name="ATM", is_active=True)
    # work_logs.work_type_id NOT NULL — urunun gercek kisiti.
    wt = WorkType(id=uuid.uuid4(), name="Development", is_active=True)
    s.add_all([c, p, wt])
    s.commit()
    return {"s": s, "customer": c, "project": p, "work_type": wt}


def _work_log(world, task, **over):
    fields = {
        "user_id": task.assignee_user_id,
        "customer_id": world["customer"].id,
        "project_id": world["project"].id,
        "work_type_id": world["work_type"].id,
        "date_worked": datetime.now(timezone.utc).date(),
        "duration_hours": 1,
        "billable_duration_hours": 1,
        "description": "done",
        "task_id": task.id,
    }
    fields.update(over)
    return WorkLog(**fields)


def _task(world, status="pending", batch=None, assignee=None, **over):
    """Fixture satiri.

    NOT: urunun `chk_tasks_completion_consistency` kisiti completed_at ile
    completed_by_user_id'yi BIRLIKTE ister. Test verisi bu gercek
    invariant'a uyar — kisit gevsetilmez.
    """
    s = world["s"]
    assignee = assignee or uuid.uuid4()
    if over.get("completed_at") is not None:
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
        **over,
    )
    s.add(row)
    s.flush()
    return row


# ── closed_at sozlesmesi ───────────────────────────────────────────────


def test_singleton_completed_gets_closed_at(world):
    t = _task(world, "completed", completed_at=datetime.now(timezone.utc))
    lc.recompute_closure(world["s"], t)
    assert t.closed_at is not None


def test_legacy_rejected_is_not_terminal(world):
    """`rejected` urunden kaldirildi: gecmiste kalmis bir satir terminal
    SAYILMAZ, kapanmaz ve otomatik arsivlenmez — Active havuzda kalir."""
    t = _task(world, "rejected")
    lc.recompute_closure(world["s"], t)
    assert t.closed_at is None


@pytest.mark.parametrize("status", ["pending", "in_progress", "cancelled", "rejected"])
def test_non_terminal_never_closes(world, status):
    t = _task(world, status)
    lc.recompute_closure(world["s"], t)
    assert t.closed_at is None


def test_mixed_group_does_not_close(world):
    batch = uuid.uuid4()
    a = _task(world, "completed", batch, completed_at=datetime.now(timezone.utc))
    b = _task(world, "in_progress", batch)
    world["s"].flush()
    lc.recompute_closure(world["s"], a)
    world["s"].flush()
    assert a.closed_at is None
    assert b.closed_at is None


def test_group_closes_when_last_assignment_turns_terminal(world):
    batch = uuid.uuid4()
    a = _task(world, "completed", batch, completed_at=datetime.now(timezone.utc))
    b = _task(world, "in_progress", batch)
    world["s"].flush()
    lc.recompute_closure(world["s"], a)
    assert a.closed_at is None

    b.status = "completed"
    b.completed_at = datetime.now(timezone.utc)
    b.completed_by_user_id = b.assignee_user_id
    world["s"].flush()
    lc.recompute_closure(world["s"], a)
    world["s"].flush()
    assert a.closed_at is not None
    # Grup ICINDEKI TUM satirlar ayni degeri tasir — parcali grup YOK.
    assert b.closed_at == a.closed_at


def test_terminal_to_terminal_does_not_reset_closed_at(world):
    t = _task(world, "completed", completed_at=datetime.now(timezone.utc))
    lc.recompute_closure(world["s"], t)
    first = t.closed_at
    assert first is not None

    # Ayni terminal durumda kalmak sureyi SIFIRLAMAZ.
    t.description = "x"
    world["s"].flush()
    lc.recompute_closure(world["s"], t)
    assert t.closed_at == first


def test_reopen_clears_closure_and_archive_for_whole_group(world):
    batch = uuid.uuid4()
    a = _task(world, "completed", batch, completed_at=datetime.now(timezone.utc))
    b = _task(world, "completed", batch, completed_at=datetime.now(timezone.utc))
    world["s"].flush()
    lc.recompute_closure(world["s"], a)
    lc.archive_group(world["s"], a, reason=lc.ARCHIVE_REASON_AUTO,
                     actor_user_id=None)
    world["s"].flush()
    assert a.archived_at is not None and b.archived_at is not None

    b.status = "in_progress"
    b.completed_at = None
    b.completed_by_user_id = None
    world["s"].flush()
    lc.recompute_closure(world["s"], b)
    world["s"].flush()
    for row in (a, b):
        assert row.closed_at is None
        assert row.archived_at is None
        assert row.archive_reason is None
        assert row.archived_by_user_id is None


def test_metadata_edit_does_not_reset_retention(world):
    t = _task(world, "completed", completed_at=datetime.now(timezone.utc))
    lc.recompute_closure(world["s"], t)
    first = t.closed_at

    # Aciklama/priority degisikligi updated_at'i degistirir ama
    # retention suresini SIFIRLAMAZ.
    t.description = "changed"
    t.priority = "high"
    world["s"].flush()
    lc.recompute_closure(world["s"], t)
    assert t.closed_at == first


# ── Log Time kilidi ────────────────────────────────────────────────────


def test_completed_without_work_log_does_not_close(world):
    t = _task(world, "completed", completed_at=datetime.now(timezone.utc))
    lc.recompute_closure(world["s"], t, require_work_log=True)
    assert t.closed_at is None


def test_completed_with_work_log_closes(world):
    t = _task(world, "completed", completed_at=datetime.now(timezone.utc))
    world["s"].add(_work_log(world, t))
    world["s"].flush()
    lc.recompute_closure(world["s"], t, require_work_log=True)
    assert t.closed_at is not None


def test_completed_needs_work_log(world):
    """Tek terminal durum completed oldugu icin Log Time kilidi artik
    HER kapanisin on kosuludur."""
    t = _task(world, "completed", completed_at=datetime.now(timezone.utc))
    lc.recompute_closure(world["s"], t, require_work_log=True)
    assert t.closed_at is None


def test_archiving_never_touches_work_logs(world):
    t = _task(world, "completed", completed_at=datetime.now(timezone.utc))
    wl = _work_log(world, t, duration_hours=2, billable_duration_hours=2,
                   description="keep me")
    world["s"].add(wl)
    world["s"].flush()
    before = (wl.duration_hours, wl.description, wl.task_id)

    lc.recompute_closure(world["s"], t)
    lc.archive_group(world["s"], t, reason=lc.ARCHIVE_REASON_MANUAL,
                     actor_user_id=ASSIGNER)
    world["s"].flush()
    world["s"].refresh(wl)
    assert (wl.duration_hours, wl.description, wl.task_id) == before
    assert world["s"].query(WorkLog).count() == 1


# ── Arsiv primitifleri ─────────────────────────────────────────────────


def test_archive_group_stamps_every_sibling(world):
    batch = uuid.uuid4()
    rows = [_task(world, "completed", batch, completed_at=datetime.now(timezone.utc)) for _ in range(3)]
    world["s"].flush()
    lc.archive_group(world["s"], rows[0], reason=lc.ARCHIVE_REASON_AUTO,
                     actor_user_id=None)
    world["s"].flush()
    assert all(r.archived_at is not None for r in rows)
    assert all(r.archive_reason == "auto_retention" for r in rows)
    # Otomatik arsiv actor URETMEZ.
    assert all(r.archived_by_user_id is None for r in rows)


def test_manual_archive_records_actor(world):
    t = _task(world, "completed", completed_at=datetime.now(timezone.utc))
    lc.archive_group(world["s"], t, reason=lc.ARCHIVE_REASON_MANUAL,
                     actor_user_id=ASSIGNER)
    world["s"].flush()
    assert t.archive_reason == "manual"
    assert t.archived_by_user_id == ASSIGNER


def test_archive_is_idempotent(world):
    t = _task(world, "completed", completed_at=datetime.now(timezone.utc))
    lc.archive_group(world["s"], t, reason=lc.ARCHIVE_REASON_AUTO,
                     actor_user_id=None)
    world["s"].flush()
    first = t.archived_at
    lc.archive_group(world["s"], t, reason=lc.ARCHIVE_REASON_MANUAL,
                     actor_user_id=ASSIGNER)
    world["s"].flush()
    # Zaten arsivli satira yeniden damga VURULMAZ.
    assert t.archived_at == first
    assert t.archive_reason == "auto_retention"


def test_restore_clears_archive_but_not_status(world):
    t = _task(world, "completed", completed_at=datetime.now(timezone.utc))
    lc.recompute_closure(world["s"], t)
    lc.archive_group(world["s"], t, reason=lc.ARCHIVE_REASON_MANUAL,
                     actor_user_id=ASSIGNER)
    world["s"].flush()
    lc.restore_group(world["s"], t)
    world["s"].flush()
    assert t.archived_at is None
    assert t.archive_reason is None
    assert t.archived_by_user_id is None
    # Status'a DOKUNULMAZ — hangi assignment'in acilacagi cagiranin
    # ACIK kullanici secimidir.
    assert t.status == "completed"


# ── Logical kimlik ─────────────────────────────────────────────────────


def test_logical_key_prefers_batch(world):
    batch = uuid.uuid4()
    t = _task(world, "pending", batch)
    assert lc.logical_key(t) == f"batch:{batch}"


def test_singleton_key_is_own_id(world):
    t = _task(world, "pending")
    assert lc.logical_key(t) == f"task:{t.id}"


def test_siblings_of_singleton_is_itself_only(world):
    a = _task(world, "pending")
    _task(world, "pending")  # ayni baslik, AYRI is
    world["s"].flush()
    assert [r.id for r in lc.sibling_rows(world["s"], a)] == [a.id]


# ── Tarihsel backfill ──────────────────────────────────────────────────


def test_backfill_fills_terminal_groups_only(world):
    s = world["s"]
    old = datetime.now(timezone.utc) - timedelta(days=50)
    closed = _task(world, "completed", completed_at=old)
    open_one = _task(world, "in_progress")
    s.flush()
    s.execute(sa_text(lc.LIFECYCLE_BACKFILL_SQL))
    s.flush()
    s.refresh(closed)
    s.refresh(open_one)
    assert closed.closed_at is not None
    assert open_one.closed_at is None


def test_backfill_skips_group_with_active_sibling(world):
    s = world["s"]
    batch = uuid.uuid4()
    a = _task(world, "completed", batch,
              completed_at=datetime.now(timezone.utc) - timedelta(days=40))
    b = _task(world, "pending", batch)
    s.flush()
    s.execute(sa_text(lc.LIFECYCLE_BACKFILL_SQL))
    s.flush()
    s.refresh(a)
    s.refresh(b)
    assert a.closed_at is None and b.closed_at is None


def test_backfill_is_idempotent_and_keeps_updated_at(world):
    s = world["s"]
    t = _task(world, "completed",
              completed_at=datetime.now(timezone.utc) - timedelta(days=9))
    s.flush()
    before_updated = t.updated_at

    s.execute(sa_text(lc.LIFECYCLE_BACKFILL_SQL))
    s.flush()
    s.refresh(t)
    first = t.closed_at
    assert first is not None

    s.execute(sa_text(lc.LIFECYCLE_BACKFILL_SQL))
    s.flush()
    s.refresh(t)
    assert t.closed_at == first
    assert t.updated_at == before_updated


def test_backfill_deletes_nothing(world):
    s = world["s"]
    _task(world, "completed", completed_at=datetime.now(timezone.utc))
    _task(world, "pending")
    s.flush()
    before = s.query(Task).count()
    s.execute(sa_text(lc.LIFECYCLE_BACKFILL_SQL))
    s.flush()
    assert s.query(Task).count() == before


def test_backfill_does_not_group_by_similarity(world):
    """Ayni baslikli iki AYRI singleton birlestirilmez."""
    s = world["s"]
    a = _task(world, "completed",
              completed_at=datetime.now(timezone.utc) - timedelta(days=30))
    b = _task(world, "pending")
    s.flush()
    s.execute(sa_text(lc.LIFECYCLE_BACKFILL_SQL))
    s.flush()
    s.refresh(a)
    s.refresh(b)
    # b acik oldugu halde a kapandi → gruplanmadilar.
    assert a.closed_at is not None
    assert b.closed_at is None
