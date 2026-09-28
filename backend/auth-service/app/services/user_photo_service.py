# =============================================================================
# HERMES Auth Service — Microsoft Graph profil fotografi
# =============================================================================
# Iki sorumluluk:
#   1. SSO girisinde, kullanicinin KENDI delegated token'i (`User.Read`)
#      ile Graph'tan fotografi cekip saklamak (`sync_from_graph`).
#   2. Okuma tarafinda tenant-farkindalikli gorunurluk (`visible_photo`,
#      `photo_meta_for`).
#
# DEGISMEZ: fotograf senkronu GIRISI ASLA bozmaz ve belirgin sekilde
# yavaslatmaz. Her hata yutulur, token/PII icermeyen bir uyari loglanir,
# giris devam eder. Toplam sure `PHOTO_FETCH_TIMEOUT_SECONDS` ile sinirli.
#
# Graph 404 = "fotograf yok" -> saklanan fotograf SILINIR (kullanici
# fotografini kaldirdiysa uygulamada da kaybolsun). Diger her hata
# (zaman asimi, 5xx, boyut asimi, yanlis tip) mevcut kaydi DEGISTIRMEZ.
# =============================================================================

from __future__ import annotations

import asyncio
import hashlib
import logging
from dataclasses import dataclass
from typing import Dict, Iterable, Optional, Tuple

from sqlalchemy.orm import Session

from ..models.user_photo import MAX_PHOTO_BYTES, UserPhoto

logger = logging.getLogger(__name__)

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
# Once kucuk boy (avatar icin yeterli, bayt az), yoksa varsayilan boy.
GRAPH_PHOTO_URLS = (
    f"{GRAPH_BASE}/me/photos/96x96/$value",
    f"{GRAPH_BASE}/me/photo/$value",
)
PHOTO_FETCH_TIMEOUT_SECONDS = 3.0
ALLOWED_CONTENT_TYPES = ("image/jpeg", "image/png")

# Sonuc turleri
PHOTO_FOUND = "found"
PHOTO_ABSENT = "absent"      # Graph: fotograf yok (404)
PHOTO_UNKNOWN = "unknown"    # hata/gecersiz: mevcut kayda dokunma


@dataclass(frozen=True)
class GraphPhotoResult:
    status: str
    content: Optional[bytes] = None
    content_type: Optional[str] = None
    reason: Optional[str] = None


class _InvalidPhoto(Exception):
    """Gelen yanit kullanilabilir bir fotograf degil."""


def _sniff_image_type(data: bytes) -> Optional[str]:
    """Bayt imzasindan tip; basliga guvenmeyiz."""
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    return None


def _validate(content: bytes, header_type: str) -> Tuple[bytes, str]:
    declared = (header_type or "").split(";", 1)[0].strip().lower()
    if declared == "image/jpg":
        declared = "image/jpeg"
    if declared not in ALLOWED_CONTENT_TYPES:
        raise _InvalidPhoto("content_type")
    if not content:
        raise _InvalidPhoto("empty")
    if len(content) > MAX_PHOTO_BYTES:
        raise _InvalidPhoto("oversize")
    sniffed = _sniff_image_type(content)
    if sniffed is None or sniffed != declared:
        raise _InvalidPhoto("signature")
    return content, sniffed


async def _fetch(access_token: str) -> GraphPhotoResult:
    import httpx

    headers = {"Authorization": f"Bearer {access_token}"}
    saw_only_404 = True
    last_reason = None
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(PHOTO_FETCH_TIMEOUT_SECONDS),
        follow_redirects=False,
    ) as client:
        for url in GRAPH_PHOTO_URLS:
            resp = await client.get(url, headers=headers)
            if resp.status_code == 404:
                continue
            saw_only_404 = False
            if resp.status_code != 200:
                last_reason = f"http_{resp.status_code}"
                continue
            # Buyuk govdeyi okumadan once bildirilen boyutu kontrol et.
            declared_len = resp.headers.get("content-length")
            if declared_len and declared_len.isdigit() and int(
                declared_len
            ) > MAX_PHOTO_BYTES:
                last_reason = "oversize"
                continue
            try:
                content, ctype = _validate(
                    resp.content, resp.headers.get("content-type", "")
                )
            except _InvalidPhoto as exc:
                last_reason = str(exc)
                continue
            return GraphPhotoResult(PHOTO_FOUND, content, ctype)
    if saw_only_404:
        return GraphPhotoResult(PHOTO_ABSENT)
    return GraphPhotoResult(PHOTO_UNKNOWN, reason=last_reason or "invalid")


