"""Uygulama ici bildirim semalari (PM rework P2.2 / C2)."""
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel


class NotificationResponse(BaseModel):
    id: UUID
    kind: str
    work_item_id: UUID
    item_key: Optional[str] = None
    item_title: Optional[str] = None
    item_type: Optional[str] = None
    actor_user_id: Optional[UUID] = None
    #: olaydan kucuk bir ozet (durum from/to, yorum ozeti vb.)
    event_data: dict = {}
    created_at: datetime
    read_at: Optional[datetime] = None


class NotificationListResponse(BaseModel):
    items: List[NotificationResponse]
    unread_count: int


class UnreadCountResponse(BaseModel):
    unread_count: int


class MarkAllReadResponse(BaseModel):
    marked: int
    unread_count: int
