# =============================================================================
# HERMES Public API - Meta endpoints (v1)
# =============================================================================
# Kimlik dogrulamasi gerektirmeyen kesif/saglik endpoint'leri. Veri
# kaynaklari (tasks, customers, ...) Stage 3'te ayri router'lar olarak
# eklenir; bu dosya yalnizca API'nin kendisini tarif eder.
# =============================================================================

from fastapi import APIRouter

from ..errors import ERROR_DOCS, ERROR_STATUS
from ..scopes import SCOPES

router = APIRouter(prefix="/v1")


@router.get(
    "/health",
    tags=["Meta"],
    summary="API health",
    description="Liveness check for the public API surface.",
)
async def public_health():
    return {
        "status": "ok",
        "service": "hermes-public-api",
        "version": "v1",
    }


@router.get(
    "/capabilities",
    tags=["Meta"],
    summary="API capabilities",
    description=(
        "Describes the public API surface: available versions, "
        "authentication scheme and documentation locations."
    ),
)
async def public_capabilities():
    return {
        "api_version": "v1",
        "versions": ["v1"],
        "authentication": {
            "type": "bearer",
            "header": "Authorization",
            "token_prefixes": ["hms_dev_", "hms_live_"],
        },
        "scopes": SCOPES,
        # Onayli D2 (Stage 4B, ADDITIVE): hata katalogu — Developer
        # Portal'in tek kaynagi. Icerik errors.ERROR_STATUS/ERROR_DOCS'tan
        # gelir (guvenli public aciklamalar; internal detay/istisna adi
        # YOK). Kalici hizalama testleri: test_stage3e_release_review.
        "errors": [
            {
                "code": code,
                "status": status,
                "description": ERROR_DOCS[code],
            }
            for code, status in ERROR_STATUS.items()
        ],
        "pagination": {
            "type": "offset",
            "default_limit": 25,
            "max_limit": 100,
        },
        "writes": {
            # Onayli v1 kurallari: aktor her zaman bagli kullanicidir.
            "client_types": ["user"],
            "service_clients": "read-only",
            "destructive_operations": "unavailable",
            "idempotency": {
                "header": "Idempotency-Key",
                "retention_hours": 24,
                "replay_header": "Idempotency-Replayed",
                "in_progress_error_code": "idempotency_request_in_progress",
            },
        },
        "docs_url": "/api/public/v1/docs",
        "openapi_url": "/api/public/v1/openapi.json",
        "deprecations": [],
    }
