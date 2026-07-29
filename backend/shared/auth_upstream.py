# =============================================================================
# HERMES - auth-service upstream adres normalizasyonu (SERVISLER-ARASI)
# =============================================================================
# 2026-07-17 canli bug dersi: AUTH_SERVICE_URL configmap'te /api/v1
# SONEKIYLE gelir; /internal/* ve /api/v1/auth/rbac/* gibi yollari
# eklemeden once sonek kirpilmalidir. Bu is BIR yerde yasar — kopyasi
# bir kez daha yazilmasin diye shared'a alindi (core adapter'i kendi
# settings'iyle sarar; reporting dogrudan cagirir).
# =============================================================================


def normalize_auth_base_url(raw: str) -> str:
    """Ham AUTH_SERVICE_URL → kok adres (sonda '/' yok, '/api/v1' yok)."""
    base = (raw or "").strip().rstrip("/")
    if base.endswith("/api/v1"):
        base = base[: -len("/api/v1")]
    return base
