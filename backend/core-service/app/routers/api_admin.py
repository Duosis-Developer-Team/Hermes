# =============================================================================
# HERMES - API Management admin router (Stage 2D)
# =============================================================================
# Admin → API Management sayfasinin backend'i. INTERNAL API'dir:
#   - /api/v1/core/admin/... altinda yasar (public yuzeyin PARCASI DEGIL,
#     public OpenAPI'de gorunmez).
#   - Mevcut Hermes admin oturumu (RS256 JWT cookie + require_admin) sarttir;
#     public API token'lari (hms_...) BURADA KIMLIK DEGILDIR — shared.auth
#     JWT decode'unda zaten gecemezler.
#   - Hata bicimi: mevcut internal konvansiyon (HTTPException/detail).
#     Public error envelope BURADA KULLANILMAZ.
#   - Token plaintext'i YALNIZCA create/rotate yanitinda doner; hicbir
#     listeleme/detay endpoint'i onu (veya hash'i) geri veremez.
# =============================================================================

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.api_client import ApiClient
from ..schemas.api_admin import (
    AccessBindingResponse,
    AccessBindingsUpdate,
    ApiClientCreate,
    ApiClientResponse,
    ApiClientUpdate,
    ApiRequestLogResponse,
    ApiTokenCreate,
    ApiTokenCreatedResponse,
    ApiTokenExpiryUpdate,
    ApiTokenResponse,
)
from ..services import api_client_service as svc
from shared.auth import CurrentUser, require_admin

router = APIRouter(prefix="/admin", tags=["API Management"])


# ── Serializerlar ───────────────────────────────────────────────────────


def _token_response(t) -> ApiTokenResponse:
    return ApiTokenResponse(
        id=t.id,
        client_id=t.client_id,
        token_prefix=t.token_prefix,
        status=t.status,
        expires_at=t.expires_at,
        revoked_at=t.revoked_at,
        last_used_at=t.last_used_at,
        last_used_ip=t.last_used_ip,
        rotated_from_token_id=t.rotated_from_token_id,
        created_at=t.created_at,
    )


def _client_response(db: Session, client: ApiClient) -> ApiClientResponse:
    bindings = svc.list_client_bindings(db, client.id)
    tokens = svc.list_client_tokens(db, client.id)
    return ApiClientResponse(
        id=client.id,
        name=client.name,
        description=client.description,
        client_type=client.client_type,
        bound_user_id=client.bound_user_id,
        environment=client.environment,
        scopes=list(client.scopes or []),
        rate_limit_per_min=client.rate_limit_per_min,
        status=client.status,
        created_by=client.created_by,
        created_at=client.created_at,
        updated_at=client.updated_at,
        access=[
            AccessBindingResponse(
                id=b.id, access_type=b.access_type, target_id=b.target_id
            )
            for b in bindings
        ],
        tokens=[_token_response(t) for t in tokens],
    )


# ── API Clients ─────────────────────────────────────────────────────────


