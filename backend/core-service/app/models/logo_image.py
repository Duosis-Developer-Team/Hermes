# =============================================================================
# HERMES - Logo gorseli ortak kurallari (musteri + proje logolari)
# =============================================================================
# Tek kaynak: servis dogrulamasi ve DB CHECK'leri AYNI sabitleri kullanir.
# Her logo tablosu ayni CHECK'leri kendi adiyla alir (logo_check_constraints).
# SVG YOK: ayni origin'den sunulan SVG script tasiyabilir (stored XSS).
# =============================================================================

from sqlalchemy import CheckConstraint

LOGO_MAX_BYTES = 256 * 1024
LOGO_CONTENT_TYPES = ("image/png", "image/jpeg", "image/webp")


def logo_check_constraints(table: str):
    """Boyut (1..LOGO_MAX_BYTES), tip allowlist'i ve 64 karakterlik etag."""
    return (
        CheckConstraint(
            f"octet_length(content) > 0 AND octet_length(content) <= {LOGO_MAX_BYTES}",
            name=f"chk_{table}_size",
        ),
        CheckConstraint(
            "content_type IN ("
            + ", ".join(f"'{t}'" for t in LOGO_CONTENT_TYPES)
            + ")",
            name=f"chk_{table}_content_type",
        ),
        CheckConstraint("char_length(etag) = 64", name=f"chk_{table}_etag"),
    )
