# =============================================================================
# HERMES - tasks → work_items tasimasi (PM rework P1.1)
# =============================================================================
# TEK SEFERLIK DEGIL, TEKRAR KOSULABILIR: her `assignment_batch_id` grubu
# (ya da batch'siz tek satir) BIR is kalemine + N katilimciya donusur;
# daha once tasinmis gruplar `legacy_task_ids` uzerinden taninir ve
# atlanir. Boylece migration Job'i yeniden kosabilir ve P1.2 cutover'inda
# golge donemde `tasks`a yazilmis yeni satirlar da toplanir.
#
# Kurallar (08-p1-plani §3, 06 §1):
#   - kod: TASK-56 formati AYNEN (item_key); grubun en kucuk numarasi
#     canonical, digerleri work_item_code_aliases'a (A9)
#   - durum: kopyalarin hepsi ayniysa o; degilse In Progress (bugunku
#     frontend aggregate kurali); hepsi cancelled/rejected ise Rejected
#     (herhangi biri rejected) ya da Cancelled
#   - owner: tek kisilik grupta atanan; cok kisilikte NULL (triage)
#   - katilimci: her atanan `assignee` satiri; kendi completed_at /
#     accepted_at / note korunur (06 §2c)
#   - yorum/olay kopyalanir (legacy_* ile tekrar kosulabilir), olaylar
#     sequence alir; work_logs.work_item_id eslenir; routing kopyalanir;
#     project_memberships backfill (assignee + assigner → member)
#   - dogrulama: hicbir kullanicinin gorunen is kumesi DARALMAZ; sayilar
#     tutar. Tutmazsa istisna — transaction geri alinir.
#
# Baglanti: migrator rolu BYPASSRLS'tir; yine de her kiraci icin
# app.tenant_id set edilir (superuser olmayan kosumlarda WITH CHECK).
# =============================================================================

from __future__ import annotations

import uuid
from collections import defaultdict
from typing import Dict, Iterable, List, Optional

from sqlalchemy import text

CODE_PREFIX = {"task": "TASK", "issue": "ISSUE", "suggestion": "SUGGESTION"}

STATE_SEED = (
    # (name, category, position, is_default)
    ("Pending", "todo", 1, True),
    ("In Progress", "in_progress", 2, False),
    ("Completed", "done", 3, False),
    ("Cancelled", "cancelled", 4, False),
    # 14 kayit + canli reject ucu birebir eslensin (02'deki
    # rejected→Pending eslemesi iptal: reddedilmis isi yeniden acardi).
    ("Rejected", "cancelled", 5, False),
)
STATUS_TO_STATE = {
    "pending": "Pending", "in_progress": "In Progress",
    "completed": "Completed", "cancelled": "Cancelled", "rejected": "Rejected",
}
CANCEL_LIKE = {"cancelled", "rejected"}


def set_tenant(conn, tenant_id) -> None:
    conn.execute(
        text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant_id)}
    )


def tenant_ids(conn) -> List[str]:
    rows = conn.execute(text(
        "SELECT tenant_id FROM tenant_registry ORDER BY provisioned_at, tenant_id"
    )).all()
    return [str(r[0]) for r in rows]


# -----------------------------------------------------------------------------
# Durum tohumu
# -----------------------------------------------------------------------------

def seed_states(conn, tenant_id) -> Dict[str, str]:
    """Kiraci basina varsayilan akis; varsa dokunmaz. name → id."""
    for name, category, position, is_default in STATE_SEED:
        conn.execute(text(
            "INSERT INTO workflow_states "
            "(id, tenant_id, name, category, position, is_default, is_active, "
            " created_at, updated_at) "
            "SELECT gen_random_uuid(), CAST(:t AS uuid), :n, :c, :p, :d, true, "
            "       now(), now() "
            "WHERE NOT EXISTS (SELECT 1 FROM workflow_states "
            "                  WHERE tenant_id = CAST(:t AS uuid) AND name = :n)"
        ), {"t": str(tenant_id), "n": name, "c": category, "p": position,
            "d": is_default})
    rows = conn.execute(text(
        "SELECT name, id FROM workflow_states WHERE tenant_id = CAST(:t AS uuid)"
    ), {"t": str(tenant_id)}).all()
    return {name: str(sid) for name, sid in rows}


