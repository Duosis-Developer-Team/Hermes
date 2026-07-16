# =============================================================================
# HERMES core - Public dizin gorunurlugu (Stage 5B-2, onayli algoritma)
# =============================================================================
# ILKE: yetkili kimlik kumesini CORE hesaplar; auth-service yalnizca
# ID → minimal profil cozer. Genis dizin YALNIZCA global binding'de.
#
# Gorunur kullanicilar (global degilse) = UNION:
#   - scope.user_ids (explicit user binding'ler + explicit grup
#     uyeleri + user-bound icin bagli kullanici)
#   - token'a ZATEN gorunur is kayitlarinda gecen kimlikler:
#       task assignee/assigner (task_filter)
#       task activity aktorleri + yorum yazarlari (gorunur task'lar)
#       work-log sahipleri (work_log_filter)
#       meeting attendee hermes_user_id'leri (meeting_filter)
#   - user-bound: bagli kullanicinin AKTIF gruplarinin aktif uyeleri
#     ("erisilebilir gruba iliskin uyeler")
#
# Gorunur gruplar (global degilse) = explicit group binding'leri ∪
# (user-bound: bagli kullanicinin aktif uyesi oldugu aktif gruplar).
# Musteri/proje-only token → grup gorunurlugu YOK (iliskisi yok).
#
# Kapsam disi kimlik == var olmayan kimlik (ayni 404 zarfi) — karar
# router'da; buradaki fonksiyonlar yalnizca kumeler/None (global) doner.
# =============================================================================

from typing import Optional, Set
from uuid import UUID

from sqlalchemy.orm import Session

from ..models.api_client import ApiClient, ApiClientAccess
from ..models.meeting import Meeting, MeetingAttendee
from ..models.task import Task
from ..models.task_activity import TaskActivityEvent
from ..models.task_comment import TaskComment
from ..models.user_group import UserGroup, UserGroupMember
from ..models.work_log import WorkLog
from .api_access_service import (
    AccessScope,
    meeting_filter,
    task_filter,
    work_log_filter,
)


def _bound_user_group_ids(db: Session, bound_user_id: UUID) -> Set[UUID]:
    rows = (
        db.query(UserGroupMember.group_id)
        .join(UserGroup, UserGroup.id == UserGroupMember.group_id)
        .filter(
            UserGroupMember.user_id == bound_user_id,
            UserGroupMember.is_active.is_(True),
            UserGroup.is_active.is_(True),
        )
        .all()
    )
    return {r[0] for r in rows}


def _active_members_of(db: Session, group_ids: Set[UUID]) -> Set[UUID]:
    if not group_ids:
        return set()
    rows = (
        db.query(UserGroupMember.user_id)
        .join(UserGroup, UserGroup.id == UserGroupMember.group_id)
        .filter(
            UserGroupMember.group_id.in_(list(group_ids)),
            UserGroupMember.is_active.is_(True),
            UserGroup.is_active.is_(True),
        )
        .all()
    )
    return {r[0] for r in rows}


def authorized_user_ids(
    db: Session, client: ApiClient, scope: AccessScope
) -> Optional[Set[UUID]]:
    """None → global (genis dizin); aksi halde yetkili kimlik KUMESI.
    Tum turetilmis sorgular ZATEN scope-filtreli oldugundan user-bound
    tavani otomatik uygulanir."""
    if scope.is_global:
        return None

    ids: Set[UUID] = set(scope.user_ids)

    tf = task_filter(scope)
    for a, b in db.query(
        Task.assignee_user_id, Task.assigner_user_id
    ).filter(tf, Task.archived_at.is_(None)):
        ids.add(a)
        ids.add(b)

    visible_task_ids = [
        r[0]
        for r in db.query(Task.id).filter(
            tf, Task.archived_at.is_(None)
        )
    ]
    if visible_task_ids:
        for (actor,) in (
            db.query(TaskActivityEvent.actor_user_id)
            .filter(TaskActivityEvent.task_id.in_(visible_task_ids))
            .distinct()
        ):
            if actor:
                ids.add(actor)
        for (author,) in (
            db.query(TaskComment.author_user_id)
            .filter(
                TaskComment.task_id.in_(visible_task_ids),
                TaskComment.deleted_at.is_(None),
            )
            .distinct()
        ):
            ids.add(author)

    for (owner,) in (
        db.query(WorkLog.user_id).filter(work_log_filter(scope)).distinct()
    ):
        ids.add(owner)

    # meeting_filter Meeting↔attendee arasinda correlated EXISTS icerir;
    # attendee tablosunu da sorgulayinca auto-correlation FROM'u yutar.
    # Once gorunur meeting id'leri, sonra o meeting'lerin katilimcilari.
    visible_meeting_ids = [
        r[0] for r in db.query(Meeting.id).filter(meeting_filter(scope))
    ]
    if visible_meeting_ids:
        for (attendee,) in (
            db.query(MeetingAttendee.hermes_user_id)
            .filter(
                MeetingAttendee.meeting_id.in_(visible_meeting_ids),
                MeetingAttendee.hermes_user_id.isnot(None),
            )
            .distinct()
        ):
            ids.add(attendee)

    if client.client_type == "user" and client.bound_user_id:
        own_groups = _bound_user_group_ids(db, client.bound_user_id)
        ids |= _active_members_of(db, own_groups)

    ids.discard(None)
    return ids


def authorized_group_ids(
    db: Session, client: ApiClient, scope: AccessScope
) -> Optional[Set[UUID]]:
    """None → global; aksi halde gorunur grup id kumesi."""
    if scope.is_global:
        return None
    explicit = {
        r[0]
        for r in db.query(ApiClientAccess.target_id).filter(
            ApiClientAccess.client_id == client.id,
            ApiClientAccess.access_type == "group",
        )
    }
    if client.client_type == "user" and client.bound_user_id:
        explicit |= _bound_user_group_ids(db, client.bound_user_id)
    return explicit


def list_groups_visible(
    db: Session,
    group_ids: Optional[Set[UUID]],
    *,
    q_text: Optional[str],
    fetch_limit: int,
    offset: int,
):
    """Gorunur gruplari (global: tum aktifler) isimle siralar."""
    query = db.query(UserGroup).filter(UserGroup.is_active.is_(True))
    if group_ids is not None:
        if not group_ids:
            return []
        query = query.filter(UserGroup.id.in_(list(group_ids)))
    if q_text:
        from sqlalchemy import func

        query = query.filter(
            func.lower(UserGroup.name).like(f"%{q_text.lower()}%")
        )
    return (
        query.order_by(UserGroup.name.asc())
        .offset(offset)
        .limit(fetch_limit)
        .all()
    )


def get_group_visible(
    db: Session, group_ids: Optional[Set[UUID]], group_id: UUID
):
    if group_ids is not None and group_id not in group_ids:
        return None
    return (
        db.query(UserGroup)
        .filter(UserGroup.id == group_id, UserGroup.is_active.is_(True))
        .first()
    )


def active_member_count(db: Session, group_id: UUID) -> int:
    return (
        db.query(UserGroupMember)
        .filter(
            UserGroupMember.group_id == group_id,
            UserGroupMember.is_active.is_(True),
        )
        .count()
    )
