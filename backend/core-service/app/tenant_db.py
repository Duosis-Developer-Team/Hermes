# =============================================================================
# HERMES core-service — Tenant baglamli DB session'i (WS4)
# =============================================================================
# RLS politikalari `current_setting('app.tenant_id')` degerini okur. Bu
# deger, isteğin KULLANDIGI transaction icinde ve TRANSACTION-LOCAL
# olarak ayarlanmak zorundadir:
#
#   SELECT set_config('app.tenant_id', :tenant_id, true)
#                                                   ^^^^
#                                            transaction-local
#
# Neden `true` (SET LOCAL) sart:
#   Session-level `SET`, baglanti havuza geri dondugunde SILINMEZ. Bir
#   sonraki istek BASKA bir tenant icin ayni baglantiyi alirsa, onceki
#   tenant'in baglami hala oradadir — sessiz capraz-tenant sizintisi.
#   Transaction-local ayar, COMMIT/ROLLBACK ile birlikte kaybolur.
#
# Neden servis katmani ARTIK commit ETMEMELI:
#   `SET LOCAL` transaction'a baglidir. Bir servis metodu istegin
#   ortasinda commit ederse, o transaction biter ve tenant baglami
#   DUSER; sonraki sorgular sifir satir gorur veya RLS ihlali verir.
#   Bu yuzden unit-of-work siniri ROUTE'a aittir: servisler `flush`
#   eder, commit'i bu dependency yapar.
# =============================================================================

from __future__ import annotations

import logging
from typing import Generator

from fastapi import Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from shared.auth import CurrentUser, get_current_user

from .database import SessionLocal

logger = logging.getLogger("hermes.tenant_db")

# Politikalarin okudugu GUC adi. Tek yerde tanimli: migration ve
# runtime ayni ismi kullanmak zorunda.
TENANT_GUC = "app.tenant_id"

# Session.info icinde tenant'i tasiyan anahtar.
SESSION_TENANT_KEY = "hermes_tenant_id"


# =============================================================================
# Yeni satirlara tenant damgasi
# =============================================================================
# `tenant_id` NOT NULL oldugu icin her INSERT onu tasimak zorunda. Bunu
# 100'den fazla create cagrisinda ELLE yazmak, bir tanesini unutmak
# demekti — ve unutulan yer 500 hatasi verirdi.
#
# ONEMLI AYRIM: bu bir IZOLASYON mekanizmasi DEGILDIR (pack 04 §7:
# "no automatic ORM query hook as the primary isolation mechanism").
# Okuma tarafinda hicbir otomatik filtre yok; izolasyonun otoritesi
# RLS'tir. Bu hook yalnizca YAZMA kolaylığidir ve yanlis damgalarsa
# RLS'in WITH CHECK'i zaten reddeder.
#
# Nesne zaten bir tenant_id tasiyorsa DOKUNULMAZ: platform/bakim
# yollari bilincli olarak baska bir tenant adina yazabilir ve bu
# durumda karari RLS verir.

def _stamp_tenant(session: Session, flush_context, instances) -> None:
    from .models.mixins import TenantOwnedMixin

    tenant_id = session.info.get(SESSION_TENANT_KEY)
    if not tenant_id:
        return
    for obj in session.new:
        if isinstance(obj, TenantOwnedMixin) and obj.tenant_id is None:
            obj.tenant_id = tenant_id


def install_tenant_stamping() -> None:
    """before_flush dinleyicisini bir kez kaydeder."""
    from sqlalchemy import event
    from sqlalchemy.orm import Session as _Session

    if not event.contains(_Session, "before_flush", _stamp_tenant):
        event.listen(_Session, "before_flush", _stamp_tenant)


install_tenant_stamping()


def mark_session_tenant(db: Session, tenant_id: str) -> None:
    """Session'i bir tenant'a isaretler — SQL CALISTIRMAZ.

    Yalnizca `before_flush` damgasinin okudugu `Session.info` girdisini
    yazar. `bind_tenant`ten farki: transaction ACMAZ. Bu ayrim, henuz
    isi olmayan bir session'in bosuna kilit tutmasini onler.
    """
    db.info[SESSION_TENANT_KEY] = str(tenant_id)


def bind_tenant(db: Session, tenant_id: str) -> None:
    """Acik transaction'a tenant baglamini yazar (transaction-local).

    Parametre BAGLIDIR (string interpolasyonu YOK): tenant_id
    dogrulanmis bir token'dan gelse de, GUC degerini SQL metnine
    gommek gereksiz bir enjeksiyon yuzeyidir.

    Ayrica tenant, session'in `info` sozlugune yazilir; yeni nesnelerin
    `tenant_id` damgalanmasi (asagidaki before_flush) bunu okur.
    """
    db.info[SESSION_TENANT_KEY] = str(tenant_id)
    db.execute(
        text("SELECT set_config(:name, :value, true)"),
        {"name": TENANT_GUC, "value": str(tenant_id)},
    )


def current_tenant(db: Session) -> str | None:
    """Oturumun gordugu tenant baglami (teshis/test icin)."""
    value = db.execute(
        text("SELECT current_setting(:name, true)"), {"name": TENANT_GUC}
    ).scalar()
    return value or None


def get_tenant_db(
    current_user: CurrentUser = Depends(get_current_user),
) -> Generator[Session, None, None]:
    """Tenant verisine erisen TUM route'larin kullanmasi gereken session.

    Akis:
      1. Dogrulanmis principal'dan tenant alinir (istekten DEGIL);
      2. session acilir ve transaction baslar;
      3. `app.tenant_id` transaction-local yazilir;
      4. route calisir;
      5. istisna yoksa TEK commit burada yapilir;
      6. istisnada rollback; her durumda close.

    `get_db` ile farki: orada tenant baglami YOKTUR ve RLS altinda
    hicbir tenant satiri gorunmez. Bu bilincli bir fail-closed
    tasarimdir — unutulan bir route "tum tenant'lari" degil "hicbir
    seyi" gorur.
    """
    db = SessionLocal()
    try:
        bind_tenant(db, current_user.tenant_id)
        yield db
        # Unit-of-work siniri: istek basarili bittiyse TEK commit.
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        # Havuza geri veriliyor. Transaction bittigi icin `SET LOCAL`
        # zaten dusmustur; ayrica rollback ile durum sifirlanir.
        db.close()


class TenantSession:
    """Route disi (job, S2S, bakim) yollari icin tenant baglamli session.

    Kullanim:

        with TenantSession(tenant_id) as db:
            ...

    Arka plan isleri istek principal'i tasimadigi icin dependency
    kullanamaz; ama tenant baglami yine de ZORUNLUDUR — bu sinif,
    "tenant'siz global tarama" yolunu kapatir.
    """

    def __init__(self, tenant_id: str):
        if not tenant_id:
            raise ValueError(
                "TenantSession tenant_id olmadan acilamaz — tenant'siz "
                "global tarama yasaktir."
            )
        self._tenant_id = str(tenant_id)
        self._db: Session | None = None

    def __enter__(self) -> Session:
        self._db = SessionLocal()
        bind_tenant(self._db, self._tenant_id)
        return self._db

    def __exit__(self, exc_type, exc, tb) -> bool:
        assert self._db is not None
        try:
            if exc_type is None:
                self._db.commit()
            else:
                self._db.rollback()
        finally:
            self._db.close()
            self._db = None
        return False
