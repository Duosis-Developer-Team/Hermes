# =============================================================================
# hermes-mcp - OAuth kesif URL'leri (RFC 9728 Protected Resource Metadata)
# =============================================================================
# KRITIK DERS (canli 5D bulgusu): str.rstrip("/mcp") bir SONEK silmez —
# verilen KARAKTER KUMESINDEKI tum sondaki karakterleri siler. Bu yuzden
#   "https://hermes.duosis.com/mcp/".rstrip("/mcp") -> "https://hermes.duosis.co"
# ('.com'un 'm'si de gider) ve challenge yanlis domaine isaret eder.
#
# Kural: URL parcalari YALNIZCA urllib.parse ile ayristirilir. Bu modulde
# ve cagiranlarinda origin/path turetmek icin rstrip/strip/karakter-kumesi
# kirpma KULLANILMAZ (test kilidi: test_stage5d_hardening).
# =============================================================================

from urllib.parse import urlsplit

PRM_PREFIX = "/.well-known/oauth-protected-resource"


def origin_of(resource_url: str) -> str:
    """`scheme://host[:port]` — ACIK port korunur, ekleme/cikarma yapilmaz.

    urlsplit netloc'u oldugu gibi tasir: 'hermes.duosis.com' ve
    'hermes.duosis.com:443' ayni sekilde dogru sonuc verir.
    """
    parts = urlsplit(resource_url)
    if not parts.scheme or not parts.netloc:
        raise ValueError(
            "resource URL must be absolute (scheme://host[:port]/path)"
        )
    return f"{parts.scheme}://{parts.netloc}"


def _normalized_path(resource_url: str) -> str:
    """Kaynagin path'i, sondaki '/' TASINMADAN. Karakter kirpma yerine
    segmentlere ayirip yeniden kurar — sinir durumlari acik ve guvenli:
      '/mcp/' -> '/mcp'   '/mcp' -> '/mcp'   '/' -> ''   '' -> ''
    """
    segments = [s for s in urlsplit(resource_url).path.split("/") if s]
    return "/" + "/".join(segments) if segments else ""


def prm_url(resource_url: str) -> str:
    """RFC 9728: PRM dokumaninin URL'i — origin + well-known prefix +
    kaynagin path eki (kaynak path'siz ise yalnizca prefix)."""
    return f"{origin_of(resource_url)}{PRM_PREFIX}{_normalized_path(resource_url)}"


def www_authenticate(resource_url: str) -> str:
    """401 challenge basligi: client'i PRM dokumanina yonlendirir."""
    return f'Bearer resource_metadata="{prm_url(resource_url)}"'