async def fetch_graph_photo(access_token: str) -> GraphPhotoResult:
    """Graph'tan fotografi getirir; ASLA istisna firlatmaz.

    Toplam sure (iki deneme dahil) `PHOTO_FETCH_TIMEOUT_SECONDS` ile
    sinirlidir. Loglara token, e-posta veya ad YAZILMAZ.
    """
    if not access_token:
        return GraphPhotoResult(PHOTO_UNKNOWN, reason="no_token")
    try:
        return await asyncio.wait_for(
            _fetch(access_token), timeout=PHOTO_FETCH_TIMEOUT_SECONDS
        )
    except asyncio.TimeoutError:
        return GraphPhotoResult(PHOTO_UNKNOWN, reason="timeout")
    except Exception as exc:  # noqa: BLE001 — giris asla bozulmaz
        return GraphPhotoResult(
            PHOTO_UNKNOWN, reason=f"error:{type(exc).__name__}"
        )


def apply_result(db: Session, *, user_id, result: GraphPhotoResult) -> None:
    """Sonucu depoya yansitir (savepoint icinde) ve commit eder.

    Hata olursa yalnizca savepoint geri alinir; giris akisinin onceden
    commit edilmis kayitlari etkilenmez.
    """
    if result.status == PHOTO_UNKNOWN:
        return
    try:
        with db.begin_nested():
            row = db.get(UserPhoto, user_id)
            if result.status == PHOTO_ABSENT:
                if row is not None:
                    db.delete(row)
            else:
                etag = hashlib.sha256(result.content).hexdigest()
                if row is None:
                    db.add(UserPhoto(
                        user_id=user_id,
                        content_type=result.content_type,
                        data=result.content,
                        size_bytes=len(result.content),
                        etag=etag,
                    ))
                elif row.etag != etag:
                    row.content_type = result.content_type
                    row.data = result.content
                    row.size_bytes = len(result.content)
                    row.etag = etag
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.warning(
            "user photo store skipped: reason=%s", type(exc).__name__
        )


async def sync_from_graph(db: Session, *, user_id, access_token: str) -> None:
    """SSO girisinden cagrilir: getir + sakla. Hicbir zaman firlatmaz."""
    try:
        result = await fetch_graph_photo(access_token)
        if result.status == PHOTO_UNKNOWN:
            logger.warning(
                "user photo sync skipped: reason=%s", result.reason
            )
            return
        apply_result(db, user_id=user_id, result=result)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "user photo sync skipped: reason=error:%s", type(exc).__name__
        )


# =============================================================================
# Okuma tarafi — tenant-farkindalikli gorunurluk
# =============================================================================

def _visible_user_ids(db: Session, *, caller_id, tenant_id,
                      user_ids: Iterable) -> set:
    """Cagiranin fotografini gorebilecegi kullanicilar.

    Kural (least privilege): kendisi VEYA cagiranin MEVCUT tenant'inda
    AKTIF uyeligi olan kullanici. Baska tenant'in uyesi = yok (404).
    """
    from uuid import UUID

    from ..models.tenancy import TenantMembership
    from .membership_service import ACTIVE_MEMBERSHIP_STATUS

    ids = {UUID(str(u)) for u in user_ids}
    if not ids:
        return set()
    visible = set()
    caller = UUID(str(caller_id))
    if caller in ids:
        visible.add(caller)
    rows = (
        db.query(TenantMembership.user_id)
        .filter(
            TenantMembership.tenant_id == UUID(str(tenant_id)),
            TenantMembership.status == ACTIVE_MEMBERSHIP_STATUS,
            TenantMembership.user_id.in_(ids),
        )
        .all()
    )
    visible.update(r[0] for r in rows)
    return visible


def visible_photo(db: Session, *, caller_id, tenant_id,
                  user_id) -> Optional[UserPhoto]:
    """Gorunur ve var olan fotograf; aksi halde None (-> 404)."""
    if user_id not in _visible_user_ids(
        db, caller_id=caller_id, tenant_id=tenant_id, user_ids=[user_id]
    ):
        return None
    return db.get(UserPhoto, user_id)


def photo_meta_for(db: Session, *, caller_id, tenant_id,
                   user_ids: Iterable) -> Dict[str, str]:
    """{user_id(str): etag} — yalnizca cagiranin GOREBILECEGI fotograflar.

    Baytlari YUKLEMEZ (yalnizca user_id + etag kolonlari).
    """
    visible = _visible_user_ids(
        db, caller_id=caller_id, tenant_id=tenant_id, user_ids=user_ids
    )
    if not visible:
        return {}
    rows = (
        db.query(UserPhoto.user_id, UserPhoto.etag)
        .filter(UserPhoto.user_id.in_(visible))
        .all()
    )
    return {str(uid): etag for uid, etag in rows}
