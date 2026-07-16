# =============================================================================
# HERMES - Public API data-access resolution (Stage 2C)
# =============================================================================
# Scope'lar HANGI operasyonun yapilabilecegini soyler; bu servis HANGI
# verinin gorulebilecegini soyler. Iki kontrol her zaman BIRLIKTE calisir.
#
# Fail-closed ilke: hic binding yoksa HIC veri yok. Kurallar:
#   - global     → kisitsiz (scope'lar hala gecerli). Baska binding'le
#                  birlikte OLAMAZ (amendment #5; yazim katmani reddeder,
#                  cozumleme katmani yine de global-önceliksiz davranmaz:
#                  global varsa digerleri yok sayilmaz — yazim engeller).
#   - user       → o kullanicilarin uyesi oldugu satirlar
#   - group      → aktif grup uyelerinin satirlari (cozumleme aninda
#                  uyelik snapshot'i alinir)
#   - customer   → o musterilere ait satirlar
#   - project    → o projelere ait satirlar
#   Kategoriler arasi birlesim: UNION (onayli plan B5). Stage 3 kaynak
#   endpoint'leri gelmeden once intersection'a cevrilebilir —
#   build_filters(combine=...) parametresi bunun icin var.
#
# User-bound client (amendment #6): gorunurluk tabani HER KOSULDA bagli
# kullanicidir — binding'ler ne derse desin user_ids={bound_user_id}
# olarak sabitlenir; digger user binding'leri yok sayilir (yazim katmani
# zaten reddeder; burasi derinlemesine savunmadir).
# =============================================================================

from dataclasses import dataclass, field
from typing import Iterable, Optional
from uuid import UUID

from sqlalchemy import false as sa_false
from sqlalchemy import or_, true as sa_true
from sqlalchemy.orm import Session

from ..models.api_client import ApiClient, ApiClientAccess
from ..models.task import Task
from ..models.user_group import UserGroup, UserGroupMember
from ..models.work_log import WorkLog


@dataclass(frozen=True)
class AccessScope:
    """Cozumlenmis object-level erisim. `user_ids` grup uyeleri DAHIL
    genisletilmis kullanici kumesidir (snapshot)."""

    is_global: bool = False
    user_ids: frozenset = field(default_factory=frozenset)
    customer_ids: frozenset = field(default_factory=frozenset)
    project_ids: frozenset = field(default_factory=frozenset)

    @property
    def is_empty(self) -> bool:
        return not (
            self.is_global
            or self.user_ids
            or self.customer_ids
            or self.project_ids
        )


def _active_group_member_ids(db: Session, group_ids: Iterable[UUID]) -> set:
    ids = list(group_ids)
    if not ids:
        return set()
    rows = (
        db.query(UserGroupMember.user_id)
        .join(UserGroup, UserGroup.id == UserGroupMember.group_id)
        .filter(
            UserGroupMember.group_id.in_(ids),
            UserGroupMember.is_active.is_(True),
            UserGroup.is_active.is_(True),
        )
        .all()
    )
    return {r[0] for r in rows}


def build_scope(
    client: ApiClient,
    bindings: Iterable[ApiClientAccess],
    group_member_ids: Optional[set] = None,
) -> AccessScope:
    """Saf birlestirici (DB'siz test edilebilir). `group_member_ids`,
    binding'lerdeki gruplarin AKTIF uye kumesidir."""
    bindings = list(bindings)

    # User-bound: taban her kosulda bagli kullanici (amendment #6).
    if client.client_type == "user":
        if client.bound_user_id is None:
            return AccessScope()  # tutarsiz kayit → fail closed
        return AccessScope(
            is_global=False,
            user_ids=frozenset({client.bound_user_id}),
            customer_ids=frozenset(
                b.target_id for b in bindings if b.access_type == "customer"
            ),
            project_ids=frozenset(
                b.target_id for b in bindings if b.access_type == "project"
            ),
        )

    if any(b.access_type == "global" for b in bindings):
        return AccessScope(is_global=True)

    users = {b.target_id for b in bindings if b.access_type == "user"}
    users |= group_member_ids or set()
    return AccessScope(
        user_ids=frozenset(users),
        customer_ids=frozenset(
            b.target_id for b in bindings if b.access_type == "customer"
        ),
        project_ids=frozenset(
            b.target_id for b in bindings if b.access_type == "project"
        ),
    )


