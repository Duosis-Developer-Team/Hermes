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
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..tenant_db import bind_tenant
from ..models.api_client import ApiClient, ApiToken
from ..services import api_client_service
from .errors import PublicAPIError
from .rate_limit import get_limiter, rate_limit_headers

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


def discover_tenant(db: Session, digest: str, environment: str):
    """Token'in TENANT'ini bulur — tenant baglami HENUZ YOKKEN.

    RLS altinda `api_tokens` sorgusu tenant baglami olmadan sifir satir
    doner; ama kimlik dogrulamasi tam olarak "hangi tenant?" sorusunu
    cevaplamak zorundadir. Bu tavuk-yumurta problemi, RLS'i genel olarak
    asarak DEGIL, tek bir dar SECURITY DEFINER fonksiyonuyla cozulur
    (bkz. migration 0006). Fonksiyon yalnizca guvenli tanimlayicilari
    doner; scope/binding/isim gibi hicbir icerik gormez.

    Returns:
        Satir bulunmazsa None.
    """
    row = db.execute(
        text(
            "SELECT tenant_id, token_id, client_id, token_status, "
            "       token_expires_at, client_status, environment_matches "
            "FROM hermes_sec.api_token_lookup(:h, :env)"
        ),
        {"h": digest, "env": environment},
    ).mappings().first()
    return row


