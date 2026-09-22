"""
=============================================================================
HERMES - Uygulama ici bildirim uclari (PM rework P2.2 / C2)
=============================================================================
  GET  /notifications?unread=1&limit=&offset=   liste + okunmamis sayisi
  GET  /notifications/unread-count               rozet
  POST /notifications/{id}/read                  tek okundu
  POST /notifications/read-all                   tumu okundu

Kullanici YALNIZ kendi bildirimlerini gorur (sorgu user_id ile
sinirli; baskasininki 404). WebSocket yok — istemci mount ve pencere
odaginda ceker (05 C2 kapsam siniri).
=============================================================================
"""
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from shared.auth import CurrentUser, get_current_user

from ..schemas.notification import (
    MarkAllReadResponse, NotificationListResponse, NotificationResponse, UnreadCountResponse,
)
from ..services import notification_service as ns
from ..tenant_db import get_tenant_db

router = APIRouter(prefix="/notifications", tags=["Notifications"])

_SAFE_EVENT_KEYS = ("from", "to", "user_id", "assignee_user_id", "duration_hours", "link_type", "to_key")


def _out(row) -> NotificationResponse:
    item = row.work_item
    ev = row.event
    data = {k: v for k, v in (ev.event_data or {}).items() if k in _SAFE_EVENT_KEYS} if ev else {}
    return NotificationResponse(
        id=row.id, kind=row.kind, work_item_id=row.work_item_id,
        item_key=item.item_key if item else None,
        item_title=item.title if item else None,
        item_type=item.item_type if item else None,
        actor_user_id=ev.actor_user_id if ev else None,
        event_data=data, created_at=row.created_at, read_at=row.read_at,
    )


@router.get("", response_model=NotificationListResponse)
def list_notifications(
    unread: bool = Query(False),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    me = UUID(current_user.id)
    rows = ns.list_for_user(db, me, unread_only=unread, limit=limit, offset=offset)
    return NotificationListResponse(items=[_out(r) for r in rows], unread_count=ns.unread_count(db, me))


@router.get("/unread-count", response_model=UnreadCountResponse)
def unread_count(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    return UnreadCountResponse(unread_count=ns.unread_count(db, UUID(current_user.id)))


@router.post("/read-all", response_model=MarkAllReadResponse)
def read_all(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    me = UUID(current_user.id)
    marked = ns.mark_all_read(db, me)
    return MarkAllReadResponse(marked=marked, unread_count=ns.unread_count(db, me))


@router.post("/{notification_id}/read", response_model=NotificationResponse)
def read_one(
    notification_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    row = ns.mark_read(db, UUID(current_user.id), notification_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found.")
    return _out(row)
