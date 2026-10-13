# =============================================================================
# HERMES core — Talep agi (ticket network) baglantilari
# =============================================================================
# "Hangi tenant, hangi tenant'a talep acabilir?" sorusunun TEK cevabi.
#
# Bir baglanti = talep eden tenant (requester) → saglayici tenant (provider).
# Canonical talep kaydi SAGLAYICININ verisinde (RLS) durur; varsayilan ekip
# saglayicinin `support_ticket_routes` satirindadir (mevcut mekanizma).
# Bu tablo yalnizca INDEKS ve DURUMDUR: talep eden tarafin portali,
# saglayicilarin verisini tek tek taramadan "kime acabilirim?" sorusunu
# buradan cevaplar.
#
# GLOBAL (RLS'siz) — `tenant_registry` gibi kontrol duzlemi konfigurasyonu:
#   - Yalnizca S2S `/internal/support/network` ucu (platform konsolu) yazar;
#     kullaniciya donuk hicbir akis YAZMAZ.
#   - Talep ICERIGI tasimaz; yalnizca iki tenant kimligi + durum + ad
#     snapshot'lari.
#   - Satir SILINMEZ: pasife alinan baglanti yeni talebi durdurur, gecmis
#     talepler iki tarafta da gorunmeye devam eder.
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
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID

from ..database import Base


def _now():
    return datetime.now(timezone.utc)


TICKET_NETWORK_TABLES = ("ticket_network_links",)


class TicketNetworkLink(Base):
    __tablename__ = "ticket_network_links"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    requester_tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenant_registry.tenant_id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    provider_tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenant_registry.tenant_id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    is_active = Column(Boolean, nullable=False, default=True)
    # Ad SNAPSHOT'lari: core'da tenant adi yok (auth otoritedir). Konsol
    # baglantiyi kurarken gonderir; portal "Kime: Intertech" diye gosterir.
    requester_display_name = Column(String(200), nullable=True)
    provider_display_name = Column(String(200), nullable=True)
    # Eszamanli konsol duzenlemesi icin iyimser kilit.
    version = Column(Integer, nullable=False, default=1)
    created_by = Column(String(64), nullable=True)
    updated_by = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now,
                        onupdate=_now, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "requester_tenant_id", "provider_tenant_id",
            name="uq_ticket_network_pair",
        ),
        # Kendi kendine talep agi YOK: saglayicinin kendi kullanicilari
        # hub'i gorur; ayni tenant'ta iki yuzeyin ust uste binmesi
        # "kendi kendine talep acan ekip" karmasasi yaratir.
        CheckConstraint(
            "requester_tenant_id <> provider_tenant_id",
            name="chk_ticket_network_not_self",
        ),
        CheckConstraint("version >= 1", name="chk_ticket_network_version"),
    )