# -----------------------------------------------------------------------------
# Saf kurallar
# -----------------------------------------------------------------------------

def aggregate_status(statuses: Iterable[str]) -> str:
    """Kopyalarin durumundan is kaleminin durumu (eski status sozlugu)."""
    values = list(statuses)
    if not values:
        return "pending"
    if all(v == values[0] for v in values):
        return values[0]
    if all(v in CANCEL_LIKE for v in values):
        return "rejected" if "rejected" in values else "cancelled"
    return "in_progress"


def code_of(task_type: str, type_number, task_number) -> str:
    prefix = CODE_PREFIX.get(task_type or "task", "TASK")
    number = type_number if type_number is not None else task_number
    return f"{prefix}-{number}"


def group_key(row) -> str:
    return str(row["assignment_batch_id"] or row["id"])


# -----------------------------------------------------------------------------
# Tasima
# -----------------------------------------------------------------------------

_TASK_COLUMNS = (
    "id, task_number, type_number, customer_id, project_id, sub_project_id, "
    "title, description, assignee_user_id, assigner_user_id, scheduled_date, "
    "due_date, estimated_duration_minutes, task_type, priority, status, "
    "assignee_note, completed_at, completed_by_user_id, first_accepted_at, "
    "created_at, updated_at, archived_at, assignment_batch_id, closed_at, "
    "archive_reason, archived_by_user_id"
)


def _load_tasks(conn, tenant_id) -> List[dict]:
    rows = conn.execute(text(
        f"SELECT {_TASK_COLUMNS} FROM tasks WHERE tenant_id = CAST(:t AS uuid) "
        "ORDER BY task_number"
    ), {"t": str(tenant_id)}).mappings().all()
    return [dict(r) for r in rows]


def _migrated_task_ids(conn, tenant_id) -> set:
    rows = conn.execute(text(
        "SELECT unnest(legacy_task_ids) FROM work_items "
        "WHERE tenant_id = CAST(:t AS uuid) AND legacy_task_ids IS NOT NULL"
    ), {"t": str(tenant_id)}).all()
    return {str(r[0]) for r in rows}


def _canonical(rows: List[dict]) -> dict:
    return sorted(
        rows,
        key=lambda r: (
            r["type_number"] is None,
            r["type_number"] if r["type_number"] is not None else r["task_number"],
            r["task_number"],
        ),
    )[0]


