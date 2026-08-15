# =============================================================================
# HERMES Core Service — Tenant sahiplik mixin'i (WS3/WS4)
# =============================================================================
# Her tenant-owned tablo `tenant_id` tasir. Bu mixin tek bir yerde
# tanimlar ki 33 tablonun kolon tipi/index deseni birbirinden ayrismasin.
#
# FAZ NOTU (onemli): kolon burada NULLABLE tanimlidir cunku cutover
# expand → backfill → enforce sirasini izler:
#
#   0003 (expand)   : kolon NULLABLE eklenir; mevcut satirlar bozulmaz,
#                     eski image ayni semayla calismaya devam eder.
#   0004 (backfill) : mevcut tum satirlara ilk Duosis tenant'i yazilir.
#   0005 (enforce)  : NOT NULL + tenant-qualified unique/FK + FORCE RLS.
#
# Kolon NOT NULL olarak tanimlanirsa expand fazi imkansiz olur: mevcut
# satirlarin tenant'i henuz bilinmezken ALTER basarisiz olur.
#
# FK BILEREK YOKTUR: `tenant_id` core_db'de mantiksal bir referanstir
# (otorite auth_db'dedir). Tenant-tutarli composite FK'ler tablolar
# ARASINDA (orn. task → project) enforce fazinda kurulur.
# =============================================================================

from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declared_attr


class TenantOwnedMixin:
    """Tenant'a ait her tabloya `tenant_id` ekler.

    Bu mixin'i tasiyan her model, RLS envanter testinde otomatik olarak
    "tenant-owned" sayilir: yeni bir tablo mixin'i alip politikayi
    almazsa CI kirmizi olur (04_DATA_MODEL §8, tablo envanter kapisi).
    """

    @declared_attr
    def tenant_id(cls):  # noqa: N805 — SQLAlchemy declared_attr imzasi
        return Column(
            UUID(as_uuid=True),
            nullable=True,      # enforce fazinda NOT NULL olur
            index=True,
            comment="Sahibi tenant (auth_db.tenants.id) — expand fazinda "
                    "nullable, 0005'te NOT NULL",
        )


# =============================================================================
# Otoriter tenant-owned tablo envanteri
# =============================================================================
# TEK KAYNAK: liste elle tutulMAZ, mixin'i tasiyan siniflardan TURETILIR.
# Elle tutulan bir liste, yeni bir tablonun sessizce politika disinda
# kalmasi demektir — pack'in en kritik riski (17_RISK_REGISTER §1).
#
# Migration'lar (tenant_id, index, RLS politikasi) ve RLS envanter testi
# ayni fonksiyonu cagirir; boylece "modelde var ama politikasi yok"
# durumu CI'da kirmizi olur.

def tenant_owned_tables() -> tuple:
    """`TenantOwnedMixin` tasiyan tum tablolarin adlari (sirali)."""
    import app.models  # noqa: F401 — tum modelleri kaydeder
    from app.database import Base

    names = set()
    for mapper in Base.registry.mappers:
        cls = mapper.class_
        if issubclass(cls, TenantOwnedMixin):
            names.add(cls.__tablename__)
    return tuple(sorted(names))
