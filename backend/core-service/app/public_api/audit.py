# =============================================================================
# HERMES Public API - Request audit middleware (Stage 2C)
# =============================================================================
# Her public istegi api_request_logs tablosuna yazar. Kurallar:
#   - Istek/yanit GOVDESI, Authorization header'i, cookie, query string,
#     token plaintext'i veya hash'i ASLA kaydedilmez (amendment #10).
#   - path olarak ROUTE SABLONU yazilir (orn. /v1/tasks/{task_code});
#     sablon cozulemezse query'siz ham path'e duselir.
#   - Audit yazimi istegi ASLA bozamaz; basarisizlik sanitize edilmis
#     yapisal server loguna duser (amendment #8: exception SINIFI loglanir,
#     mesaji loglanmaz — SQL/parametre sizintisi olasiligina karsi).
#   - Yanit header'larina X-RateLimit-* eklenir (deps rate sonucunu
#     request.state'e koyar).
# =============================================================================

import logging
import time

from starlette.middleware.base import BaseHTTPMiddleware

from .deps import client_ip
from .rate_limit import rate_limit_headers

logger = logging.getLogger("hermes.public_api.audit")


def _persist(record: dict) -> None:
    """Tek kayit yazar. Ayri, kisa omurlu session — istegin kendi DB
    islemlerinden bagimsiz. Testlerde monkeypatch edilir.

    WS6: kayit TENANT baglaminda yazilir. `api_request_logs` tenant-owned
    ve RLS korumali; baglamsiz bir insert WITH CHECK'e takilir. Tenant,
    dogrulanmis token'dan gelen `request.state` degeridir — istekten
    DEGIL.

    Kimlik dogrulamasi BASARISIZ olan istekler (tenant'i olmayanlar)
    veritabanina yazilmaz; onlar zaten IP bazli sayacla sinirlaniyor ve
    tenant'i olmayan bir denetim kaydinin sahibi de yoktur.
    """
    from ..models.api_client import ApiRequestLog
    from ..tenant_db import TenantSession

    tenant_id = record.get("tenant_id")
    if not tenant_id:
        # Kimlik dogrulamasi basarisiz olan istegin sahibi bir tenant
        # YOKTUR; RLS altinda yazilamaz ve yazilmamalidir da. Bu
        # istekler zaten IP bazli sayacla sinirlaniyor.
        return

    with TenantSession(str(tenant_id)) as db:
        db.add(ApiRequestLog(**record))


def _route_template(request) -> str:
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    if path:
        # Mount root_path'i sablona dahil degil — /v1/... halini sakla.
        return path[:255]
    # Fallback: query'siz ham path (token query'de zaten KABUL edilmez).
    return request.url.path[:255]


class AuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        started = time.perf_counter()
        response = await call_next(request)
        duration_ms = int((time.perf_counter() - started) * 1000)

        # Rate-limit basliklarini basarili yanitlara da ekle.
        rate_result = getattr(request.state, "rate_limit", None)
        if rate_result is not None:
            for k, v in rate_limit_headers(rate_result).items():
                response.headers.setdefault(k, v)

        record = {
            "request_id": getattr(request.state, "request_id", "")[:64],
            "tenant_id": getattr(request.state, "api_tenant_id", None),
            "client_id": getattr(request.state, "api_client_id", None),
            "token_id": getattr(request.state, "api_token_id", None),
            "method": request.method[:8],
            "path": _route_template(request),
            "status_code": response.status_code,
            "duration_ms": duration_ms,
            "source_ip": client_ip(request),
            "user_agent": (request.headers.get("user-agent") or "")[:255]
            or None,
            "rate_limited": bool(
                getattr(request.state, "rate_limited", False)
            ),
        }
        try:
            _persist(record)
        except Exception as exc:  # noqa: BLE001 — istegi asla bozma
            # Sanitize yapisal log: yalnizca istek metadata'si + hata
            # SINIFI. Mesaj bilerek yok (SQL/parametre sizintisi riski).
            logger.warning(
                "audit write failed request_id=%s method=%s path=%s "
                "status=%s error=%s",
                record["request_id"],
                record["method"],
                record["path"],
                record["status_code"],
                exc.__class__.__name__,
            )
        return response
