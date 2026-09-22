# =============================================================================
# HERMES - Is kalemi modeli (PM rework P1 / A1, A2, A7, A9)
# =============================================================================
# `tasks` bir NESNE degil, atayan ile atanan arasindaki bir KENARdi
# (assignee/assigner NOT NULL): uc kisiye verilen tek is uc satirdi,
# durum sabit bir enum'du, proje bir etiketti. Bu modul o modelin yerine
# gecer (docs/pm-rework/08-p1-plani.md — dondurulmus sema):
#
#   work_items              is kalemi; projeye aittir, kisiye degil
#   work_item_participants  cok kisili atama = SATIR (kopya degil); kisi
#                           basi tamamlanma damgasi tasir
#   workflow_states         kiracinin durum akisi; sabit enum yerine tablo,
#                           rapor/arsiv/pano KATEGORIden calisir
#   work_item_code_aliases  batch birlesince kaybolan eski kodlar (A9:
#                           /v1/tasks/TASK-57 calismaya devam eder)
#   work_item_links         relates | duplicates | blocks (blocks PASIF:
#                           gorsel + filtre, tarih etkisi YOK)
#   work_item_comments / work_item_events   task_* tablolarinin devami
#   routing_relations       "kim kime is yonlendirebilir" — GORUNURLUK DEGIL
#   saved_views             bes eksenli kontrol panelinin yerine (UI: P3)
#
# Kararlar (06-inceleme §1): tek owner + katilimcilar; alt-proje proje
# agacinda KALIR (sub_project_id durur); kod formati TASK-56 korunur;
# iki seviye kurali SERVISte; is_billable proje varsayilanindan.
#
# Eski `tasks` ailesi F05'e kadar dokunulmadan durur; taşıma
# app/migrations/work_item_migration.py'dedir ve tekrar kosulabilir.
# =============================================================================

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, Column, Date, DateTime, ForeignKey,
    Index, Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import relationship

from ..database import Base
from .mixins import TenantOwnedMixin


def _now():
    return datetime.now(timezone.utc)


ITEM_TYPES = ("task", "issue", "suggestion")
PRIORITIES = ("low", "medium", "high", "urgent")
STATE_CATEGORIES = ("todo", "in_progress", "done", "cancelled")
TERMINAL_CATEGORIES = ("done", "cancelled")
PARTICIPANT_ROLES = ("assignee", "reviewer", "watcher")
LINK_TYPES = ("relates", "duplicates", "blocks")
ORIGIN_TYPES = ("ticket", "meeting", "manual")
ARCHIVE_REASONS = ("auto_retention", "manual", "legacy")

# Kod oneki: mevcut `TASK-56` formati AYNEN (routers/tasks.py _CODE_PREFIX
# ile birebir; tek kaynak olmasi icin oradan da buraya bakilacak).
CODE_PREFIX = {"task": "TASK", "issue": "ISSUE", "suggestion": "SUGGESTION"}


class WorkflowState(TenantOwnedMixin, Base):
    """Kiracinin durum akisi. Panoda sutun, raporda KATEGORI."""

    __tablename__ = "workflow_states"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(80), nullable=False)
    category = Column(String(20), nullable=False)
    position = Column(Integer, nullable=False, default=0)
    # Yeni is bu duruma duser. Kiraci basina TEK true (kismi unique index;
    # enforce fazi tenant_id'yi basina ekler).
    is_default = Column(Boolean, nullable=False, default=False)
    # Pasif durum yeni ise atanamaz; mevcut isler korunur.
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now,
                        nullable=False)

    __table_args__ = (
        UniqueConstraint("name", name="uq_workflow_states_name"),
        CheckConstraint(
            "category IN ('todo','in_progress','done','cancelled')",
            name="chk_workflow_states_category",
        ),
        Index(
            "uq_workflow_states_default", "is_default",
            unique=True, postgresql_where=Column("is_default") == True,  # noqa: E712
        ),
    )


