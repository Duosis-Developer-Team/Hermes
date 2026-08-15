# =============================================================================
# HERMES Core Service — Tenant projeksiyonu ve sayaclari (WS2)
# =============================================================================
# core_db tenant OTORITESI DEGILDIR: tenant kayitlarinin sahibi auth_db'dir.
# Burada iki sey yasar:
#
#   1) `tenant_registry` — auth kontrol duzleminden gelen idempotent
#      PROJEKSIYON. Amaci, core'un bilinmeyen/pasif bir tenant'i
#      veritabanlari arasi FK olmadan reddedebilmesidir. Kullaniciya
#      donuk hicbir akis bu tabloya yazmaz; yalnizca S2S projeksiyon
#      ucu yazar.
#
#   2) `tenant_counters` — tenant basina ATOMIK numara uretimi.
#      Bugunku global `task_number_seq` / `tasks_type_seq_*` sequence'lari
#      her tenant'a bagimsiz bir TASK-1, ISSUE-1 serisi VEREMEZ. Sayac
#      tek UPDATE ... RETURNING ile ilerletilir; `MAX()+1` ASLA
#      kullanilmaz (es zamanli iki istekte ayni numarayi uretir).
# =============================================================================

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    Integer,
    String,
)
from sqlalchemy.dialects.postgresql import UUID

from ..database import Base


def _now():
    return datetime.now(timezone.utc)


class TenantRegistry(Base):
    """auth_db `tenants` tablosunun core_db'deki projeksiyonu."""

    __tablename__ = "tenant_registry"

    tenant_id = Column(UUID(as_uuid=True), primary_key=True,
                       default=uuid.uuid4)
    slug = Column(String(63), nullable=False, unique=True, index=True)
    status = Column(String(20), nullable=False, default="provisioning",
                    index=True)
    placement_key = Column(String(64), nullable=False,
                           default="shared-default")

    # Kaynak surumu: auth'tan gelen SIRASIZ/eski bir projeksiyon
    # mesajinin daha yeni durumu ezmesini engeller (deterministik olarak
    # yok sayilir).
    source_version = Column(Integer, nullable=False, default=0)

    provisioned_at = Column(DateTime(timezone=True), default=_now,
                            nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now,
                        onupdate=_now, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "status IN ('provisioning','active','suspended','grace',"
            "'deprovisioning','archived','failed')",
            name="chk_tenant_registry_status",
        ),
    )


class TenantCounter(Base):
    """Tenant basina atomik numara uretici.

    `counter_key` stabil bir isim alanidir: 'task', 'issue',
    'suggestion'. Yeni bir numara su sekilde ayrilir (tek ifade, satir
    kilidi altinda):

        UPDATE tenant_counters
           SET next_value = next_value + 1
         WHERE tenant_id = :t AND counter_key = :k
        RETURNING next_value - 1

    Satir yoksa once INSERT ... ON CONFLICT DO NOTHING ile yaratilir.
    Bkz. app/services/tenant_counters.py
    """

    __tablename__ = "tenant_counters"

    tenant_id = Column(UUID(as_uuid=True), primary_key=True)
    counter_key = Column(String(32), primary_key=True)
    next_value = Column(BigInteger, nullable=False, default=1)
    updated_at = Column(DateTime(timezone=True), default=_now,
                        onupdate=_now, nullable=False)

    __table_args__ = (
        CheckConstraint("next_value >= 1", name="chk_tenant_counters_min"),
    )
