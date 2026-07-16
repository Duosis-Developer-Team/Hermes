# =============================================================================
# HERMES Public API - Request ID middleware
# =============================================================================
# Her public istege bir request ID atar:
#   - Gelen X-Request-ID SADECE guvenli desene uyuyorsa kabul edilir
#     (^[A-Za-z0-9_-]{8,64}$) — log injection / header abuse engellenir.
#   - Aksi halde req_<uuid4hex> uretilir.
#   - ID, request.state.request_id'de tasinir; yanit header'inda ve hata
#     zarfinda ayni deger doner; audit kayitlarina da bu deger yazilir.
# =============================================================================

import re
import uuid

from starlette.middleware.base import BaseHTTPMiddleware

_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


def _new_request_id() -> str:
    return f"req_{uuid.uuid4().hex}"


class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        inbound = request.headers.get("x-request-id", "")
        request.state.request_id = (
            inbound if _SAFE_REQUEST_ID.match(inbound) else _new_request_id()
        )
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        return response