def migrate_tenant(conn, tenant_id) -> dict:
    set_tenant(conn, tenant_id)
    states = seed_states(conn, tenant_id)
    tasks = _load_tasks(conn, tenant_id)
    done = _migrated_task_ids(conn, tenant_id)

    groups: Dict[str, List[dict]] = defaultdict(list)
    for row in tasks:
        groups[group_key(row)].append(row)

    report = {
        "tenant_id": str(tenant_id), "tasks": len(tasks), "groups": len(groups),
        "items_created": 0, "participants": 0, "aliases": 0,
        "skipped_existing": 0,
    }
    t = str(tenant_id)

    for key, rows in groups.items():
        if any(str(r["id"]) in done for r in rows):
            report["skipped_existing"] += 1
            continue
        canon = _canonical(rows)
        status = aggregate_status(r["status"] for r in rows)
        state_id = states[STATUS_TO_STATE[status]]
        assignees = []
        seen = set()
        for r in rows:
            uid = str(r["assignee_user_id"])
            if uid in seen:
                continue
            seen.add(uid)
            assignees.append(r)
        owner = str(canon["assignee_user_id"]) if len(assignees) == 1 else None
        all_archived = all(r["archived_at"] is not None for r in rows)
        all_closed = all(r["closed_at"] is not None for r in rows)
        item_id = str(uuid.uuid4())
        legacy_ids = [str(r["id"]) for r in rows]

        conn.execute(text(
            "INSERT INTO work_items (id, tenant_id, project_id, sub_project_id, "
            " item_key, item_number, item_type, title, description, state_id, "
            " priority, reporter_user_id, owner_user_id, estimate_minutes, "
            " start_date, due_date, is_billable, closed_at, archived_at, "
            " archive_reason, archived_by_user_id, legacy_task_ids, "
            " legacy_task_number, created_at, updated_at) "
            "VALUES (CAST(:id AS uuid), CAST(:t AS uuid), CAST(:project AS uuid), "
            " CAST(:sub AS uuid), :key, :number, :type, :title, :descr, "
            " CAST(:state AS uuid), :priority, CAST(:reporter AS uuid), "
            " CAST(:owner AS uuid), :estimate, :start, :due, "
            " COALESCE((SELECT p.is_billable_default FROM projects p "
            "           WHERE p.id = CAST(:project AS uuid)), true), "
            " :closed, :archived, :archive_reason, CAST(:archived_by AS uuid), "
            " CAST(:legacy AS uuid[]), :legacy_number, :created, :updated)"
        ), {
            "id": item_id, "t": t, "project": str(canon["project_id"]),
            "sub": str(canon["sub_project_id"]) if canon["sub_project_id"] else None,
            "key": code_of(canon["task_type"], canon["type_number"], canon["task_number"]),
            "number": canon["type_number"] if canon["type_number"] is not None
                      else canon["task_number"],
            "type": canon["task_type"] or "task",
            "title": canon["title"], "descr": canon["description"],
            "state": state_id, "priority": canon["priority"] or "medium",
            "reporter": str(canon["assigner_user_id"]), "owner": owner,
            "estimate": canon["estimated_duration_minutes"],
            "start": canon["scheduled_date"], "due": canon["due_date"],
            "closed": max((r["closed_at"] for r in rows), default=None) if all_closed else None,
            "archived": max((r["archived_at"] for r in rows), default=None) if all_archived else None,
            "archive_reason": canon["archive_reason"] if all_archived else None,
            "archived_by": str(canon["archived_by_user_id"])
                           if all_archived and canon["archived_by_user_id"] else None,
            "legacy": legacy_ids, "legacy_number": canon["task_number"],
            "created": min(r["created_at"] for r in rows),
            "updated": max(r["updated_at"] for r in rows),
        })
        report["items_created"] += 1

        for r in assignees:
            conn.execute(text(
                "INSERT INTO work_item_participants (id, tenant_id, work_item_id, "
                " user_id, role, accepted_at, completed_at, note, added_by_user_id, "
                " created_at) VALUES (gen_random_uuid(), CAST(:t AS uuid), "
                " CAST(:item AS uuid), CAST(:user AS uuid), 'assignee', :accepted, "
                " :completed, :note, CAST(:added_by AS uuid), :created)"
            ), {
                "t": t, "item": item_id, "user": str(r["assignee_user_id"]),
                "accepted": r["first_accepted_at"],
                "completed": r["completed_at"] if r["status"] == "completed" else None,
                "note": r["assignee_note"],
                "added_by": str(r["assigner_user_id"]), "created": r["created_at"],
            })
            report["participants"] += 1

        # Batch'in canonical disindaki satirlarinda FARKLI bir atayan varsa
        # (gercek veride tek atayan; anomali) o kisi gorunurlugunu
        # kaybetmesin: `watcher` katilimci olur — sahiplik/yetki degil,
        # yalnizca gorme (06 §2.6 "kimse is kaybetmez").
        canon_reporter = str(canon["assigner_user_id"])
        extra_watchers = {
            str(r["assigner_user_id"]) for r in rows
            if str(r["assigner_user_id"]) != canon_reporter
        } - seen
        for uid in sorted(extra_watchers):
            conn.execute(text(
                "INSERT INTO work_item_participants (id, tenant_id, work_item_id, "
                " user_id, role, added_by_user_id, created_at) "
                "VALUES (gen_random_uuid(), CAST(:t AS uuid), CAST(:item AS uuid), "
                " CAST(:user AS uuid), 'watcher', CAST(:added_by AS uuid), now())"
            ), {"t": t, "item": item_id, "user": uid, "added_by": canon_reporter})
            report["participants"] += 1

        for r in rows:
            if r is canon:
                continue
            code = code_of(r["task_type"], r["type_number"], r["task_number"])
            conn.execute(text(
                "INSERT INTO work_item_code_aliases (id, tenant_id, code, "
                " work_item_id, created_at) "
                "SELECT gen_random_uuid(), CAST(:t AS uuid), :code, "
                "       CAST(:item AS uuid), now() "
                "WHERE NOT EXISTS (SELECT 1 FROM work_item_code_aliases a "
                "                  WHERE a.tenant_id = CAST(:t AS uuid) AND a.code = :code)"
            ), {"t": t, "code": code, "item": item_id})
            report["aliases"] += 1

    report.update(_copy_comments(conn, t))
    report.update(_copy_events(conn, t))
    report.update(_link_work_logs(conn, t))
    report.update(_copy_routing(conn, t))
    report.update(_backfill_memberships(conn, t))
    report.update(verify_tenant(conn, tenant_id))
    return report


