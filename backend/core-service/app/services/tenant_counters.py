# =============================================================================
# HERMES core — Tenant basina ATOMIK numara uretici
# =============================================================================
# `app/models/tenancy.py` bu modulu isaret ediyordu ama modul henuz
# yazilmamisti; ticket numaralari (TKT-000123) ilk gercek tuketicisidir.
#
# NEDEN `MAX()+1` DEGIL: es zamanli iki istek ayni degeri okur ve ayni
# numarayi uretir. `tickets` uzerindeki UNIQUE (tenant_id, number)
# ikinciyi reddederdi — yani kullanici, sirf ayni anda baska biri ticket
# actigi icin hata gorurdu.
#
# NEDEN GLOBAL SEQUENCE DEGIL: sequence tenant bilmez. Bugun canonical
# ticket'lar tek bir tenant'ta (Duosis support) yasiyor, ama ayni sayac
# altyapisi yarin baska bir tenant icin de dogru davranmali. Ayrica
# `tenant_counters` bu repoda zaten kurulu ve RLS DISI global bir
# tablodur (satirin ANAHTARI tenant_id'dir).
#
# GAP KABUL EDILIR: numara ayirmis bir transaction geri alinirsa o numara
# kullanilmaz. Onemli olan BENZERSIZLIK ve MONOTONLUK; bosluk degil.
# =============================================================================

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session


def next_number(db: Session, *, tenant_id, counter_key: str) -> int:
    """Bir sonraki numarayi ATOMIK olarak ayirir.

    Tek ifade, satir kilidi altinda:

        UPDATE tenant_counters
           SET next_value = next_value + 1
         WHERE tenant_id = :t AND counter_key = :k
        RETURNING next_value - 1

    Satir yoksa once `INSERT ... ON CONFLICT DO NOTHING` ile yaratilir;
    yaris halinde ikinci istek de ayni satiri gorur ve UPDATE sirasina
    girer.

    Cagiran transaction'in PARCASIDIR: commit BURADA yapilmaz (unit of
    work route'a aittir). Yani ticket yazimi basarisiz olursa numara da
    geri alinir.
    """
    params = {"t": str(tenant_id), "k": counter_key}

    allocated = db.execute(
        text(
            "UPDATE tenant_counters SET next_value = next_value + 1, "
            "       updated_at = now() "
            " WHERE tenant_id = CAST(:t AS uuid) AND counter_key = :k "
            "RETURNING next_value - 1"
        ),
        params,
    ).scalar()

    if allocated is not None:
        return int(allocated)

    db.execute(
        text(
            "INSERT INTO tenant_counters (tenant_id, counter_key, "
            "       next_value, updated_at) "
            "VALUES (CAST(:t AS uuid), :k, 1, now()) "
            "ON CONFLICT (tenant_id, counter_key) DO NOTHING"
        ),
        params,
    )
    allocated = db.execute(
        text(
            "UPDATE tenant_counters SET next_value = next_value + 1, "
            "       updated_at = now() "
            " WHERE tenant_id = CAST(:t AS uuid) AND counter_key = :k "
            "RETURNING next_value - 1"
        ),
        params,
    ).scalar()
    if allocated is None:  # pragma: no cover — satir az once yazildi
        raise RuntimeError(
            f"tenant_counters satiri ayrilamadi: {counter_key}"
        )
    return int(allocated)


def peek(db: Session, *, tenant_id, counter_key: str) -> int:
    """Bir sonraki degeri OKUR (ayirmaz). Yalnizca teshis/gosterim."""
    value = db.execute(
        text(
            "SELECT next_value FROM tenant_counters "
            " WHERE tenant_id = CAST(:t AS uuid) AND counter_key = :k"
        ),
        {"t": str(tenant_id), "k": counter_key},
    ).scalar()
    return int(value or 1)
