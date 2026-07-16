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
    # Asagidaki iki scope Stage 2'de onaylanan katalogda yer alir ancak
    # v1'de HENUZ endpoint'leri yok — dokumantasyonda "reserved" olarak
    # isaretlenir (3E review bulgusu; endpoint tasarimi ayri onay ister).
    "users:read": (
        "Reserved — read basic user directory information "
        "(no endpoints in v1 yet)."
    ),
    "groups:read": (
        "Reserved — read user groups and memberships "
        "(no endpoints in v1 yet)."
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
