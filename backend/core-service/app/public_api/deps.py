# =============================================================================
# HERMES Public API - kimlik dogrulama + scope dependency'leri (Stage 2B)
# =============================================================================
# Dogrulama zinciri (sirasi guvenlik geregi sabittir):
#   Bearer cikar → format kontrolu → SHA-256 → indexed lookup →
#   sabit-zamanli hash teyidi → token revoked? → expired? →
#   client disabled? → environment eslesiyor mu? → ApiContext
#
# Kurallar:
#   - YALNIZCA `Authorization: Bearer ...` kabul edilir. Cookie'ler ve
#     query parametreleri ASLA okunmaz (internal oturum cookie'si public
#     API'de kimlik DEGILDIR).
#   - Hash'in kendisi token olarak KABUL EDILMEZ (format kontrolu hms_
#     prefix'i sart kosar).
#   - Hicbir hata mesaji token/hash degeri icermez.
# =============================================================================

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models.api_client import ApiClient, ApiToken
from ..services import api_client_service
from .errors import PublicAPIError

# last_used_at guncellemesi en fazla bu araliklarla yazilir (yazma
# amplifikasyonunu onler; amendment'a uygun "throttled" metadata).
LAST_USED_UPDATE_INTERVAL_SECONDS = 60

_VALID_PREFIXES = ("hms_dev_", "hms_live_")


def client_ip(request: Request) -> Optional[str]:
    """Guvenilir proxy zinciri: Cloudflare → ingress-nginx → pod.
    CF-Connecting-IP en guvenilir kaynaktir; yoksa X-Forwarded-For'un
    ILK adresi (ingress ekler), o da yoksa soket adresi."""
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf.strip()[:45]
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()[:45]
    return request.client.host if request.client else None


@dataclass
class ApiContext:
    """Dogrulanmis public istegin kimlik baglami. request.state'e de
    islenir (audit/rate-limit katmanlari icin)."""

    client: ApiClient
    token: ApiToken
    scopes: frozenset = field(default_factory=frozenset)


def _lookup_token(db: Session, digest: str):
    """Indexed lookup (token_hash UNIQUE). Test edilebilirlik icin ayri
    fonksiyon. (client join'i ayri sorgu — iki PK/unique lookup.)"""
    token = (
        db.query(ApiToken).filter(ApiToken.token_hash == digest).first()
    )
    if token is None:
        return None, None
    client = (
        db.query(ApiClient).filter(ApiClient.id == token.client_id).first()
    )
    return token, client


def _touch_last_used(db: Session, token: ApiToken, ip: Optional[str]) -> None:
    """Best-effort, throttled last-used metadata. Basarisizligi istegi
    ASLA bozmaz."""
    now = datetime.now(timezone.utc)
    last = token.last_used_at
    if last is not None and last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    if (
        last is not None
        and (now - last).total_seconds() < LAST_USED_UPDATE_INTERVAL_SECONDS
    ):
        return
    try:
        token.last_used_at = now
        token.last_used_ip = ip
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()


async def get_api_context(
    request: Request,
    db: Session = Depends(get_db),
) -> ApiContext:
    # 1) Bearer-only cikarim — cookie/query ASLA okunmaz.
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise PublicAPIError(
            "invalid_token",
            "Missing bearer token. Send 'Authorization: Bearer <token>'.",
        )
    raw = auth_header[len("Bearer "):].strip()

    # 2) Format kontrolu — hash-as-token dahil bicimsiz girdiyi erken reddet.
    if not raw.startswith(_VALID_PREFIXES) or len(raw) < 20:
        raise PublicAPIError("invalid_token", "Invalid API token.")

    # 3) SHA-256 → indexed lookup → sabit-zamanli teyit.
    digest = api_client_service.hash_token(raw)
    token, client = _lookup_token(db, digest)
    if token is None or client is None:
        raise PublicAPIError("invalid_token", "Invalid API token.")
    if not api_client_service.hashes_equal(token.token_hash, digest):
        raise PublicAPIError("invalid_token", "Invalid API token.")

    # 4) Token durumu.
    if token.status == "revoked":
        raise PublicAPIError("revoked_token", "This token has been revoked.")
    expires = token.expires_at
    if expires is not None:
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires <= datetime.now(timezone.utc):
            raise PublicAPIError(
                "expired_token", "This token has expired."
            )

    # 5) Client durumu — disabled client'in TUM token'lari aninda gecersiz
    #    (amendment #3; token satirlarini tek tek degistirmek gerekmez).
    if client.status != "active":
        raise PublicAPIError(
            "invalid_token", "The API client for this token is disabled."
        )

    # 6) Ortam eslesmesi — dev token'i live'da (ve tersi) calismaz.
    if client.environment != get_settings().PUBLIC_API_ENV:
        raise PublicAPIError(
            "invalid_token",
            "This token's environment does not match this deployment.",
        )

    # 7) Baglam + throttled last-used.
    _touch_last_used(db, token, client_ip(request))

    ctx = ApiContext(
        client=client,
        token=token,
        scopes=frozenset(client.scopes or []),
    )
    # Audit / rate-limit katmanlari icin (2C) request.state'e isle.
    request.state.api_client_id = str(client.id)
    request.state.api_token_id = str(token.id)
    return ctx


def require_scopes(*scopes: str):
    """Endpoint bagimliligi: `Depends(require_scopes("tasks:read"))`.
    Eksik scope → 403 insufficient_scope (eksikler mesajda listelenir —
    scope adlari public katalogdur, sizinti degildir)."""

    async def _checker(
        ctx: ApiContext = Depends(get_api_context),
    ) -> ApiContext:
        missing = [s for s in scopes if s not in ctx.scopes]
        if missing:
            raise PublicAPIError(
                "insufficient_scope",
                "This token does not have the required scope(s): "
                + ", ".join(sorted(missing)),
            )
        return ctx

    return _checker
