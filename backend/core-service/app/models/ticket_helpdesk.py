# =============================================================================
# HERMES core — Talep yonetimi helpdesk katmani (00-plan §4.2, Dalga B)
# =============================================================================
# Donmus LogiSlot sozlesmesine DOKUNMADAN profesyonel helpdesk yetenekleri:
# SLA, etiket, hazir yanit (makro), kayitli gorunum, takipci, okundu bilgisi
# ve uygulama ici bildirim. Hepsi YENI tablolardir; `ticket_events` olay
# turleri ve outbox'a giden alan seti DEGISMEZ (sozlesme notu).
#
# Tumu tenant-owned: SAGLAYICININ verisinde yasar (talep agi, §4.0) ve RLS
# + FORCE alir (0019; 0007/0016 deseni). Musteri (talep eden) tarafinin
# okundu bilgisi de saglayicidadir — portal istekleri zaten saglayici
# oturumunda calisir; tenant'lar arasi yazma YOKTUR.
# =============================================================================

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from ..database import Base
from .mixins import TenantOwnedMixin


def _now():
    return datetime.now(timezone.utc)


TICKET_HELPDESK_TABLES = (
    "ticket_sla_policies",
    "ticket_sla_clocks",
    "ticket_tags",
    "ticket_tag_links",
    "ticket_macros",
    "ticket_views",
    "ticket_watchers",
    "ticket_reads",
    "ticket_notifications",
)


# =============================================================================
# SLA
# =============================================================================

class TicketSlaPolicy(TenantOwnedMixin, Base):
    """Saglayici basina TEK SLA politikasi (v1).

    `targets_json`: oncelik → {first_response, resolution} DAKIKA (mesai
    dakikasi). `calendar_json`: {timezone, days: {"1": [["09:00","18:00"]],
    ...}, holidays: ["YYYY-MM-DD"]}; bos/None = 7/24.
    """

    __tablename__ = "ticket_sla_policies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(120), nullable=False, default="Default")
    is_active = Column(Boolean, nullable=False, default=True)
    targets_json = Column(JSONB, nullable=False, default=dict,
                          server_default=text("'{}'::jsonb"))
    calendar_json = Column(JSONB, nullable=True)
    updated_by_user_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now,
                        nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", name="uq_ticket_sla_policies_tenant"),
    )


class TicketSlaClock(TenantOwnedMixin, Base):
    """Talep basina SLA saati. Hedefler acilista POLITIKADAN kopyalanir
    (sonradan politika degisse de acik talebin sozu degismez); oncelik
    degisince yeniden hesaplanir."""

    __tablename__ = "ticket_sla_clocks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ticket_id = Column(
        UUID(as_uuid=True), ForeignKey("tickets.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    first_response_target_min = Column(Integer, nullable=True)
    resolution_target_min = Column(Integer, nullable=True)
    first_response_due_at = Column(DateTime(timezone=True), nullable=True)
    first_response_at = Column(DateTime(timezone=True), nullable=True)
    resolution_due_at = Column(DateTime(timezone=True), nullable=True)
    resolution_at = Column(DateTime(timezone=True), nullable=True)
    # "Musteride bekliyor"da cozum saati DURUR; kalan mesai saniyesi saklanir.
    paused_at = Column(DateTime(timezone=True), nullable=True)
    remaining_seconds = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now,
                        nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "ticket_id", name="uq_ticket_sla_clocks_ticket"),
        Index("idx_ticket_sla_clocks_due", "resolution_due_at"),
    )


# =============================================================================
# Etiketler
# =============================================================================

class TicketTag(TenantOwnedMixin, Base):
    __tablename__ = "ticket_tags"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(40), nullable=False)
    color = Column(String(16), nullable=False, default="blue")
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_ticket_tags_name"),
    )