@router.get("/api-clients", response_model=List[ApiClientResponse])
async def list_api_clients(
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return [_client_response(db, c) for c in svc.list_clients(db)]


@router.post(
    "/api-clients",
    response_model=ApiClientResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_api_client(
    data: ApiClientCreate,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    client = svc.create_client(db, data, created_by=UUID(admin.id))
    return _client_response(db, client)


@router.get("/api-clients/{client_id}", response_model=ApiClientResponse)
async def get_api_client(
    client_id: UUID,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return _client_response(db, svc.get_client(db, client_id))


@router.patch("/api-clients/{client_id}", response_model=ApiClientResponse)
async def update_api_client(
    client_id: UUID,
    data: ApiClientUpdate,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    client = svc.get_client(db, client_id)
    client = svc.update_client(db, client, data)
    return _client_response(db, client)


@router.delete("/api-clients/{client_id}", response_model=ApiClientResponse)
async def disable_api_client(
    client_id: UUID,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """SOFT disable — veri silinmez; client'in tum token'lari dogrulama
    zincirindeki client-status kontrolu sayesinde ANINDA gecersizlesir."""
    client = svc.get_client(db, client_id)
    client = svc.disable_client(db, client)
    return _client_response(db, client)


@router.put(
    "/api-clients/{client_id}/bindings",
    response_model=List[AccessBindingResponse],
)
async def replace_api_client_bindings(
    client_id: UUID,
    data: AccessBindingsUpdate,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    client = svc.get_client(db, client_id)
    bindings = svc.replace_bindings(db, client, data.access)
    return [
        AccessBindingResponse(
            id=b.id, access_type=b.access_type, target_id=b.target_id
        )
        for b in bindings
    ]


# ── Tokens ──────────────────────────────────────────────────────────────


@router.post(
    "/api-clients/{client_id}/tokens",
    response_model=ApiTokenCreatedResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_api_token(
    client_id: UUID,
    data: ApiTokenCreate,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Plaintext token YALNIZCA bu yanitta gorunur."""
    client = svc.get_client(db, client_id)
    if client.status != "active":
        from fastapi import HTTPException

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot create a token for a disabled client.",
        )
    plaintext, row = svc.create_token(
        db, client, expires_at=data.expires_at, created_by=UUID(admin.id)
    )
    return ApiTokenCreatedResponse(
        token=plaintext, token_row=_token_response(row)
    )


@router.get("/api-tokens", response_model=List[ApiTokenResponse])
async def list_api_tokens(
    client_id: Optional[UUID] = Query(None),
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if client_id is not None:
        svc.get_client(db, client_id)  # 404 kontrolu
        return [
            _token_response(t) for t in svc.list_client_tokens(db, client_id)
        ]
    # Tum token'lar (admin genel bakisi)
    from ..models.api_client import ApiToken

    rows = db.query(ApiToken).order_by(ApiToken.created_at.desc()).all()
    return [_token_response(t) for t in rows]


@router.post(
    "/api-tokens/{token_id}/revoke", response_model=ApiTokenResponse
)
async def revoke_api_token(
    token_id: UUID,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    token = svc.get_token(db, token_id)
    return _token_response(svc.revoke_token(db, token))


@router.post(
    "/api-tokens/{token_id}/rotate",
    response_model=ApiTokenCreatedResponse,
    status_code=status.HTTP_201_CREATED,
)
async def rotate_api_token(
    token_id: UUID,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Transactional rotate: yeni token + eski revoke tek commit'te.
    Plaintext YALNIZCA bu yanitta gorunur."""
    token = svc.get_token(db, token_id)
    client = svc.get_client(db, token.client_id)
    plaintext, new_row = svc.rotate_token(
        db, token, client, created_by=UUID(admin.id)
    )
    return ApiTokenCreatedResponse(
        token=plaintext, token_row=_token_response(new_row)
    )


@router.patch("/api-tokens/{token_id}", response_model=ApiTokenResponse)
async def update_api_token_expiry(
    token_id: UUID,
    data: ApiTokenExpiryUpdate,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    token = svc.get_token(db, token_id)
    return _token_response(
        svc.update_token_expiry(db, token, data.expires_at)
    )


# ── Request logs ────────────────────────────────────────────────────────


@router.get(
    "/api-request-logs", response_model=List[ApiRequestLogResponse]
)
async def list_api_request_logs(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    client_id: Optional[UUID] = Query(None),
    status_code: Optional[int] = Query(None, ge=100, le=599),
    created_from: Optional[datetime] = Query(None),
    created_to: Optional[datetime] = Query(None),
    request_id: Optional[str] = Query(None, max_length=64),
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    rows = svc.list_request_logs(
        db,
        limit=limit,
        offset=offset,
        client_id=client_id,
        status_code=status_code,
        created_from=created_from,
        created_to=created_to,
        request_id=request_id,
    )
    return [
        ApiRequestLogResponse(
            id=r.id,
            request_id=r.request_id,
            client_id=r.client_id,
            token_id=r.token_id,
            method=r.method,
            path=r.path,
            status_code=r.status_code,
            duration_ms=r.duration_ms,
            source_ip=r.source_ip,
            user_agent=r.user_agent,
            rate_limited=r.rate_limited,
            created_at=r.created_at,
        )
        for r in rows
    ]
