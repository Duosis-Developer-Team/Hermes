# =============================================================================
# hermes-mcp - Public API hata zarfi -> MCP tool hatasi eslemesi
# =============================================================================
# Tasarim §15: mekanik tablo, yaraticilik yok. request_id HER hataya
# eklenir (AI konusmasindan audit kaydina kesintisiz iz). 404 metni
# non-disclosure'i AYNEN korur.
# =============================================================================

RETRYABLE_CODES = {"rate_limit_exceeded", "idempotency_request_in_progress"}


def map_api_error(status: int, body) -> dict:
    """(status, envelope) -> tool hata sozlugu:
    {"error": {...}, "retryable": bool, "guidance": str}"""
    err = (body or {}).get("error") if isinstance(body, dict) else None
    code = (err or {}).get("code") or "internal_error"
    message = (err or {}).get("message") or "Request failed."
    request_id = (err or {}).get("request_id") or ""

    if code in ("invalid_token", "expired_token", "revoked_token"):
        guidance = (
            "Non-retryable. Ask the user to check/rotate the Hermes API "
            "token configured for this MCP server."
        )
    elif code == "insufficient_scope":
        guidance = (
            "Non-retryable. The token lacks a required scope; a Hermes "
            "administrator can extend the API client's scopes."
        )
    elif code == "resource_not_found":
        message = "Not found (or not visible to this token)."
        guidance = (
            "Do not assume the record does not exist — it may simply be "
            "outside this token's data access."
        )
    elif code == "rate_limit_exceeded":
        guidance = "Retryable. Wait for the indicated time, then retry."
    elif code == "idempotency_request_in_progress":
        guidance = (
            "Retryable. The original request is still running; retry the "
            "same call shortly and the stored response will be replayed."
        )
    elif code == "validation_error":
        guidance = (
            "Fix the arguments per the message and call the tool again."
        )
    elif code == "internal_error":
        guidance = (
            f"Hermes internal error. Report request_id {request_id or '?'} "
            "to a Hermes administrator."
        )
    else:
        guidance = "See the message; consult the Hermes error catalog."

    return {
        "error": {
            "code": code,
            "http_status": status,
            "message": message,
            "request_id": request_id,
        },
        "retryable": code in RETRYABLE_CODES,
        "guidance": guidance,
    }