class TicketTagLink(TenantOwnedMixin, Base):
    __tablename__ = "ticket_tag_links"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ticket_id = Column(
        UUID(as_uuid=True), ForeignKey("tickets.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    tag_id = Column(
        UUID(as_uuid=True), ForeignKey("ticket_tags.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    created_by_user_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "ticket_id", "tag_id", name="uq_ticket_tag_links"),
    )


# =============================================================================
# Hazir yanitlar (makrolar)
# =============================================================================

MACRO_VISIBILITIES = ("public", "internal")


class TicketMacro(TenantOwnedMixin, Base):
    """Metin + istege bagli eylemler (durum, oncelik, etiket). Uygulama
    TEK transaction'da yapilir; durum kurallari yine durum makinesinden
    gecer (ornegin "musteride bekliyor" public mesaj ister)."""

    __tablename__ = "ticket_macros"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(120), nullable=False)
    body = Column(Text, nullable=True)
    visibility = Column(String(10), nullable=False, default="public")
    set_status = Column(String(30), nullable=True)
    set_priority = Column(String(20), nullable=True)
    add_tag_ids = Column(JSONB, nullable=False, default=list,
                         server_default=text("'[]'::jsonb"))
    is_shared = Column(Boolean, nullable=False, default=True)
    owner_user_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now,
                        nullable=False)

    __table_args__ = (
        CheckConstraint("visibility IN ('public','internal')",
                        name="chk_ticket_macros_visibility"),
    )


# =============================================================================
# Kayitli gorunumler
# =============================================================================

class TicketView(TenantOwnedMixin, Base):
    """Hub filtre kombinasyonu (kuyruk, durum, oncelik, ekip, etiket,
    siralama). Kisisel veya paylasilan; ERISIM VERMEZ — sonuc yine
    gorunurluk predicate'inden gecer."""

    __tablename__ = "ticket_views"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(80), nullable=False)
    owner_user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    is_shared = Column(Boolean, nullable=False, default=False)
    filters_json = Column(JSONB, nullable=False, default=dict,
                          server_default=text("'{}'::jsonb"))
    position = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now,
                        nullable=False)


# =============================================================================
# Takipciler, okundu bilgisi, bildirimler
# =============================================================================

class TicketWatcher(TenantOwnedMixin, Base):
    """Saglayici kullanicisi bir talebi TAKIP eder (bildirim alir).
    Takip GORUNURLUK VERMEZ: talebi zaten gorebilen biri takip edebilir."""

    __tablename__ = "ticket_watchers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ticket_id = Column(
        UUID(as_uuid=True), ForeignKey("tickets.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "ticket_id", "user_id", name="uq_ticket_watchers"),
    )


