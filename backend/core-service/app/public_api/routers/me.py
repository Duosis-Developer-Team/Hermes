# =============================================================================
# HERMES Public API - /v1/me (Stage 2B proof-of-concept)
# =============================================================================
# Dogrulanmis token'in KENDI kimligini doner — hicbir Hermes is verisi
# icermez. Entegrasyonlarin "token'im calisiyor mu, hangi izinlerim var"
# sorusunu tek cagriyla yanitlar.
# =============================================================================

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ...database import get_db
from ...models.api_client import ApiClientAccess
from ..deps import ApiContext, get_api_context

router = APIRouter(prefix="/v1")


def _workspace_slug(db: Session, tenant_id) -> str | None:
    """Tenant'in okunabilir slug'i (core projeksiyonundan).

    Slug yalnizca insan icin bir KOLAYLIKTIR; hicbir yetki kararinda
    kullanilmaz. Bu yuzden cozulemezse (projeksiyon henuz yok, sorgu
    basarisiz) kimlik yaniti BOZULMAZ — `None` doner. Otoriter alan
    `workspace.id`dir ve o dogrudan token kaydindan gelir.
    """
    from sqlalchemy import text

    try:
        return db.execute(
            text("SELECT slug FROM tenant_registry WHERE tenant_id = :t"),
            {"t": tenant_id},
        ).scalar()
    except Exception:  # noqa: BLE001 — kolaylik alani istegi bozamaz
        return None


@router.get(
    "/me",
    tags=["Meta"],
    summary="Authenticated client identity",
    description=(
        "Returns the API client, token metadata, granted scopes and "
        "data-access bindings for the presented bearer token. Requires a "
        "valid token but no particular scope."
    ),
    openapi_extra={"security": [{"ApiToken": []}]},
)
async def me(
    ctx: ApiContext = Depends(get_api_context),
    db: Session = Depends(get_db),
):
    bindings = (
        db.query(ApiClientAccess)
        .filter(ApiClientAccess.client_id == ctx.client.id)
        .all()
    )
    return {
        # WS6: token'in BAGLI OLDUGU workspace. Entegrasyonlar (ve MCP)
        # hangi organizasyona baglandiklarini dogrulayabilsin diye
        # doner; ayrica MCP'nin gorunurluk cache'i bu degeri saklayip
        # her istekte KARSILASTIRIR (cache'in yanlis tenant'a servis
        # yapmasi yapisal olarak yakalanir).
        #
        # Yalnizca GUVENLI alanlar: plan, limit, uye sayisi, domain
        # listesi DONMEZ.
        "workspace": {
            "id": str(ctx.client.tenant_id),
            "slug": _workspace_slug(db, ctx.client.tenant_id),
        },
        "client": {
            "id": str(ctx.client.id),
            "name": ctx.client.name,
            "type": ctx.client.client_type,
            "environment": ctx.client.environment,
            "status": ctx.client.status,
            "bound_user_id": (
                str(ctx.client.bound_user_id)
                if ctx.client.bound_user_id
                else None
            ),
        },
        "token": {
            "prefix": ctx.token.token_prefix,
            "expires_at": ctx.token.expires_at,
            "last_used_at": ctx.token.last_used_at,
        },
        "scopes": sorted(ctx.scopes),
        "access": [
            {
                "access_type": b.access_type,
                "target_id": str(b.target_id) if b.target_id else None,
            }
            for b in bindings
        ],
    }