class WorkItem(TenantOwnedMixin, Base):
    """Is kalemi — modulun merkez nesnesi. Bir projeye aittir."""

    __tablename__ = "work_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    # Karar 2: alt-proje proje agacinin seviyesi olarak KALIR.
    sub_project_id = Column(
        UUID(as_uuid=True), ForeignKey("task_sub_projects.id", ondelete="RESTRICT"),
        nullable=True, index=True,
    )
    # Iki seviye: parent'in kendi parent'i olamaz — SERVIS dogrular (karar 6).
    parent_id = Column(
        UUID(as_uuid=True), ForeignKey("work_items.id", ondelete="RESTRICT"),
        nullable=True, index=True,
    )

    # Gorunen kimlik: mevcut format (TASK-56). item_number = eski type_number;
    # yeni isler tenant_counters'tan numara alir (tip basina).
    item_key = Column(String(50), nullable=False)
    item_number = Column(BigInteger, nullable=False)
    item_type = Column(String(20), nullable=False, default="task", index=True)

    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)

    state_id = Column(
        UUID(as_uuid=True), ForeignKey("workflow_states.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    priority = Column(String(20), nullable=False, default="medium", index=True)

    # Isi acan — YETKI KAYNAGI DEGIL (yetki proje rolunden gelir).
    reporter_user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    # Tek sorumlu; NULL = triage kuyrugu.
    owner_user_id = Column(UUID(as_uuid=True), nullable=True, index=True)

    estimate_minutes = Column(Integer, nullable=True)
    start_date = Column(Date, nullable=True)
    due_date = Column(Date, nullable=True, index=True)

    # PARA OMURGASI (karar 3): proje varsayilanindan turer, override izlenir.
    is_billable = Column(Boolean, nullable=False, default=True)
    billable_override_by = Column(UUID(as_uuid=True), nullable=True)
    billable_override_at = Column(DateTime(timezone=True), nullable=True)

    # Talep → is zinciri (A6).
    origin_type = Column(String(20), nullable=True)
    origin_ref_id = Column(UUID(as_uuid=True), nullable=True)

    # Yasam dongusu (task_lifecycle sozlesmesi korunur).
    closed_at = Column(DateTime(timezone=True), nullable=True, index=True)
    archived_at = Column(DateTime(timezone=True), nullable=True, index=True)
    archive_reason = Column(String(20), nullable=True)
    archived_by_user_id = Column(UUID(as_uuid=True), nullable=True)

    # Tasima izi: birlesen kopyalarin eski tasks.id'leri (yorum/olay/work_log
    # eslemesi ve /core/tasks/{eski id} uyumlulugu). Yeni islerde bos.
    legacy_task_ids = Column(ARRAY(UUID(as_uuid=True)), nullable=True)
    legacy_task_number = Column(BigInteger, nullable=True)

    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now,
                        nullable=False)

    project = relationship("Project")
    sub_project = relationship("TaskSubProject")
    state = relationship("WorkflowState")
    participants = relationship(
        "WorkItemParticipant", back_populates="work_item",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint("item_type", "item_number", name="uq_work_items_number"),
        UniqueConstraint("item_key", name="uq_work_items_key"),
        CheckConstraint("estimate_minutes IS NULL OR estimate_minutes > 0",
                        name="chk_work_items_estimate"),
        CheckConstraint("priority IN ('low','medium','high','urgent')",
                        name="chk_work_items_priority"),
        CheckConstraint("item_type IN ('task','issue','suggestion')",
                        name="chk_work_items_type"),
        CheckConstraint(
            "due_date IS NULL OR start_date IS NULL OR due_date >= start_date",
            name="chk_work_items_dates",
        ),
        CheckConstraint(
            "(origin_type IS NULL AND origin_ref_id IS NULL) OR "
            "(origin_type IS NOT NULL AND origin_ref_id IS NOT NULL)",
            name="chk_work_items_origin",
        ),
        CheckConstraint(
            "origin_type IS NULL OR origin_type IN ('ticket','meeting','manual')",
            name="chk_work_items_origin_type",
        ),
        CheckConstraint(
            "(billable_override_by IS NULL) = (billable_override_at IS NULL)",
            name="chk_work_items_billable_override",
        ),
        CheckConstraint(
            "archive_reason IS NULL OR "
            "archive_reason IN ('auto_retention','manual','legacy')",
            name="chk_work_items_archive_reason",
        ),
        Index("idx_work_items_project_state", "project_id", "state_id"),
        Index("idx_work_items_retention", "closed_at", "archived_at"),
    )


class WorkItemParticipant(TenantOwnedMixin, Base):
    """Ise bagli kisiler. Uc kisi = uc satir, TEK is kalemi.

    `completed_at`: kisi basi ilerleme (06 §2c) — batch tasimasinda 7
    grupta statuler karisikti; is kaleminin durumu birlesik, kisinin
    kendi tamamlanma damgasi burada korunur.
    """

    __tablename__ = "work_item_participants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    work_item_id = Column(
        UUID(as_uuid=True), ForeignKey("work_items.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    role = Column(String(20), nullable=False, default="assignee")
    accepted_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    note = Column(Text, nullable=True)
    added_by_user_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)

    work_item = relationship("WorkItem", back_populates="participants")

    __table_args__ = (
        UniqueConstraint("work_item_id", "user_id", "role",
                         name="uq_work_item_participants_member"),
        CheckConstraint("role IN ('assignee','reviewer','watcher')",
                        name="chk_work_item_participants_role"),
        Index("idx_work_item_participants_user_role", "user_id", "role"),
    )


class WorkItemCodeAlias(TenantOwnedMixin, Base):
    """Eski kod → is kalemi. A9'un somut geregi: batch birlesince N-1 kod
    kaybolurdu; dis istemciler (MCP, LogiSlot) o kodlari tutuyor olabilir."""

    __tablename__ = "work_item_code_aliases"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(50), nullable=False)
    work_item_id = Column(
        UUID(as_uuid=True), ForeignKey("work_items.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("code", name="uq_work_item_code_aliases_code"),
    )


class WorkItemLink(TenantOwnedMixin, Base):
    """Isler arasi bag. `blocks` GORSEL + filtre; otomatik tarih/durum
    etkisi YOK (06 §6.1 siniri). Dongu kontrolu serviste."""

    __tablename__ = "work_item_links"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    from_item_id = Column(
        UUID(as_uuid=True), ForeignKey("work_items.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    to_item_id = Column(
        UUID(as_uuid=True), ForeignKey("work_items.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    link_type = Column(String(20), nullable=False)
    created_by_user_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("from_item_id", "to_item_id", "link_type",
                         name="uq_work_item_links_pair"),
        CheckConstraint("from_item_id <> to_item_id", name="chk_work_item_links_self"),
        CheckConstraint("link_type IN ('relates','duplicates','blocks')",
                        name="chk_work_item_links_type"),
    )


class WorkItemComment(TenantOwnedMixin, Base):
    """task_comments'in devami; FK is kalemine. `legacy_comment_id`
    tasimanin tekrar kosulabilmesi icin (kopya bir kez)."""

    __tablename__ = "work_item_comments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    work_item_id = Column(
        UUID(as_uuid=True), ForeignKey("work_items.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    author_user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)
    legacy_comment_id = Column(UUID(as_uuid=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("legacy_comment_id", name="uq_work_item_comments_legacy"),
    )


class WorkItemEvent(TenantOwnedMixin, Base):
    """task_activity_events'in devami + `sequence` (ticketing'in olay/
    outbox disiplinine yakinsama; C1'de outbox baglanir)."""

    __tablename__ = "work_item_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    work_item_id = Column(
        UUID(as_uuid=True), ForeignKey("work_items.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    actor_user_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    event_type = Column(String(64), nullable=False, index=True)
    event_data = Column(JSONB, nullable=True)
    sequence = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)
    legacy_event_id = Column(UUID(as_uuid=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("work_item_id", "sequence", name="uq_work_item_events_sequence"),
        UniqueConstraint("legacy_event_id", name="uq_work_item_events_legacy"),
    )


class RoutingRelation(TenantOwnedMixin, Base):
    """task_assignment_relations + _group_relations'in devami.

    ROLU DEGISTI: gorunurlugun kaynagi degil, yalnizca "kim kime is
    yonlendirebilir" politikasi. `assigner <> assignee` kisiti KALKTI:
    kendine is acmak gecerlidir (B4); politika yalniz BASKASINA atarken
    sorgulanir.
    """

    __tablename__ = "routing_relations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assigner_user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    assignee_user_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    assignee_group_id = Column(
        UUID(as_uuid=True), ForeignKey("user_groups.id", ondelete="RESTRICT"),
        nullable=True, index=True,
    )
    scope = Column(String(20), nullable=False, default="task")
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now,
                        nullable=False)

    __table_args__ = (
        CheckConstraint(
            "(assignee_user_id IS NULL) <> (assignee_group_id IS NULL)",
            name="chk_routing_relations_one_target",
        ),
        CheckConstraint("scope IN ('task','issue')", name="chk_routing_relations_scope"),
        UniqueConstraint("assigner_user_id", "assignee_user_id", "scope",
                         name="uq_routing_relations_user"),
        UniqueConstraint("assigner_user_id", "assignee_group_id", "scope",
                         name="uq_routing_relations_group"),
    )


class SavedView(TenantOwnedMixin, Base):
    """Kayitli gorunum (filtre + yerlesim). Sema P1'de, UI P3'te (E2)."""

    __tablename__ = "saved_views"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_user_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    name = Column(String(120), nullable=False)
    scope = Column(String(20), nullable=False, default="personal")
    layout = Column(String(20), nullable=False, default="list")
    filter_json = Column(JSONB, nullable=False, default=dict)
    position = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now,
                        nullable=False)

    __table_args__ = (
        CheckConstraint("scope IN ('personal','shared','system')",
                        name="chk_saved_views_scope"),
        CheckConstraint("layout IN ('board','list','timeline','calendar')",
                        name="chk_saved_views_layout"),
    )


# Migration (0010) ve testler bu envanteri kullanir — 0007/0008/0009 deseni.
# Sira onemli: FK'lar ebeveynden sonra gelir.
WORK_ITEM_TABLES = (
    "workflow_states",
    "work_items",
    "work_item_participants",
    "work_item_code_aliases",
    "work_item_links",
    "work_item_comments",
    "work_item_events",
    "routing_relations",
    "saved_views",
)