def _lookup_token(db: Session, digest: str):
    """Tenant baglami KURULDUKTAN sonra token/client'i NORMAL RLS
    altinda okur.

    Bu ikinci okuma bilinclidir: ayricalikli fonksiyon yalnizca tenant'i
    kesfeder; scope, binding ve durum kararlari RLS'in gordugu satirlar
    uzerinden verilir. Boylece ayricalikli yol mumkun oldugunca dar
    kalir.
    """
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
    ASLA bozmaz.

    WS6: yazma AYRI bir kisa oturumda yapilir. Onceden istegin kendi
    session'inda `commit()` cagriliyordu; tenant baglami
    (`SET LOCAL app.tenant_id`) transaction'a bagli oldugu icin bu
    commit, isteğin GERI KALANINI tenant'siz birakirdi — ve RLS altinda
    o noktadan sonra hicbir satir gorunmezdi. Metadata yazmak, isteğin
    izolasyon baglamini bozmaya degmez.
    """
    now = datetime.now(timezone.utc)
    last = token.last_used_at
    if last is not None and last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    if (
        last is not None
        and (now - last).total_seconds() < LAST_USED_UPDATE_INTERVAL_SECONDS
    ):
        return
    # Once BELLEKTEKI nesne — kalicilastirma basarisiz olsa bile bu
    # istegin gordugu deger tutarli olsun.
    token.last_used_at = now
    token.last_used_ip = ip
    try:
        # Baglanti, istegin KENDI engine'inden alinir (global
        # `SessionLocal` DEGIL): testler farkli bir veritabanina baglanir
        # ve global fabrikayi kullanmak, yapilandirilmis-ama-erisilemez
        # bir sunucuya baglanma denemesi demektir.
        engine = db.get_bind()
        with engine.connect() as side:
            with side.begin():
                side.execute(
                    text("SELECT set_config('app.tenant_id', :t, true)"),
                    {"t": str(token.tenant_id)},
                )
                side.execute(
                    text(
                        "UPDATE api_tokens SET last_used_at = :now, "
                        "last_used_ip = :ip WHERE id = :id"
                    ),
                    {"now": now, "ip": ip, "id": token.id},
                )
    except Exception:  # noqa: BLE001 — metadata asla istegi bozmaz
        pass


def _reject_auth(request: Request, ip: Optional[str], code: str, message: str):
    """Basarisiz kimlik dogrulamayi IP bazinda sayar (amendment #7).
    Denenen token DEGERI ne saklanir ne loglanir — anahtar yalnizca IP'dir.
    Limit asilirsa 401 yerine 429 doner (brute-force yavaslatma).

    Guven varsayimi: IP, Cloudflare → ingress-nginx zincirinden gelen
    CF-Connecting-IP/X-Forwarded-For basliklarindan cozulur. Origin'e
    DOGRUDAN erisen bir saldirgan bu basliklari sahteleyebilir — bilinen
    sinirlama; kalici cozum firewall'da origin'i CF IP araliklarina
    kisitlamaktir (rapor edildi)."""
    settings = get_settings()
    result = get_limiter().check(
        f"authfail:{ip or 'unknown'}",
        settings.PUBLIC_API_AUTH_FAIL_LIMIT_PER_MIN,
        60,
    )
    if not result.allowed:
        request.state.rate_limited = True
        raise PublicAPIError(
            "rate_limit_exceeded",
            "Too many failed authentication attempts. Try again later.",
            headers=rate_limit_headers(result),
        )
    raise PublicAPIError(code, message)


async def get_api_context(
    request: Request,
    db: Session = Depends(get_db),
) -> ApiContext:
    ip = client_ip(request)

    # 1) Bearer-only cikarim — cookie/query ASLA okunmaz.
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        _reject_auth(
            request,
            ip,
            "invalid_token",
            "Missing bearer token. Send 'Authorization: Bearer <token>'.",
        )
    raw = auth_header[len("Bearer "):].strip()

    # 2) Format kontrolu — hash-as-token dahil bicimsiz girdiyi erken reddet.
    if not raw.startswith(_VALID_PREFIXES) or len(raw) < 20:
        _reject_auth(request, ip, "invalid_token", "Invalid API token.")

    # 3) SHA-256 → TENANT KESFI (ayricalikli dar fonksiyon) → tenant
    #    baglami → normal RLS altinda okuma → sabit-zamanli teyit.
    settings = get_settings()
    digest = api_client_service.hash_token(raw)

    discovered = discover_tenant(db, digest, settings.PUBLIC_API_ENV)
    if discovered is None or discovered["tenant_id"] is None:
        _reject_auth(request, ip, "invalid_token", "Invalid API token.")

    # Bundan SONRAKI her sorgu bu tenant'in satirlarini gorur. Deger
    # token KAYDINDAN gelir — istemcinin gonderdigi hicbir seyden degil.
    bind_tenant(db, str(discovered["tenant_id"]))

    token, client = _lookup_token(db, digest)
    if token is None or client is None:
        _reject_auth(request, ip, "invalid_token", "Invalid API token.")
    if not api_client_service.hashes_equal(token.token_hash, digest):
        _reject_auth(request, ip, "invalid_token", "Invalid API token.")

    # 4) Token durumu.
    if token.status == "revoked":
        _reject_auth(
            request, ip, "revoked_token", "This token has been revoked."
        )
    expires = token.expires_at
    if expires is not None:
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires <= datetime.now(timezone.utc):
            _reject_auth(
                request, ip, "expired_token", "This token has expired."
            )

    # 5) Client durumu — disabled client'in TUM token'lari aninda gecersiz
    #    (amendment #3; token satirlarini tek tek degistirmek gerekmez).
    if client.status != "active":
        _reject_auth(
            request,
            ip,
            "invalid_token",
            "The API client for this token is disabled.",
        )

    # 6) Ortam eslesmesi — dev token'i live'da (ve tersi) calismaz.
    if client.environment != settings.PUBLIC_API_ENV:
        _reject_auth(
            request,
            ip,
            "invalid_token",
            "This token's environment does not match this deployment.",
        )

    # 7) Token/client rate limiti (basarili kimlik dogrulama sonrasi).
    limit = client.rate_limit_per_min or settings.PUBLIC_API_DEFAULT_RATE_LIMIT
    # Anahtar tenant'i DE tasir: token id'leri zaten benzersiz, ama
    # anahtar uzayini tenant'a gore bolmek, ileride paylasilan bir
    # limiter'a (Redis) gecildiginde capraz-tenant sayac karisimini
    # yapisal olarak imkansiz kilar.
    rate_result = get_limiter().check(
        f"tenant:{client.tenant_id}:token:{token.id}", limit, 60
    )
    request.state.rate_limit = rate_result
    if not rate_result.allowed:
        request.state.rate_limited = True
        raise PublicAPIError(
            "rate_limit_exceeded",
            "Rate limit exceeded for this token.",
            headers=rate_limit_headers(rate_result),
        )

    # 8) Baglam + throttled last-used.
    _touch_last_used(db, token, ip)

    ctx = ApiContext(
        client=client,
        token=token,
        scopes=frozenset(client.scopes or []),
    )
    # Audit / rate-limit katmanlari icin (2C) request.state'e isle.
    # Denetim kaydi tenant'i buradan alir (istekten DEGIL).
    request.state.api_tenant_id = str(client.tenant_id)
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
