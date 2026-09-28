# =============================================================================
# HERMES Auth Service — Kullanici profil fotografi (Microsoft Graph)
# =============================================================================
# Microsoft SSO girisinde, kullanicinin KENDI delegated token'i ile
# Graph'tan (`/me/photos/96x96/$value`) alinan fotograf burada saklanir.
#
# Tasarim kararlari:
#   - `users` GLOBAL kimliktir; fotograf da kimligin ozelligidir, bu
#     yuzden tablo tenant sutunu ALMAZ. Tenant'a gore GORUNURLUK okuma
#     ucunda (uyelik kontrolu) uygulanir — depoda degil.
#   - Ayri tablo: `users` satirini her okumada bayt tasimaktan korur ve
#     kullanici silinince fotograf da gider (ON DELETE CASCADE).
#   - Yalnizca image/jpeg ve image/png; boyut ust siniri servis
#     katmaninda (`user_photo_service.MAX_PHOTO_BYTES`) VE veritabaninda
#     (CHECK) iki kez uygulanir.
# =============================================================================

from datetime import datetime, timezone

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
)
from sqlalchemy.dialects.postgresql import UUID

from ..database import Base

# Servis katmaniyla ayni deger; CHECK kisiti bununla uretilir.
MAX_PHOTO_BYTES = 200 * 1024


def _now():
    return datetime.now(timezone.utc)


class UserPhoto(Base):
    """Bir kullanicinin (en fazla bir) profil fotografi."""

    __tablename__ = "user_photos"

    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
        comment="Fotografin sahibi (users.id)",
    )
    content_type = Column(
        String(32), nullable=False,
        comment="image/jpeg | image/png (bayt imzasiyla dogrulanmis)",
    )
    data = Column(LargeBinary, nullable=False, comment="Ham resim baytlari")
    size_bytes = Column(Integer, nullable=False)
    etag = Column(
        String(64), nullable=False,
        comment="Baytlarin sha256 hex ozeti (HTTP ETag ve cache kirici)",
    )
    source = Column(
        String(32), nullable=False, default="microsoft-graph",
        server_default="microsoft-graph",
    )
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now,
    )

    __table_args__ = (
        CheckConstraint(
            "content_type IN ('image/jpeg','image/png')",
            name="chk_user_photos_content_type",
        ),
        CheckConstraint(
            f"size_bytes > 0 AND size_bytes <= {MAX_PHOTO_BYTES}",
            name="chk_user_photos_size",
        ),
    )
