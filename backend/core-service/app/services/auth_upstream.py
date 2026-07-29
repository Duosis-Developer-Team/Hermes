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

from shared.auth_upstream import normalize_auth_base_url

from ..config import get_settings


def auth_service_base_url() -> str:
    """auth-service KOK adresi: sonda egik cizgi yok, /api/v1 soneki yok.

    Cagiranlar kendi yolunu ekler — kok, uc farkli yuzeyi de tasir:
      - S2S dizin (prefix DISI):  f"{base}/internal/directory/users/resolve"
      - S2S authz (prefix DISI):  f"{base}/internal/authz/resolve"
      - Kullanici JWT'li uclar:   f"{base}/api/v1/auth/users/lookup"

    Normalizasyonun kendisi shared/auth_upstream.py'de yasar (RBAC R3'te
    reporting-service de ayni kurala muhtac oldu — kopya yazmak yerine
    fonksiyon shared'a alindi; bu adapter core settings'ini baglar).
    """
    return normalize_auth_base_url(get_settings().AUTH_SERVICE_URL)