def _copy_comments(conn, t: str) -> dict:
    res = conn.execute(text(
        "INSERT INTO work_item_comments (id, tenant_id, work_item_id, author_user_id, "
        " body, created_at, updated_at, deleted_at, legacy_comment_id) "
        "SELECT gen_random_uuid(), c.tenant_id, w.id, c.author_user_id, c.body, "
        "       c.created_at, c.updated_at, c.deleted_at, c.id "
        "  FROM task_comments c "
        "  JOIN work_items w ON w.tenant_id = c.tenant_id "
        "                   AND c.task_id = ANY(w.legacy_task_ids) "
        " WHERE c.tenant_id = CAST(:t AS uuid) "
        "   AND NOT EXISTS (SELECT 1 FROM work_item_comments x "
        "                   WHERE x.legacy_comment_id = c.id)"
    ), {"t": t})
    return {"comments_copied": res.rowcount}


def _copy_events(conn, t: str) -> dict:
    res = conn.execute(text(
        "INSERT INTO work_item_events (id, tenant_id, work_item_id, actor_user_id, "
        " event_type, event_data, sequence, created_at, legacy_event_id) "
        "SELECT gen_random_uuid(), e.tenant_id, w.id, e.actor_user_id, e.event_type, "
        "       e.event_data, "
        "       COALESCE((SELECT max(x.sequence) FROM work_item_events x "
        "                  WHERE x.work_item_id = w.id), 0) "
        "       + row_number() OVER (PARTITION BY w.id ORDER BY e.created_at, e.id), "
        "       e.created_at, e.id "
        "  FROM task_activity_events e "
        "  JOIN work_items w ON w.tenant_id = e.tenant_id "
        "                   AND e.task_id = ANY(w.legacy_task_ids) "
        " WHERE e.tenant_id = CAST(:t AS uuid) "
        "   AND NOT EXISTS (SELECT 1 FROM work_item_events x "
        "                   WHERE x.legacy_event_id = e.id)"
    ), {"t": t})
    return {"events_copied": res.rowcount}


def _link_work_logs(conn, t: str) -> dict:
    res = conn.execute(text(
        "UPDATE work_logs wl SET work_item_id = w.id "
        "  FROM work_items w "
        " WHERE wl.tenant_id = CAST(:t AS uuid) AND wl.work_item_id IS NULL "
        "   AND wl.task_id IS NOT NULL AND wl.task_id = ANY(w.legacy_task_ids) "
        "   AND w.tenant_id = wl.tenant_id"
    ), {"t": t})
    return {"work_logs_linked": res.rowcount}