def resolve_access(db: Session, client: ApiClient) -> AccessScope:
    """Client'in binding'lerini yukler ve AccessScope'a cozumler. Grup
    uyeligi istek aninda snapshot'lanir (uyelik degisirse sonraki istek
    yeni kumeyi gorur)."""
    bindings = (
        db.query(ApiClientAccess)
        .filter(ApiClientAccess.client_id == client.id)
        .all()
    )
    group_ids = [
        b.target_id for b in bindings if b.access_type == "group"
    ]
    members = _active_group_member_ids(db, group_ids)
    return build_scope(client, bindings, members)


# ── Composable SQLAlchemy filtreleri (Stage 3 kaynak endpoint'leri) ─────


def task_filter(scope: AccessScope, combine: str = "union"):
    """Task/Issue/Suggestion satirlari icin WHERE kosulu.
    - empty  → FALSE (fail closed: hic satir donmez)
    - global → TRUE  (kisitsiz)
    - aksi   → kategorilerin UNION'i (onayli plan; `combine="intersect"`
               Stage 3 oncesi karar degisirse tek noktadan cevrilir).
    """
    if scope.is_global:
        return sa_true()
    if scope.is_empty:
        return sa_false()

    parts = []
    if scope.user_ids:
        ids = list(scope.user_ids)
        parts.append(
            or_(
                Task.assignee_user_id.in_(ids),
                Task.assigner_user_id.in_(ids),
            )
        )
    if scope.customer_ids:
        parts.append(Task.customer_id.in_(list(scope.customer_ids)))
    if scope.project_ids:
        parts.append(Task.project_id.in_(list(scope.project_ids)))

    if combine == "intersect":
        cond = parts[0]
        for p in parts[1:]:
            cond = cond & p
        return cond
    return or_(*parts)


def work_log_filter(scope: AccessScope, combine: str = "union"):
    """WorkLog satirlari icin WHERE kosulu (ayni semantik)."""
    if scope.is_global:
        return sa_true()
    if scope.is_empty:
        return sa_false()

    parts = []
    if scope.user_ids:
        parts.append(WorkLog.user_id.in_(list(scope.user_ids)))
    if scope.customer_ids:
        parts.append(WorkLog.customer_id.in_(list(scope.customer_ids)))
    if scope.project_ids:
        parts.append(WorkLog.project_id.in_(list(scope.project_ids)))

    if combine == "intersect":
        cond = parts[0]
        for p in parts[1:]:
            cond = cond & p
        return cond
    return or_(*parts)


def meeting_filter(scope: AccessScope):
    """Meeting satirlari icin WHERE kosulu. Meetings'in musteri/proje
    iliskisi YOKTUR (katilimci-tabanli):
      - global           → TRUE
      - user/group       → scope.user_ids'ten en az biri katilimci
                           (hermes_user_id eslesmesi — internal
                           _user_can_view_meeting kuralinin scope hali)
      - yalniz customer/ → FALSE (iliskisizlik geregi hic veri)
        project binding
      - bos              → FALSE (fail closed)
    """
    from sqlalchemy import and_, exists

    from ..models.meeting import Meeting, MeetingAttendee

    if scope.is_global:
        return sa_true()
    if not scope.user_ids:
        return sa_false()
    return exists().where(
        and_(
            MeetingAttendee.meeting_id == Meeting.id,
            MeetingAttendee.hermes_user_id.in_(list(scope.user_ids)),
        )
    )
