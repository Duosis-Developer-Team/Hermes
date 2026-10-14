# =============================================================================
# HERMES core — Talep e-posta kanali (Dalga D4, 0024)
# =============================================================================
# SAGLAYICININ verisi (RLS):
#   ticket_mail_settings — saglayici basina tek satir (yoksa varsayilanlar):
#       talep edene / ekibe e-posta, dil, gelen e-posta (kapali baslar).
#   ticket_mail_outbox   — giden e-posta kuyrugu. Kanonik mutasyonla AYNI
#       transaction'da yazilir; dakikalik dispatcher Graph ile gonderir.
#       Operasyonel tablodur: 30 gunden eski sonuclanmis satirlar budanir.
#   ticket_mail_inbound  — islenen gelen e-postalarin kaydi (tekrar islemeyi
#       `internet_message_id` ile onler; gonderen basina hiz siniri).
# LogiSlot sozlesmesi DEGISMEZ: bu tablolar olay/outbox alanina girmez.
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
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID

from ..database import Base
from .mixins import TenantOwnedMixin


def _now():
    return datetime.now(timezone.utc)


TICKET_MAIL_TABLES = ("ticket_mail_settings", "ticket_mail_outbox", "ticket_mail_inbound")

MAIL_LANGUAGES = ("tr", "en")
# Talep edene: alindi, isleme alindi (atama), ekip yaniti, bilgi istegi,
# kendi yanitinin kopyasi, cozum; reddedilen gelen e-postaya kisa yanit.
# Ekibe (ekibin tum uyeleri + atanan + takipciler): yeni talep, atama, ekip
# yaniti, musteri yaniti, cozum, yeniden acilis. (0026 kisiti genisletti.)
MAIL_KINDS = (
    "reply", "waiting", "resolved", "received", "inbound_rejected", "assigned", "own_reply",
    "agent_assigned", "agent_customer_replied", "agent_reopened",
    "agent_new_ticket", "agent_replied", "agent_resolved",
)
MAIL_AUDIENCES = ("requester", "agent")
MAIL_STATES = ("pending", "sent", "failed", "skipped")
INBOUND_OUTCOMES = ("created", "replied", "rejected", "ignored")


def _in(column: str, values) -> str:
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


class TicketMailSettings(TenantOwnedMixin, Base):
    __tablename__ = "ticket_mail_settings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    requester_enabled = Column(Boolean, nullable=False, default=True)
    agent_enabled = Column(Boolean, nullable=False, default=True)
    language = Column(String(5), nullable=False, default="tr")
    inbound_enabled = Column(Boolean, nullable=False, default=False)
    updated_by_user_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", name="uq_ticket_mail_settings_tenant"),
        CheckConstraint(_in("language", MAIL_LANGUAGES), name="chk_ticket_mail_settings_language"),
    )


class TicketMailOutbox(TenantOwnedMixin, Base):
    __tablename__ = "ticket_mail_outbox"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Reddedilen gelen e-postaya yanit bir talebe bagli degildir.
    ticket_id = Column(UUID(as_uuid=True), ForeignKey("tickets.id", ondelete="CASCADE"), nullable=True)
    kind = Column(String(40), nullable=False)
    audience = Column(String(20), nullable=False)
    # Ajan: kullanici kimligi (adres gonderimde S2S dizinden cozulur).
    # Talep eden: adres (talebin anlik goruntusu ya da gelen e-postanin
    # gondereni).
    recipient_user_id = Column(UUID(as_uuid=True), nullable=True)
    recipient_email = Column(String(255), nullable=True)
    message_id = Column(UUID(as_uuid=True), nullable=True)
    resolution_id = Column(UUID(as_uuid=True), nullable=True)
    actor_display_name = Column(String(200), nullable=True)
    # inbound_rejected: hangi gerekce metni (ornegin unknown_sender).
    reason = Column(String(40), nullable=True)
    subject_hint = Column(String(200), nullable=True)
    status = Column(String(20), nullable=False, default="pending")
    attempts = Column(Integer, nullable=False, default=0)
    next_attempt_at = Column(DateTime(timezone=True), default=_now, nullable=False)
    last_error = Column(String(200), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)
    sent_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint(_in("kind", MAIL_KINDS), name="chk_ticket_mail_outbox_kind"),
        CheckConstraint(_in("audience", MAIL_AUDIENCES), name="chk_ticket_mail_outbox_audience"),
        CheckConstraint(_in("status", MAIL_STATES), name="chk_ticket_mail_outbox_status"),
        CheckConstraint(
            "recipient_user_id IS NOT NULL OR recipient_email IS NOT NULL",
            name="chk_ticket_mail_outbox_recipient",
        ),
        Index("idx_ticket_mail_outbox_due", "tenant_id", "status", "next_attempt_at"),
        Index("idx_ticket_mail_outbox_created", "tenant_id", text("created_at DESC")),
    )


class TicketMailInbound(TenantOwnedMixin, Base):
    __tablename__ = "ticket_mail_inbound"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    internet_message_id = Column(String(512), nullable=False)
    sender_email = Column(String(255), nullable=True)
    outcome = Column(String(20), nullable=False)
    reason = Column(String(40), nullable=True)
    ticket_id = Column(UUID(as_uuid=True), ForeignKey("tickets.id", ondelete="SET NULL"), nullable=True)
    message_id = Column(UUID(as_uuid=True), nullable=True)
    received_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "internet_message_id", name="uq_ticket_mail_inbound_message"),
        CheckConstraint(_in("outcome", INBOUND_OUTCOMES), name="chk_ticket_mail_inbound_outcome"),
        Index("idx_ticket_mail_inbound_sender", "tenant_id", "sender_email", text("created_at DESC")),
    )