def _copy_routing(conn, t: str) -> dict:
    users = conn.execute(text(
        "INSERT INTO routing_relations (id, tenant_id, assigner_user_id, "
        " assignee_user_id, assignee_group_id, scope, created_at, updated_at) "
        "SELECT gen_random_uuid(), r.tenant_id, r.assigner_user_id, "
        "       r.assignee_user_id, NULL, r.scope, r.created_at, r.updated_at "
        "  FROM task_assignment_relations r "
        " WHERE r.tenant_id = CAST(:t AS uuid) "
        "   AND NOT EXISTS (SELECT 1 FROM routing_relations x "
        "                   WHERE x.tenant_id = r.tenant_id "
        "                     AND x.assigner_user_id = r.assigner_user_id "
        "                     AND x.assignee_user_id = r.assignee_user_id "
        "                     AND x.scope = r.scope)"
    ), {"t": t})
    groups = conn.execute(text(
        "INSERT INTO routing_relations (id, tenant_id, assigner_user_id, "
        " assignee_user_id, assignee_group_id, scope, created_at, updated_at) "
        "SELECT gen_random_uuid(), r.tenant_id, r.assigner_user_id, NULL, "
        "       r.assignee_group_id, r.scope, r.created_at, r.updated_at "
        "  FROM task_assignment_group_relations r "
        " WHERE r.tenant_id = CAST(:t AS uuid) "
        "   AND NOT EXISTS (SELECT 1 FROM routing_relations x "
        "                   WHERE x.tenant_id = r.tenant_id "
        "                     AND x.assigner_user_id = r.assigner_user_id "
        "                     AND x.assignee_group_id = r.assignee_group_id "
        "                     AND x.scope = r.scope)"
    ), {"t": t})
    return {"routing_copied": users.rowcount + groups.rowcount}


def _backfill_memberships(conn, t: str) -> dict:
    """Gecis garantisi (02 §5.2): her task'in atanani ve atayani projeye
    `member` yazilir; zaten uye olan atlanir. Boylece gorunurluk proje
    uyeligine gectiginde kimse is kaybetmez."""
    res = conn.execute(text(
        "INSERT INTO project_memberships (id, tenant_id, project_id, user_id, "
        " member_role, is_active, created_at) "
        "SELECT gen_random_uuid(), CAST(:t AS uuid), x.project_id, x.uid, "
        "       'member', true, now() "
        "  FROM (SELECT DISTINCT project_id, assignee_user_id AS uid FROM tasks "
        "         WHERE tenant_id = CAST(:t AS uuid) "
        "        UNION "
        "        SELECT DISTINCT project_id, assigner_user_id FROM tasks "
        "         WHERE tenant_id = CAST(:t AS uuid)) x "
        " WHERE NOT EXISTS (SELECT 1 FROM project_memberships m "
        "                   WHERE m.tenant_id = CAST(:t AS uuid) "
        "                     AND m.project_id = x.project_id AND m.user_id = x.uid)"
    ), {"t": t})
    return {"memberships_added": res.rowcount}


# -----------------------------------------------------------------------------
# Dogrulama — tutmazsa istisna, transaction geri alinir
# -----------------------------------------------------------------------------

class MigrationInvariantError(RuntimeError):
    pass


