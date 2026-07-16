# =============================================================================
# HERMES core - auth-service upstream adres turetimi (TEK KAYNAK)
# =============================================================================
# Neden ayri modul: AUTH_SERVICE_URL configmap'te /api/v1 SONEGIYLE gelir
# ("http://auth-service/api/v1"), ama auth-service'in /internal/directory
# router'i /api prefix'inin DISINDA kayitlidir (auth main.py:
# include_router(internal_directory_router) — prefix yok). Sonek
# kirpilmadan /internal/... eklenirse 404 alinir.
#
# CANLI BUG (2026-07-16, hermes-test): directory_client sonegi kirpmadan
# istek atiyordu → /api/v1/internal/directory/... → 404 →
# DirectoryUnavailable → sanitize 500. Sonuc: /v1/users ve /v1/groups
# HICBIR ortamda calismadi. task_notifications ayni turetimi DOGRU
# yapiyordu; yani hata degil, ayni isin IKI KOPYASI ve birinin
# eksikligiydi. Ders: turetim tek yerde yasar.
#
# NOT: .rstrip("/") burada guvenlidir — karakter kumesi tek bir "/",
# yani yalnizca sondaki egik cizgileri atar. MCP discovery.py'deki
# .rstrip( yasagi COK KARAKTERLI kume ile kirpmaya aitti (".com" →
# ".co" kesilmesi); buradaki kullanim o sinifa girmez.
# =============================================================================

from ..config import get_settings

_API_PREFIX = "/api/v1"


def auth_service_base_url() -> str:
    """auth-service KOK adresi: sonda egik cizgi yok, /api/v1 soneki yok.

    Cagiranlar kendi yolunu ekler — kok, iki farkli yuzeyi de tasir:
      - S2S dizin (prefix DISI):  f"{base}/internal/directory/users/resolve"
      - Kullanici JWT'li uclar:   f"{base}/api/v1/auth/users/lookup"
    """
    base = (get_settings().AUTH_SERVICE_URL or "").strip().rstrip("/")
    if base.endswith(_API_PREFIX):
        base = base[: -len(_API_PREFIX)]
    return base
