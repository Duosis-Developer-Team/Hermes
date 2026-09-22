"""
=============================================================================
HERMES - Kayitli gorunumler (PM rework P3.5 / E2)
=============================================================================
Kisisel gorunum = sahibine; paylasilan gorunum = is erisimi olan herkese
gorunur. Yazma: sahibi ya da tasks.admin. Paylasim IZNI yok (05: v2) —
is erisimi olan herkes paylasilan gorunum acabilir; bu bilincli bir
basitlik, sinir belgede.
=============================================================================
"""
from __future__ import annotations

from typing import List
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from shared.auth import CurrentUser

from ..models.work_item import SavedView
from ..schemas.saved_view import SavedViewCreate, SavedViewUpdate
from .task_service import is_task_admin


def can_edit(user: CurrentUser, view: SavedView) -> bool:
    return is_task_admin(user) or (view.owner_user_id is not None and str(view.owner_user_id) == user.id)


def list_for_user(db: Session, user: CurrentUser) -> List[SavedView]:
    me = UUID(user.id)
    rows = (
        db.query(SavedView)
        .filter(or_(
            SavedView.scope == "shared",
            (SavedView.scope == "personal") & (SavedView.owner_user_id == me),
        ))
        .all()
    )
    # Kisisel once, sonra paylasilan; grup icinde konum → ad.
    rows.sort(key=lambda v: (0 if v.scope == "personal" else 1, v.position if v.position is not None else 10**6, v.name.lower()))
    return rows


def _load_visible(db: Session, user: CurrentUser, view_id: UUID) -> SavedView:
    view = db.get(SavedView, view_id)
    if view is None or view.scope == "system":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="View not found.")
    if view.scope == "personal" and str(view.owner_user_id) != user.id and not is_task_admin(user):
        # Baskasinin kisisel gorunumu = var olmayan kayit.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="View not found.")
    return view


def create(db: Session, user: CurrentUser, data: SavedViewCreate) -> SavedView:
    view = SavedView(
        owner_user_id=UUID(user.id), name=data.name, scope=data.scope,
        layout=data.layout, filter_json=dict(data.filter_json),
    )
    db.add(view)
    db.commit()
    db.refresh(view)
    return view


def update(db: Session, user: CurrentUser, view_id: UUID, data: SavedViewUpdate) -> SavedView:
    view = _load_visible(db, user, view_id)
    if not can_edit(user, view):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can change this view.")
    if data.name is not None:
        view.name = data.name
    if data.scope is not None:
        view.scope = data.scope
    if data.layout is not None:
        view.layout = data.layout
    if data.filter_json is not None:
        view.filter_json = dict(data.filter_json)
    if data.position is not None:
        view.position = data.position
    db.commit()
    db.refresh(view)
    return view


def delete(db: Session, user: CurrentUser, view_id: UUID) -> None:
    view = _load_visible(db, user, view_id)
    if not can_edit(user, view):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can delete this view.")
    db.delete(view)
    db.commit()


def to_dict(user: CurrentUser, view: SavedView) -> dict:
    return {
        "id": view.id, "name": view.name, "scope": view.scope, "layout": view.layout,
        "filter_json": view.filter_json or {}, "owner_user_id": view.owner_user_id,
        "position": view.position, "can_edit": can_edit(user, view),
        "created_at": view.created_at, "updated_at": view.updated_at,
    }


__all__ = ["list_for_user", "create", "update", "delete", "to_dict", "can_edit"]
