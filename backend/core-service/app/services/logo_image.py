# =============================================================================
# HERMES - Logo gorseli ortak dogrulama ve sunum yardimcilari
# =============================================================================
# Musteri ve proje logolari AYNI kurallari paylasir (tek kapi burasi; DB
# CHECK'leri ikinci savunma hattidir — models/logo_image):
#   - Boyut: 1 bayt .. LOGO_MAX_BYTES (256 KB).
#   - Tip: yalnizca PNG / JPEG / WEBP; SVG ve digerleri REDDEDILIR.
#   - Beyan edilen Content-Type ile sihirli baytlarin tespit ettigi tip
#     AYNI olmali (uzanti/beyan yalanina karsi).
#   - Sunum: ETag (sha256), If-None-Match -> 304, private onbellek, nosniff.
# =============================================================================

from typing import Optional

from fastapi import Response, status

from ..models.logo_image import LOGO_CONTENT_TYPES, LOGO_MAX_BYTES

LOGO_CACHE_CONTROL = "private, max-age=86400"


class LogoTooLarge(Exception):
    """Logo boyut tavanini asiyor."""


class LogoRejected(Exception):
    """Logo tipi desteklenmiyor veya icerik beyanla eslesmiyor."""


def normalize_content_type(value: Optional[str]) -> str:
    """'image/PNG; charset=x' -> 'image/png'. Bos -> ''."""
    return (value or "").split(";", 1)[0].strip().lower()


def sniff(data: bytes) -> Optional[str]:
    """Sihirli baytlardan tip tespiti; taninmayan icerik -> None."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def validate(data: bytes, declared_type: Optional[str]) -> str:
    """Gecerliyse normalize tipi dondurur; aksi halde istisna."""
    if len(data) > LOGO_MAX_BYTES:
        raise LogoTooLarge()
    if not data:
        raise LogoRejected("The logo file is empty.")
    declared = normalize_content_type(declared_type)
    if declared not in LOGO_CONTENT_TYPES:
        raise LogoRejected("Only PNG, JPEG or WEBP logos are allowed.")
    if sniff(data) != declared:
        raise LogoRejected("The file content does not match its declared image type.")
    return declared


def if_none_match_hits(header: Optional[str], etag: str) -> bool:
    """RFC 9110 If-None-Match (zayif karsilastirma): liste, W/ ve '*'."""
    if not header:
        return False
    for raw in header.split(","):
        tag = raw.strip()
        if tag == "*":
            return True
        if tag.startswith("W/"):
            tag = tag[2:]
        if tag.strip('"') == etag:
            return True
    return False


def logo_response(row, if_none_match: Optional[str]) -> Response:
    """Logo satirini HTTP yanitina cevirir (ETag + onbellek + nosniff; 304)."""
    headers = {
        "ETag": f'"{row.etag}"',
        "Cache-Control": LOGO_CACHE_CONTROL,
        "X-Content-Type-Options": "nosniff",
    }
    if if_none_match_hits(if_none_match, row.etag):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    return Response(content=bytes(row.content), media_type=row.content_type, headers=headers)
