# =============================================================================
# HERMES core — Bilgi bankasi / yardim merkezi (Dalga D3, 0023)
# =============================================================================
# SAGLAYICININ verisi (RLS): kategori + makale + "yardimci oldu mu" oyu.
# Makale: taslak/yayinda; ekip ici (yalniz ajanlar) veya musteriye acik
# (saglayiciya bagli talep edenlerin yardim merkezi). Musteri yalniz
# yayinda + musteriye acik makaleyi gorur; digerleri YOK sayilir (404).
# Govde sinirli bir Markdown alt kumesidir; istemci HTML uretmeden cizer.
# =============================================================================

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
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


KB_TABLES = ("kb_categories", "kb_articles", "kb_votes")
KB_STATUSES = ("draft", "published")
KB_AUDIENCES = ("internal", "public")


class KbCategory(TenantOwnedMixin, Base):
    __tablename__ = "kb_categories"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(120), nullable=False)
    description = Column(Text, nullable=True)
    position = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_kb_categories_name"),
    )


class KbArticle(TenantOwnedMixin, Base):
    __tablename__ = "kb_articles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Kategori SILINMEZ (pasife alinir) → RESTRICT yeterli.
    category_id = Column(
        UUID(as_uuid=True), ForeignKey("kb_categories.id", ondelete="RESTRICT"),
        nullable=True, index=True,
    )
    title = Column(String(200), nullable=False)
    summary = Column(String(500), nullable=True)
    body = Column(Text, nullable=False, default="")
    status = Column(String(20), nullable=False, default="draft", index=True)
    audience = Column(String(20), nullable=False, default="public")
    keywords = Column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))
    author_user_id = Column(UUID(as_uuid=True), nullable=True)
    updated_by_user_id = Column(UUID(as_uuid=True), nullable=True)
    published_at = Column(DateTime(timezone=True), nullable=True)
    view_count = Column(Integer, nullable=False, default=0)
    helpful_yes = Column(Integer, nullable=False, default=0)
    helpful_no = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now, nullable=False)

    __table_args__ = (
        CheckConstraint("status IN ('draft','published')", name="chk_kb_articles_status"),
        CheckConstraint("audience IN ('internal','public')", name="chk_kb_articles_audience"),
    )


class KbVote(TenantOwnedMixin, Base):
    """Okuyucu basina tek oy (degistirilebilir). `reader` = ajan veya
    talep edenin kaynak kullanici kimligi."""

    __tablename__ = "kb_votes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    article_id = Column(
        UUID(as_uuid=True), ForeignKey("kb_articles.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    reader = Column(String(128), nullable=False)
    helpful = Column(Boolean, nullable=False)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "article_id", "reader", name="uq_kb_votes_reader"),
    )
