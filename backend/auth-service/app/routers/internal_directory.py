# =============================================================================
# HERMES Auth Service - Internal Directory (Stage 5B-2, onayli)
# =============================================================================
# core-service'in S2S credential'i ile cagirdigi MINIMAL profil cozumu.
#
# Sinirlar (onayli tasarim):
#   - Auth-service GORUNURLUK KARARI VERMEZ: cagiran (core) yetkili ID
#     kumesini kendisi hesaplar; burasi yalnizca ID → minimal profil
#     cozer. Genis dizin endpoint'i YALNIZCA global erisim cozumunde
#     kullanilir.
#   - Yanit yalnizca: id, display_name, work_email, is_active.
#     admin/rol/permission/hierarchy/auth-provider/parola/oturum
#     alanlari YAPISAL olarak yok.
#   - Credential: HERMES_S2S_TOKEN_CURRENT/NEXT (dual-key rotasyon),
#     yalnizca Authorization: Bearer ile; query parametresi ASLA;
#     constant-time karsilastirma; bos konfig = kapali (fail closed).
#   - Gecersiz denemeler IP basina rate-limit'lidir; sanitize audit
#     logu tutulur (token degeri/istek govdesi ASLA loglanmaz).
#   - Bu credential normal auth/user endpoint'lerinde KIMLIK DEGILDIR
#     (onlar RS256 JWT ister; testle kilitli).
# =============================================================================

import hmac
import logging
import time
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models.user import User

logger = logging.getLogger("hermes.internal_directory")

router = APIRouter(prefix="/internal/directory", tags=["Internal"])

MAX_RESOLVE_IDS = 500

# Gecersiz S2S denemeleri icin basit IP-basina sabit pencere limiti.
_FAIL_WINDOW_SECONDS = 60
_FAIL_LIMIT = 10
_fail_counts: dict = {}


def _rate_limit_failures(ip: str) -> bool:
    """True → bu IP su an engelli."""
    now = time.monotonic()
    window_start, count = _fail_counts.get(ip, (now, 0))
    if now - window_start > _FAIL_WINDOW_SECONDS:
        window_start, count = now, 0
    _fail_counts[ip] = (window_start, count)
    return count >= _FAIL_LIMIT


def _record_failure(ip: str) -> None:
    now = time.monotonic()
    window_start, count = _fail_counts.get(ip, (now, 0))
    if now - window_start > _FAIL_WINDOW_SECONDS:
        window_start, count = now, 0
    _fail_counts[ip] = (window_start, count + 1)


def require_s2s(
    request: Request,
    authorization: Optional[str] = Header(None),
) -> None:
    """S2S credential kapisi. Yanitlar bilerek tekduze: gecersiz/eksik/
    kapali hepsi 401 doner (credential varligi ifsa edilmez)."""
    ip = request.client.host if request.client else "?"
    if _rate_limit_failures(ip):
        logger.warning("s2s rate-limited ip=%s", ip)
        raise HTTPException(status_code=429, detail="Too many attempts.")

    settings = get_settings()
    provided = ""
    if authorization and authorization.lower().startswith("bearer "):
        provided = authorization[7:].strip()

    valid = False
    for candidate in (
        settings.HERMES_S2S_TOKEN_CURRENT,
        settings.HERMES_S2S_TOKEN_NEXT,
    ):
        # Bos anahtar hicbir seyi dogrulamaz (kapali = fail closed).
        if candidate and provided and hmac.compare_digest(
            provided, candidate
        ):
            valid = True
    if not valid:
        _record_failure(ip)
        logger.warning("s2s auth failed ip=%s path=%s", ip,
                       request.url.path)
        raise HTTPException(status_code=401, detail="Unauthorized.")
    # Sanitize audit: yalnizca yol + sonuc; token/govde yok.
    logger.info("s2s ok path=%s ip=%s", request.url.path, ip)


def _profile(u: User) -> dict:
    """MINIMAL sema — baska alan eklemek bilincli urun karari ister."""
    return {
        "id": str(u.id),
        "display_name": u.full_name or u.email,
        "work_email": u.email,
        "is_active": bool(u.is_active),
    }


class ResolveUsersRequest(BaseModel):
    # WS7: tenant ZORUNLU. `users` global bir tablodur; tenant filtresi
    # olmadan bu uc, herhangi bir kimligin e-postasini cozen bir dizin
    # olurdu — ve e-posta bildirimleri o cikti uzerinden gonderiliyor.
    tenant_id: UUID
    user_ids: List[UUID] = Field(..., max_length=MAX_RESOLVE_IDS)


@router.post("/users/resolve")
def resolve_users(
    payload: ResolveUsersRequest,
    _: None = Depends(require_s2s),
    db: Session = Depends(get_db),
):
    """Batch ID → minimal profil, TENANT UYELIGI ile sinirli.

    Bu tenant'in aktif uyesi OLMAYAN kimlikler yanitta YOKTUR —
    varliklari bile sizmaz. Bilinmeyen ID'ler sessizce atlanir; siralama
    girdi sirasidir.

    Yanit, cagiranin dogrulayabilmesi icin tenant'i TEKRARLAR.
    """
    if not payload.user_ids:
        return {"tenant_id": str(payload.tenant_id), "users": []}

    from ..services.membership_service import assert_user_ids_are_members

    allowed = set(assert_user_ids_are_members(
        db, tenant_id=payload.tenant_id, user_ids=payload.user_ids
    ))
    if not allowed:
        return {"tenant_id": str(payload.tenant_id), "users": []}

    rows = db.query(User).filter(User.id.in_(list(allowed))).all()
    by_id = {str(u.id): u for u in rows}
    return {
        "tenant_id": str(payload.tenant_id),
        "users": [
            _profile(by_id[str(uid)])
            for uid in payload.user_ids
            if str(uid) in by_id
        ],
    }


@router.get("/users")
def list_users_global(
    tenant_id: UUID = Query(...),
    q: Optional[str] = Query(None, min_length=2, max_length=100),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    _: None = Depends(require_s2s),
    db: Session = Depends(get_db),
):
    """Genis AKTIF dizin — YALNIZCA global-binding cozumu icin cagrilir.

    WS7: "global" artik O TENANT ICINDE global demektir (pack 09 §1).
    Sonuc, tenant'in aktif uyeleriyle sinirlidir; platform-genelinde bir
    kullanici listesi HICBIR cagirana donmez.
    """
    from ..models.tenancy import TenantMembership

    query = (
        db.query(User)
        .join(TenantMembership, TenantMembership.user_id == User.id)
        .filter(
            User.is_active.is_(True),
            TenantMembership.tenant_id == tenant_id,
            TenantMembership.status == "active",
        )
    )
    if q:
        like = f"%{q.lower()}%"
        from sqlalchemy import func, or_

        query = query.filter(
            or_(
                func.lower(User.full_name).like(like),
                func.lower(User.email).like(like),
            )
        )
    rows = (
        query.order_by(User.full_name.asc().nulls_last(), User.email.asc())
        .offset(offset)
        .limit(limit + 1)
        .all()
    )
    has_more = len(rows) > limit
    return {
        "users": [_profile(u) for u in rows[:limit]],
        "has_more": has_more,
    }