class TicketRead(TenantOwnedMixin, Base):
    """Kim, talebi en son ne zaman gordu? `reader` = ajan kullanici kimligi
    veya talep edenin kaynak kullanici kimligi (`requester_source_user_id`
    ile ayni uzay). Liste "yeni guncelleme" isaretini buradan cikarir."""

    __tablename__ = "ticket_reads"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ticket_id = Column(
        UUID(as_uuid=True), ForeignKey("tickets.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    reader = Column(String(128), nullable=False)
    last_read_at = Column(DateTime(timezone=True), default=_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "ticket_id", "reader", name="uq_ticket_reads"),
    )


NOTIFICATION_KINDS = (
    "new_ticket",        # ekibine yeni talep
    "assigned",          # sana atandi
    "customer_replied",  # takip ettigin/atandigin talebe musteri yaniti
    "reopened",          # takip ettigin/atandigin talep yeniden acildi
    "automation",        # otomasyon kuralinin bildir eylemi (Dalga D2, 0022)
)


class TicketNotification(TenantOwnedMixin, Base):
    """Saglayici kullanicilarina uygulama ici bildirim (zil). Kanal tercihi
    `task_notification_settings.in_app_enabled` ile ayni anahtardan okunur.
    Okunmuslar 90 gun sonra temizlenir (jobs/notification_cleanup)."""

    __tablename__ = "ticket_notifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    ticket_id = Column(
        UUID(as_uuid=True), ForeignKey("tickets.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    kind = Column(String(40), nullable=False)
    actor_display_name = Column(String(200), nullable=True)
    read_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False,
                        index=True)

    __table_args__ = (
        Index("idx_ticket_notifications_user_unread", "user_id", "read_at"),
        CheckConstraint(
            "kind IN ('new_ticket','assigned','customer_replied','reopened','automation')",
            name="chk_ticket_notifications_kind",
        ),
    )


# =============================================================================
# Musteri memnuniyeti (Dalga C, 0020)
# =============================================================================

TICKET_CSAT_TABLES = ("ticket_csat",)


class TicketCsat(TenantOwnedMixin, Base):
    """Cozulen/kapanan talep icin talep edenin puani (1–5) + yorum.

    Talep basina TEK kayit (talep eden degistirebilir). Ajanlar gorur;
    rapor ortalama + memnun orani (4–5) uretir. Sozlesme olayi URETMEZ.
    """

    __tablename__ = "ticket_csat"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ticket_id = Column(
        UUID(as_uuid=True), ForeignKey("tickets.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    rating = Column(Integer, nullable=False)
    comment = Column(Text, nullable=True)
    requester_source_user_id = Column(String(128), nullable=False)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now,
                        nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "ticket_id", name="uq_ticket_csat_ticket"),
        CheckConstraint("rating BETWEEN 1 AND 5", name="chk_ticket_csat_rating"),
    )


# =============================================================================
# Talep birlestirme (Dalga D1, 0021)
# =============================================================================

TICKET_MERGE_TABLES = ("ticket_merges",)


class TicketMerge(TenantOwnedMixin, Base):
    """Kaynak talep hedefe birlestirildi. Kaynak `duplicate` koduyla cozulur
    (`tickets.duplicate_of_ticket_id` — sozlesmede mevcut); bu kayit kim/ne
    zaman bilgisini ve "birlestirilenler" listesini tasir. Kaynak basina tek."""

    __tablename__ = "ticket_merges"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_ticket_id = Column(
        UUID(as_uuid=True), ForeignKey("tickets.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    target_ticket_id = Column(
        UUID(as_uuid=True), ForeignKey("tickets.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    merged_by_user_id = Column(UUID(as_uuid=True), nullable=True)
    merged_at = Column(DateTime(timezone=True), default=_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "source_ticket_id", name="uq_ticket_merges_source"),
        CheckConstraint("source_ticket_id <> target_ticket_id", name="chk_ticket_merges_not_self"),
    )


# =============================================================================
# Otomasyon kurallari (Dalga D2, 0022)
# =============================================================================

TICKET_AUTOMATION_TABLES = ("ticket_automations", "ticket_automation_runs")
AUTOMATION_TRIGGERS = ("created", "customer_replied", "schedule")


class TicketAutomation(TenantOwnedMixin, Base):
    """"Eger ... ise ... yap" kurali. Olay kurallari (talep acildi / musteri
    yanitladi) ayni transaction'da, zamanli kurallar saatlik bakimda calisir.
    Eylemler MEVCUT servis kurallarindan gecer (durum makinesi, uyelik)."""

    __tablename__ = "ticket_automations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(120), nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    trigger = Column(String(20), nullable=False)
    conditions_json = Column(JSONB, nullable=False, default=dict,
                             server_default=text("'{}'::jsonb"))
    actions_json = Column(JSONB, nullable=False, default=list,
                          server_default=text("'[]'::jsonb"))
    position = Column(Integer, nullable=False, default=0)
    updated_by_user_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now,
                        nullable=False)

    __table_args__ = (
        CheckConstraint("trigger IN ('created','customer_replied','schedule')",
                        name="chk_ticket_automations_trigger"),
    )


class TicketAutomationRun(TenantOwnedMixin, Base):
    """Kuralin bir talepte calismasi. `run_key`: olay icin olay kimligi,
    zamanli kural icin "schedule" — boylece zamanli kural bir talepte BIR
    kez calisir."""

    __tablename__ = "ticket_automation_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    automation_id = Column(
        UUID(as_uuid=True), ForeignKey("ticket_automations.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    ticket_id = Column(
        UUID(as_uuid=True), ForeignKey("tickets.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    run_key = Column(String(80), nullable=False)
    outcome = Column(String(20), nullable=False, default="applied")
    detail = Column(Text, nullable=True)
    ran_at = Column(DateTime(timezone=True), default=_now, nullable=False, index=True)

    __table_args__ = (
        UniqueConstraint("tenant_id", "automation_id", "ticket_id", "run_key",
                         name="uq_ticket_automation_runs"),
        CheckConstraint("outcome IN ('applied','error')", name="chk_ticket_automation_runs_outcome"),
    )
