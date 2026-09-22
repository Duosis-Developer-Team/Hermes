"""
=============================================================================
PM rework P1.1 — tasks → work_items tasimasi
=============================================================================
Kilitlenen sozlesmeler (08-p1-plani §3, 06 §1–2):
  1. Her batch → TEK is kalemi + N katilimci; batch'siz → tek.
  2. Kisi basi ilerleme KAYBOLMAZ: tamamlayan katilimcinin completed_at'i
     durur; is kaleminin durumu bugunku aggregate kurali (hepsi ayniysa o,
     degilse In Progress; hepsi cancelled/rejected ise Rejected/Cancelled).
  3. Kodlar korunur: grubun en kucuk numarasi canonical, digerleri alias.
  4. rejected → Rejected (cancelled kategorisi) — Pending DEGIL.
  5. Yorum/olay kopyalanir (olay sequence alir), work_log bagi eslenir,
     routing kopyalanir, proje uyeligi backfill edilir.
  6. Hicbir kullanicinin gorunen is kumesi DARALMAZ (verify).
  7. Tekrar kosmak hicbir seyi cift yazmaz (idempotent).
=============================================================================
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text as sa_text

from app.migrations import work_item_migration as mig
from app.models.customer import Customer
from app.models.project import Project
from app.models.task import Task, TaskAssignmentRelation
from app.models.task_activity import TaskActivityEvent
from app.models.task_comment import TaskComment
from app.models.work_log import WorkLog
from app.models.work_type import WorkType

TEST_TENANT_ID = "00000000-0000-0000-0000-0000000000a1"
R = uuid.UUID("00000000-0000-4000-8000-0000000000e1")    # assigner / reporter
U1 = uuid.UUID("00000000-0000-4000-8000-0000000000e2")
U2 = uuid.UUID("00000000-0000-4000-8000-0000000000e3")
U3 = uuid.UUID("00000000-0000-4000-8000-0000000000e4")
NOW = datetime(2026, 9, 1, 10, 0, tzinfo=timezone.utc)


# -----------------------------------------------------------------------------
# Saf kurallar
# -----------------------------------------------------------------------------

def test_aggregate_status_rule():
    assert mig.aggregate_status(["pending"]) == "pending"
    assert mig.aggregate_status(["completed", "completed"]) == "completed"
    assert mig.aggregate_status(["completed", "pending", "in_progress"]) == "in_progress"
    assert mig.aggregate_status(["cancelled", "rejected"]) == "rejected"
    assert mig.aggregate_status(["cancelled", "cancelled"]) == "cancelled"
    assert mig.aggregate_status([]) == "pending"


def test_code_format_matches_serializer():
    assert mig.code_of("task", 56, 9) == "TASK-56"
    assert mig.code_of("issue", 3, 100) == "ISSUE-3"
    assert mig.code_of("suggestion", None, 7) == "SUGGESTION-7"


# -----------------------------------------------------------------------------
# Veritabani
# -----------------------------------------------------------------------------

@pytest.fixture()
def world(pg_session):
    s = pg_session
    s.execute(sa_text(
        "TRUNCATE work_item_events, work_item_comments, work_item_code_aliases, "
        "work_item_participants, work_item_links, work_items, workflow_states, "
        "routing_relations, project_memberships, task_comments, "
        "task_activity_events, work_logs, tasks, task_assignment_relations, "
        "task_assignment_group_relations, projects, customers CASCADE"
    ))
    s.commit()
    c = Customer(id=uuid.uuid4(), name="Vakko", is_active=True)
    p = Project(id=uuid.uuid4(), customer_id=c.id, name="ATM", is_active=True)
    wt = WorkType(id=uuid.uuid4(), name="Development", is_active=True)
    s.add_all([c, p, wt])
    s.commit()
    return {"s": s, "customer": c, "project": p, "work_type": wt}


def _task(world, *, assignee, status="pending", batch=None, type_number,
          task_type="task", **over):
    fields = dict(
        id=uuid.uuid4(), customer_id=world["customer"].id,
        project_id=world["project"].id, title=f"Is {type_number}",
        assignee_user_id=assignee, assigner_user_id=R,
        scheduled_date=NOW.date(), status=status, priority="medium",
        task_type=task_type, assignment_batch_id=batch, type_number=type_number,
        created_at=NOW, updated_at=NOW,
    )
    if status == "completed":
        fields.update(completed_at=NOW, completed_by_user_id=assignee,
                      first_completed_at=NOW, closed_at=NOW)
    fields.update(over)
    row = Task(**fields)
    world["s"].add(row)
    world["s"].flush()
    return row


@pytest.fixture()
def seeded(world):
    s = world["s"]
    # A: batch'siz, pending, U1
    a = _task(world, assignee=U1, type_number=10)
    # B: 3 kisilik batch, KARISIK statu (U1 completed, U2 pending, U3 in_progress)
    b_id = uuid.uuid4()
    b1 = _task(world, assignee=U1, status="completed", batch=b_id, type_number=11,
               assignee_note="bitti")
    b2 = _task(world, assignee=U2, status="pending", batch=b_id, type_number=12)
    b3 = _task(world, assignee=U3, status="in_progress", batch=b_id, type_number=13,
               first_accepted_at=NOW)
    # C: 2 kisilik batch, ikisi de completed + arsivli
    c_id = uuid.uuid4()
    c1 = _task(world, assignee=U1, status="completed", batch=c_id, type_number=14,
               archived_at=NOW, archive_reason="manual", archived_by_user_id=R)
    c2 = _task(world, assignee=U2, status="completed", batch=c_id, type_number=15,
               archived_at=NOW, archive_reason="manual", archived_by_user_id=R)
    # D: rejected, issue tipi
    d = _task(world, assignee=U2, status="rejected", type_number=3, task_type="issue")

    # Yorumlar ve olaylar B'nin kopyalarinda
    s.add_all([
        TaskComment(id=uuid.uuid4(), task_id=b1.id, author_user_id=U1, body="b1 yorum", created_at=NOW),
        TaskComment(id=uuid.uuid4(), task_id=b2.id, author_user_id=U2, body="b2 yorum", created_at=NOW + timedelta(minutes=1)),
        TaskActivityEvent(id=uuid.uuid4(), task_id=b1.id, actor_user_id=R, event_type="task_created", event_data={}, created_at=NOW),
        TaskActivityEvent(id=uuid.uuid4(), task_id=b2.id, actor_user_id=R, event_type="task_created", event_data={}, created_at=NOW + timedelta(seconds=1)),
        TaskActivityEvent(id=uuid.uuid4(), task_id=b1.id, actor_user_id=U1, event_type="task_completed", event_data={}, created_at=NOW + timedelta(minutes=5)),
        TaskActivityEvent(id=uuid.uuid4(), task_id=a.id, actor_user_id=R, event_type="task_created", event_data={}, created_at=NOW),
    ])
    # Work log'lar: A'ya ve B'nin U2 kopyasina bagli
    for task, user in ((a, U1), (b2, U2)):
        s.add(WorkLog(
            user_id=user, customer_id=world["customer"].id,
            project_id=world["project"].id, work_type_id=world["work_type"].id,
            date_worked=NOW.date(), duration_hours=1, billable_duration_hours=1,
            description="is", task_id=task.id,
        ))
    # Routing: R → U1, R → U2 (task)
    s.add_all([
        TaskAssignmentRelation(assigner_user_id=R, assignee_user_id=U1, scope="task"),
        TaskAssignmentRelation(assigner_user_id=R, assignee_user_id=U2, scope="task"),
    ])
    s.commit()
    return {**world, "a": a, "b": (b1, b2, b3), "c": (c1, c2), "d": d, "b_id": b_id, "c_id": c_id}


def _q(s, sql, **params):
    return s.execute(sa_text(sql), params).all()


def test_migration_merges_batches_and_keeps_per_person_progress(seeded):
    s = seeded["s"]
    report = mig.migrate_tenant(s.connection(), TEST_TENANT_ID)
    s.commit()

    assert report["groups"] == 4 and report["items_created"] == 4
    assert report["participants"] == 1 + 3 + 2 + 1
    assert report["aliases"] == 2 + 1

    items = {r[0]: r for r in _q(s,
        "SELECT item_key, item_type, item_number, owner_user_id, reporter_user_id, "
        "       st.name, st.category, w.archived_at, w.closed_at, w.legacy_task_number "
        "  FROM work_items w JOIN workflow_states st ON st.id = w.state_id")}
    assert set(items) == {"TASK-10", "TASK-11", "TASK-14", "ISSUE-3"}

    # A: tek kisilik → owner U1, Pending
    assert items["TASK-10"][3] == U1 and items["TASK-10"][5] == "Pending"
    # B: karisik → In Progress, owner NULL (triage), reporter R
    assert items["TASK-11"][5] == "In Progress" and items["TASK-11"][3] is None
    assert items["TASK-11"][4] == R
    # C: hepsi completed + arsivli → Completed/done, archived_at ve closed_at dolu
    assert items["TASK-14"][5] == "Completed" and items["TASK-14"][6] == "done"
    assert items["TASK-14"][7] is not None and items["TASK-14"][8] is not None
    # D: rejected → Rejected, kategori cancelled (Pending DEGIL)
    assert items["ISSUE-3"][5] == "Rejected" and items["ISSUE-3"][6] == "cancelled"

    # B'nin katilimcilari: U1 tamamlamis (completed_at dolu, notu korunmus), U3 kabul etmis
    parts = {r[0]: r for r in _q(s,
        "SELECT p.user_id, p.completed_at, p.accepted_at, p.note "
        "  FROM work_item_participants p JOIN work_items w ON w.id = p.work_item_id "
        " WHERE w.item_key = 'TASK-11'")}
    assert set(parts) == {U1, U2, U3}
    assert parts[U1][1] is not None and parts[U1][3] == "bitti"
    assert parts[U2][1] is None
    assert parts[U3][2] is not None and parts[U3][1] is None

    # Alias'lar: TASK-12, TASK-13 → TASK-11; TASK-15 → TASK-14
    aliases = dict(_q(s,
        "SELECT a.code, w.item_key FROM work_item_code_aliases a "
        "  JOIN work_items w ON w.id = a.work_item_id"))
    assert aliases == {"TASK-12": "TASK-11", "TASK-13": "TASK-11", "TASK-15": "TASK-14"}

    # Yorumlar tek ise toplandi; olaylar sirali
    assert _q(s, "SELECT count(*) FROM work_item_comments c JOIN work_items w ON w.id=c.work_item_id WHERE w.item_key='TASK-11'")[0][0] == 2
    seqs = [r[0] for r in _q(s,
        "SELECT e.sequence FROM work_item_events e JOIN work_items w ON w.id=e.work_item_id "
        " WHERE w.item_key='TASK-11' ORDER BY e.sequence")]
    assert seqs == [1, 2, 3]

    # work_log baglari
    linked = _q(s, "SELECT w.item_key FROM work_logs wl JOIN work_items w ON w.id = wl.work_item_id ORDER BY 1")
    assert [r[0] for r in linked] == ["TASK-10", "TASK-11"]

    # Routing kopyalandi, kisit yok (kendine atama artik mumkun)
    routed = {r[0] for r in _q(s,
        "SELECT assignee_user_id FROM routing_relations "
        " WHERE assigner_user_id = CAST(:r AS uuid) AND assignee_user_id IS NOT NULL",
        r=str(R))}
    assert routed == {U1, U2}

    # Proje uyeligi: R, U1, U2, U3
    members = {r[0] for r in _q(s, "SELECT user_id FROM project_memberships WHERE member_role='member'")}
    assert members == {R, U1, U2, U3}

    # Dogrulama raporu
    assert report["verified_groups"] == 4
    assert report["work_item_comments"] == report["task_comments"] == 2
    assert report["work_item_events"] == report["task_events"] == 4
    assert report["work_logs_with_item"] == report["work_logs_with_task"] == 2


def test_migration_is_idempotent(seeded):
    s = seeded["s"]
    first = mig.migrate_tenant(s.connection(), TEST_TENANT_ID)
    s.commit()
    second = mig.migrate_tenant(s.connection(), TEST_TENANT_ID)
    s.commit()
    assert first["items_created"] == 4
    assert second["items_created"] == 0 and second["skipped_existing"] == 4
    for key in ("participants", "aliases", "comments_copied", "events_copied",
                "work_logs_linked", "memberships_added", "routing_copied"):
        assert second[key] == 0, key
    assert _q(s, "SELECT count(*) FROM work_items")[0][0] == 4
    assert _q(s, "SELECT count(*) FROM work_item_participants")[0][0] == 7


def test_migration_picks_up_tasks_created_after_first_run(seeded):
    """Golge donem: P1.1 sonrasi eski uclar `tasks`a yazmaya devam eder;
    P1.2 cutover'inda ikinci kosu yalniz yenileri alir."""
    s = seeded["s"]
    mig.migrate_tenant(s.connection(), TEST_TENANT_ID)
    s.commit()
    _task(seeded, assignee=U3, type_number=20)
    s.commit()
    second = mig.migrate_tenant(s.connection(), TEST_TENANT_ID)
    s.commit()
    assert second["items_created"] == 1 and second["skipped_existing"] == 4
    assert _q(s, "SELECT count(*) FROM work_items WHERE item_key='TASK-20'")[0][0] == 1


def test_verify_fails_closed_when_a_group_is_missing(seeded):
    s = seeded["s"]
    mig.migrate_tenant(s.connection(), TEST_TENANT_ID)
    s.commit()
    # Bir is kalemini sil → dogrulama grup eksik demeli
    s.execute(sa_text("DELETE FROM work_items WHERE item_key = 'TASK-10'"))
    s.commit()
    with pytest.raises(mig.MigrationInvariantError):
        mig.verify_tenant(s.connection(), TEST_TENANT_ID)


def test_seed_states_is_idempotent_and_single_default(seeded):
    s = seeded["s"]
    conn = s.connection()
    mig.set_tenant(conn, TEST_TENANT_ID)
    first = mig.seed_states(conn, TEST_TENANT_ID)
    second = mig.seed_states(conn, TEST_TENANT_ID)
    s.commit()
    assert first == second and len(first) == 5
    assert _q(s, "SELECT count(*) FROM workflow_states WHERE is_default")[0][0] == 1
    cats = dict(_q(s, "SELECT name, category FROM workflow_states"))
    assert cats["Rejected"] == "cancelled" and cats["Completed"] == "done"
