"""
=============================================================================
HERMES - Uygulama ici bildirim (PM rework P2.2 / C2 + C3)
=============================================================================
Olay akisinin ucuncu tuketicisi (03 §4) — ama outbox YOK (09 P2-1):
`record_event` her olayda `fan_out`u AYNI transaction'da cagirir.

Alici kumesi (09 P2-3): olayin aktoru HARIC —
  task_created          → atananlar
  task_updated          → atananlar + takipciler + owner
  task_completed/rejected/restored/status_changed
                        → reporter + owner + atananlar + takipciler
  comment_*             → reporter + owner + atananlar + takipciler
  watcher_added         → eklenen kisi (event_data.user_id)
  log_time_created      → reporter + owner
  digerleri (link_*, watcher_removed, archived, deleted) → bildirim yok

Kural tablosu (task_notification_settings) kanal bazinda uygulanir:
`enabled` + `in_app_enabled` + oncelik + termin; assignment/accept/
complete olay bayraklari kendi olayina baglanir.

Okunmus bildirimler 90 gun sonra `purge_read` (ayri job) ile silinir.
=============================================================================
"""
from datetime import datetime, timedelta, timezone
from typing import Iterable, List, Optional, Set
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ..models.work_item import WorkItem, WorkItemEvent, WorkItemNotification

#: olay tipi → hangi roller alir
_RULES = {
    "task_created": ("assignee",),
    "task_updated": ("assignee", "watcher", "owner"),
    "task_completed": ("reporter", "owner", "assignee", "watcher"),
    "task_rejected": ("reporter", "owner", "assignee", "watcher"),
    "task_restored": ("reporter", "owner", "assignee", "watcher"),
    "task_status_changed": ("reporter", "owner", "assignee", "watcher"),
    "comment_added": ("reporter", "owner", "assignee", "watcher"),
    "comment_updated": ("reporter", "owner", "assignee", "watcher"),
    "watcher_added": ("target",),
    "log_time_created": ("reporter", "owner"),
}

#: kural tablosundaki olay bayraklarina esleme (digerleri bayraga bagli degil)
_SETTINGS_EVENT = {
    "task_created": "assignment",
    "task_completed": "complete",
}

READ_RETENTION_DAYS = 90


def _now() -> datetime:
    return datetime.now(timezone.utc)


def recipients_for(item: WorkItem, event: WorkItemEvent) -> Set[UUID]:
    roles = _RULES.get(event.event_type)
    if not roles:
        return set()
    out: Set[UUID] = set()
    data = event.event_data or {}
    if "target" in roles and data.get("user_id"):
        out.add(UUID(str(data["user_id"])))
    if "reporter" in roles and item.reporter_user_id:
        out.add(item.reporter_user_id)
    if "owner" in roles and item.owner_user_id:
        out.add(item.owner_user_id)
    for p in item.participants:
        if p.role in roles:
            out.add(p.user_id)
    if event.actor_user_id:
        out.discard(event.actor_user_id)
    return out


def _settings_event(event: WorkItemEvent) -> Optional[str]:
    if event.event_type == "task_status_changed":
        data = event.event_data or {}
        if data.get("to") == "in_progress":
            return "accept"
        return None
    return _SETTINGS_EVENT.get(event.event_type)


def fan_out(db: Session, item: WorkItem, event: WorkItemEvent) -> List[WorkItemNotification]:
    """Olay icin alicilara bildirim yazar; kural tablosuna uyar. Hicbir
    zaman istisna yukseltmez (bildirim, isin kendisini kirmaz)."""
    try:
        users = recipients_for(item, event)
        if not users:
            return []
        from .task_service import notification_allowed
        if not notification_allowed(
            db, task_type=item.item_type, priority=item.priority,
            due_date=item.due_date, event=_settings_event(event) or "",
            channel="in_app",
        ):
            return []
        rows = [
            WorkItemNotification(
                user_id=uid, work_item_id=item.id, event_id=event.id, kind=event.event_type,
            )
            for uid in sorted(users, key=str)
        ]
        db.add_all(rows)
        db.flush()
        return rows
    except Exception:  # noqa: BLE001 — bildirim isi asla kirmaz
        return []


def _base(db: Session, user_id: UUID):
    return (
        db.query(WorkItemNotification)
        .options(joinedload(WorkItemNotification.work_item), joinedload(WorkItemNotification.event))
        .filter(WorkItemNotification.user_id == user_id)
    )


def list_for_user(db: Session, user_id: UUID, *, unread_only: bool = False,
                  limit: int = 20, offset: int = 0) -> List[WorkItemNotification]:
    q = _base(db, user_id)
    if unread_only:
        q = q.filter(WorkItemNotification.read_at.is_(None))
    return q.order_by(WorkItemNotification.created_at.desc()).offset(offset).limit(limit).all()


def unread_count(db: Session, user_id: UUID) -> int:
    return int(
        db.query(func.count(WorkItemNotification.id))
        .filter(WorkItemNotification.user_id == user_id, WorkItemNotification.read_at.is_(None))
        .scalar() or 0
    )


def mark_read(db: Session, user_id: UUID, notification_id: UUID) -> Optional[WorkItemNotification]:
    row = _base(db, user_id).filter(WorkItemNotification.id == notification_id).first()
    if row is None:
        return None
    if row.read_at is None:
        row.read_at = _now()
        db.flush()
    return row


def mark_all_read(db: Session, user_id: UUID) -> int:
    n = (
        db.query(WorkItemNotification)
        .filter(WorkItemNotification.user_id == user_id, WorkItemNotification.read_at.is_(None))
        .update({WorkItemNotification.read_at: _now()}, synchronize_session=False)
    )
    db.flush()
    return int(n or 0)


def purge_read(db: Session, *, tenant_id=None, older_than_days: int = READ_RETENTION_DAYS,
               dry_run: bool = False, **_runner_kwargs) -> dict:
    """Okunmus ve eski bildirimleri siler. `tenant_id` (ve `trigger` gibi
    diger anahtarlar) tenant_runner'dan gelir; baglam zaten kurulu, burada
    yalniz rapora yazilir. Canli bulgu (dev, 22.09): `trigger` kabul
    edilmeyince job TypeError ile dusuyordu — runner yolu testle kilitli."""
    cutoff = _now() - timedelta(days=older_than_days)
    q = db.query(WorkItemNotification).filter(
        WorkItemNotification.read_at.isnot(None), WorkItemNotification.read_at < cutoff
    )
    count = q.count()
    if not dry_run and count:
        q.delete(synchronize_session=False)
        db.commit()
    return {"ok": True, "dry_run": dry_run, "deleted": 0 if dry_run else count,
            "candidates": count, "older_than_days": older_than_days,
            "tenant_id": str(tenant_id) if tenant_id else None}
