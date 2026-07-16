# =============================================================================
# HERMES Public API - Scope catalog
# =============================================================================
# Tum public scope'larin TEK kaynagi. Kullanildigi yerler:
#   - OpenAPI dokumantasyonu (endpoint basina gereken scope'lar)
#   - /v1/capabilities kesif endpoint'i
#   - Admin panelinde scope secimi validasyonu (Stage 2A)
#   - require_scopes() dependency'si (Stage 2B)
#
# v1'de yikici/admin scope YOK (onaylanan katalog). Yeni scope eklemek
# bilincli bir API karari gerektirir; buradaki sirayla dokumante edilir.
# =============================================================================

SCOPES: dict[str, str] = {
    "tasks:read": "Read tasks, issues and suggestions visible to the client.",
    "tasks:write": "Create and update tasks, issues and suggestions.",
    "tasks:comment": "Add comments to visible work items.",
    "tasks:complete": "Accept, complete, reject or reopen visible work items.",
    "customers:read": "Read customers visible to the client.",
    "projects:read": "Read projects visible to the client.",
    "work-logs:read": "Read work logs visible to the client.",
    "work-logs:write": "Create work logs.",
    "meetings:read": "Read meetings visible to the client.",
    # Stage 5B-2 ile aktif: least-privilege dizin gorunurlugu (genis
    # calisan listesi DEGIL — yalnizca global binding genis dizin gorur).
    "users:read": (
        "Resolve user ids into minimal directory entries visible to "
        "the client (least-privilege; not a company-wide list)."
    ),
    "groups:read": (
        "Read user groups visible to the client (name, description, "
        "active member count — no member lists)."
    ),
}


def is_valid_scope(scope: str) -> bool:
    return scope in SCOPES


def scope_docs(*scopes: str) -> dict:
    """Route tanimlarina `openapi_extra=scope_docs("tasks:read")` olarak
    eklenir; custom openapi() bu metadata'dan security + aciklama uretir.
    Bilinmeyen scope programlama hatasidir — erken patlat."""
    for s in scopes:
        if s not in SCOPES:
            raise ValueError(f"unknown scope: {s}")
    return {"x-required-scopes": list(scopes)}