def verify_tenant(conn, tenant_id) -> dict:
    t = str(tenant_id)
    tasks = _load_tasks(conn, tenant_id)
    groups: Dict[str, List[dict]] = defaultdict(list)
    for row in tasks:
        groups[group_key(row)].append(row)

    items = conn.execute(text(
        "SELECT id, legacy_task_ids, reporter_user_id, owner_user_id FROM work_items "
        "WHERE tenant_id = CAST(:t AS uuid) AND legacy_task_ids IS NOT NULL"
    ), {"t": t}).all()
    parts = conn.execute(text(
        "SELECT work_item_id, user_id FROM work_item_participants "
        "WHERE tenant_id = CAST(:t AS uuid)"
    ), {"t": t}).all()

    legacy_to_item: Dict[str, str] = {}
    for item_id, legacy, _, _ in items:
        for tid in legacy or []:
            legacy_to_item[str(tid)] = str(item_id)

    missing = [k for k, rows in groups.items()
               if any(str(r["id"]) not in legacy_to_item for r in rows)]
    if missing:
        raise MigrationInvariantError(
            f"{len(missing)} grup work_items'ta yok (orn. {missing[:3]})"
        )
    if len(items) < len(groups):
        raise MigrationInvariantError(
            f"is kalemi sayisi ({len(items)}) grup sayisindan ({len(groups)}) az"
        )

    # Gorunurluk daralmadi: eski (assignee OR assigner) ⊆ yeni
    # (reporter OR owner OR participant).
    old_visible: Dict[str, set] = defaultdict(set)
    for row in tasks:
        item = legacy_to_item[str(row["id"])]
        old_visible[str(row["assignee_user_id"])].add(item)
        old_visible[str(row["assigner_user_id"])].add(item)
    new_visible: Dict[str, set] = defaultdict(set)
    for item_id, _, reporter, owner in items:
        new_visible[str(reporter)].add(str(item_id))
        if owner:
            new_visible[str(owner)].add(str(item_id))
    for item_id, user_id in parts:
        new_visible[str(user_id)].add(str(item_id))
    for user, olds in old_visible.items():
        lost = olds - new_visible.get(user, set())
        if lost:
            raise MigrationInvariantError(
                f"kullanici {user} {len(lost)} isi kaybediyor: {sorted(lost)[:3]}"
            )

    # Yorum/olay/work_log sayilari
    counts = {}
    for name, sql in {
        "task_comments": "SELECT count(*) FROM task_comments WHERE tenant_id = CAST(:t AS uuid)",
        "work_item_comments": "SELECT count(*) FROM work_item_comments WHERE tenant_id = CAST(:t AS uuid) AND legacy_comment_id IS NOT NULL",
        "task_events": "SELECT count(*) FROM task_activity_events WHERE tenant_id = CAST(:t AS uuid)",
        "work_item_events": "SELECT count(*) FROM work_item_events WHERE tenant_id = CAST(:t AS uuid) AND legacy_event_id IS NOT NULL",
        "work_logs_with_task": "SELECT count(*) FROM work_logs WHERE tenant_id = CAST(:t AS uuid) AND task_id IS NOT NULL",
        "work_logs_with_item": "SELECT count(*) FROM work_logs WHERE tenant_id = CAST(:t AS uuid) AND task_id IS NOT NULL AND work_item_id IS NOT NULL",
    }.items():
        counts[name] = conn.execute(text(sql), {"t": t}).scalar() or 0
    if counts["work_item_comments"] != counts["task_comments"]:
        raise MigrationInvariantError(
            f"yorum sayisi tutmuyor: {counts['task_comments']} → {counts['work_item_comments']}"
        )
    if counts["work_item_events"] != counts["task_events"]:
        raise MigrationInvariantError(
            f"olay sayisi tutmuyor: {counts['task_events']} → {counts['work_item_events']}"
        )
    if counts["work_logs_with_item"] != counts["work_logs_with_task"]:
        raise MigrationInvariantError(
            f"work_log bagi tutmuyor: {counts['work_logs_with_task']} → {counts['work_logs_with_item']}"
        )
    return {"verified_groups": len(groups), "verified_users": len(old_visible), **counts}


def migrate_all(conn) -> dict:
    """Tum kiracilar; rapor kiraci basina + toplam."""
    reports = [migrate_tenant(conn, tid) for tid in tenant_ids(conn)]
    total = defaultdict(int)
    for r in reports:
        for k, v in r.items():
            if isinstance(v, int):
                total[k] += v
    return {"tenants": len(reports), "per_tenant": reports, "total": dict(total)}
