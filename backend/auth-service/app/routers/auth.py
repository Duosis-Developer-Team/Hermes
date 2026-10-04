# =============================================================================
# HERMES PLATFORM - Authentication Router
# =============================================================================
# [KRİTİK-2] Token üretimi RS256 private key ile yapılır.
# [KRİTİK-6] Token response body'de dönmez; HttpOnly + Secure + SameSite=strict
#             cookie olarak set edilir.
#
# Endpoint'ler:
#   POST /auth/token      — E-posta/şifre girişi → cookie set
#   POST /auth/microsoft  — SSO akışı → cookie set
#   POST /auth/session/refresh — Yenileme cerezi ile oturumu kaydir
#   POST /auth/logout     — Cookie temizle
#   GET  /auth/users/me   — Mevcut kullanıcı bilgisi
# =============================================================================

from fastapi import (
    APIRouter, Depends, Form, HTTPException, Request, Response, status,
)
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..schemas.user import UserResponse
from ..services.auth_service import AuthService
from ..services.tenant_resolver import (
    ResolvedTenant,
    WorkspaceNotFound,
    WorkspaceUnavailable,
    resolve_request_tenant,
)
from shared.auth import (
    ACCESS_TOKEN_COOKIE_NAME,
    ACCESS_TOKEN_EXPIRE_MINUTES,
    REFRESH_TOKEN_COOKIE_NAME,
    CurrentUser,
    get_current_user,
    verify_refresh_token,
)
from shared.exceptions import UnauthorizedError

settings = get_settings()

# Router
router = APIRouter(
    prefix="/auth",
    tags=["Authentication"],
)

# Cookie güvenlik ayarları — dev ortamında secure=False yapılabilir
_COOKIE_SECURE = not settings.DEBUG       # DEBUG=True → dev HTTP; False → prod HTTPS
_COOKIE_SAMESITE = "lax"                  # Strict'ten kaynaklı port-farkı cookie droplarını çözmek için lax (HTTP Only koruması sürer)
# Erisim cerezi: JWT `exp` ile AYNI kaynak (shared/auth.py).
_COOKIE_MAX_AGE = ACCESS_TOKEN_EXPIRE_MINUTES * 60  # saniye

# Yenileme cerezi YALNIZCA auth API yoluna gider: core/reporting ve
# statik dosya istekleri onu hic tasimaz. /auth altinda tutulur cunku
# refresh disinda switch-tenant (yeni tenant'a tasima) ve logout
# (silme) da onu gormelidir.
REFRESH_COOKIE_PATH = "/api/v1/auth"


def _set_auth_cookie(response: Response, access_token: str) -> None:
    """
    HttpOnly JWT cookie'yi response'a ekler.

    Özellikler:
      httponly=True  → JavaScript erişimini engeller (XSS koruması)
      secure=True    → Yalnızca HTTPS üzerinden gönderilir (prod)
      samesite=strict → CSRF saldırılarını engeller
      path="/"       → Tüm endpoint'lere gönderilir
    """
    response.set_cookie(
        key=ACCESS_TOKEN_COOKIE_NAME,
        value=access_token,
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite=_COOKIE_SAMESITE,
        max_age=_COOKIE_MAX_AGE,
        path="/",
    )


def _set_refresh_cookie(
    response: Response, refresh_token: str, *, remember: bool
) -> None:
    """HttpOnly yenileme cerezi - omru 1 gun ya da (acik tut) 30 gun.

    Kayan oturum: her basarili yenilemede bastan yazilir, yani sure
    SON KULLANIMDAN itibaren isler.
    """
    days = (
        settings.REFRESH_TOKEN_REMEMBER_DAYS if remember
        else settings.REFRESH_TOKEN_DAYS
    )
    response.set_cookie(
        key=REFRESH_TOKEN_COOKIE_NAME,
        value=refresh_token,
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite=_COOKIE_SAMESITE,
        max_age=int(days) * 24 * 60 * 60,
        path=REFRESH_COOKIE_PATH,
    )


def _set_session_cookies(response: Response, token_obj) -> None:
    """Giris/yenileme sonrasi IKI cerezi birlikte yazar."""
    _set_auth_cookie(response, token_obj.access_token)
    if token_obj.refresh_token:
        _set_refresh_cookie(
            response, token_obj.refresh_token, remember=token_obj.remember
        )


def _clear_session_cookies(response: Response) -> None:
    """Erisim + yenileme cerezlerini siler (logout / basarisiz yenileme)."""
    response.delete_cookie(
        key=ACCESS_TOKEN_COOKIE_NAME,
        path="/",
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite=_COOKIE_SAMESITE,
    )
    response.delete_cookie(
        key=REFRESH_TOKEN_COOKIE_NAME,
        path=REFRESH_COOKIE_PATH,
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite=_COOKIE_SAMESITE,
    )


# =============================================================================
# Tenant baglami — kimlik dogrulamadan ONCE, YALNIZCA sunucu tarafinda
# =============================================================================

def _request_hostname(request: Request) -> str:
    """Istegin gercek hostname'i.

    Ters proxy arkasinda `Host` basligi ingress tarafindan set edilir.
    `X-Forwarded-Host` BILEREK okunmaz: istemci tarafindan uydurulabilir
    ve tenant secimini istemciye devretmek olurdu. Ingress'in guvenilir
    Host basligi tek kaynaktir.
    """
    return request.headers.get("host") or (request.url.hostname or "")


def tenant_context(
    request: Request,
    db: Session = Depends(get_db),
) -> ResolvedTenant:
    """Istek icin tenant baglamini cozen dependency.

    Bilinmeyen host → 404 `workspace_not_found` (tenant varligini
    sizdirmaz). Askiya alinmis tenant → 423 `workspace_unavailable`.
    """
    # Dev/test kolayligi: yalnizca HERMES_ALLOW_WORKSPACE_PATH acikken.
    workspace_slug = request.query_params.get("workspace")
    try:
        return resolve_request_tenant(
            db,
            hostname=_request_hostname(request),
            workspace_slug=workspace_slug,
        )
    except WorkspaceUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail={
                "code": "workspace_unavailable",
                "message": "This workspace is currently unavailable.",
                "status": exc.status,
            },
        )
    except WorkspaceNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "workspace_not_found",
                "message": "No workspace is configured for this address.",
            },
        )


# =============================================================================
# GET /auth/workspace — Giris ekrani icin GUVENLI tenant ozeti
# =============================================================================

@router.get(
    "/workspace",
    summary="Adres icin workspace bilgisi",
    description=(
        "Giris ekraninin hangi organizasyona ait oldugunu gosterebilmesi "
        "icin gereken GUVENLI alanlari doner. Tenant UUID'si, plan "
        "limitleri veya kullanici varligi DONMEZ."
    ),
)
async def get_workspace(
    tenant: ResolvedTenant = Depends(tenant_context),
) -> dict:
    return {
        "workspace": {
            "slug": tenant.slug,
            "display_name": tenant.display_name,
            "status": tenant.status,
            # v1: yerel giris her zaman acik; tenant IdP baglantisi
            # eklendiginde bu liste o tenant'in ayarindan gelir.
            "login_methods": ["local"],
        }
    }


# =============================================================================
# POST /auth/token — E-posta / Şifre Girişi
# =============================================================================

@router.post(
    "/token",
    summary="Kullanıcı Girişi",
    description=(
        "E-posta ve şifre ile giriş yapar. "
        "Token response body'de dönmez; HttpOnly cookie olarak set edilir."
    ),
    status_code=status.HTTP_200_OK,
)
async def login(
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    remember: bool = Form(False),
    db: Session = Depends(get_db),
    tenant: ResolvedTenant = Depends(tenant_context),
) -> dict:
    """
    Kimlik doğrulama başarılıysa:
      - TENANT-SCOPED JWT token HttpOnly cookie olarak set edilir.
      - Response body'de kullanici + organizasyon ozeti döner (token yok).

    Tenant, istek govdesinden DEGIL, dogrulanmis host'tan cozulur.
    Istek govdesi bir tenant kimligi tasisa bile yok sayilir.

    Raises:
        HTTPException 401: E-posta/sifre hatali VEYA bu organizasyonda
            aktif uyelik yoksa (ayni yanit — numaralandirma yok).
        HTTPException 404/423: Adres bir workspace'e cozulmuyorsa /
            workspace kullanilabilir degilse.
    """
    auth_service = AuthService(db)

    try:
        token_obj = auth_service.authenticate(
            email=form_data.username,
            password=form_data.password,
            tenant=tenant,
            remember=remember,
        )
    except UnauthorizedError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=e.message,
            headers={"WWW-Authenticate": "Bearer"},
        )

    _set_session_cookies(response, token_obj)

    # Token body'de DÖNMEZ — yalnızca kullanıcı + organizasyon ozeti
    return {
        "user": token_obj.user,
        "tenant": token_obj.tenant,
        "membership": token_obj.membership,
    }


# =============================================================================
# POST /auth/microsoft — Microsoft SSO Girişi
# =============================================================================

class MicrosoftLoginRequest(BaseModel):
    code: str
    redirect_uri: str
    # "Oturumu acik tut" - giris ekranindaki secim OAuth `state` ile
    # Microsoft'tan geri doner; eski istemciler gondermezse 1 gun.
    remember: bool = False


@router.post(
    "/microsoft",
    summary="Microsoft ile Giriş Yap (SSO)",
    description=(
        "Microsoft Authorization Code'unu kullanarak kimlik doğrular. "
        "Token HttpOnly cookie olarak set edilir."
    ),
    status_code=status.HTTP_200_OK,
)
async def microsoft_login(
    response: Response,
    login_request: MicrosoftLoginRequest,
    db: Session = Depends(get_db),
    tenant: ResolvedTenant = Depends(tenant_context),
) -> dict:
    """
    Microsoft SSO akışını tamamlar — cozulmus tenant baglaminda.

    Raises:
        HTTPException 401: SSO kimlik dogrulama basarisizsa VEYA bu
            organizasyonda aktif uyelik yoksa.
        HTTPException 400: Beklenmeyen hata.
    """
    auth_service = AuthService(db)

    try:
        token_obj = await auth_service.authenticate_microsoft(
            code=login_request.code,
            redirect_uri=login_request.redirect_uri,
            tenant=tenant,
            remember=login_request.remember,
        )
    except UnauthorizedError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="SSO authentication failed",
        )

    _set_session_cookies(response, token_obj)

    return {
        "user": token_obj.user,
        "tenant": token_obj.tenant,
        "membership": token_obj.membership,
    }


# =============================================================================
# POST /auth/session/refresh - Kayan oturum
# =============================================================================

@router.post(
    "/session/refresh",
    summary="Oturumu yenile",
    description=(
        "Yenileme cerezi (HttpOnly) ile yeni bir erisim cerezi ve yeni bir "
        "yenileme cerezi yazar. Erisim cerezi GEREKMEZ. Basarisizlikta 401 "
        "doner ve iki cerez de silinir."
    ),
    status_code=status.HTTP_200_OK,
)
async def refresh_session(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """Kullanici aktifligi, uyelik, tenant durumu ve session_version her
    cagrida CANLI kontrol edilir - durumsuz token'in iptal yolu budur.

    Tenant istekten (host / ?workspace) DEGIL, imzali yenileme
    token'indan gelir: oturum hangi organizasyonda acildiysa orada surer
    (switch-tenant yenileme cerezini de yeni tenant'a tasir).
    """
    token = request.cookies.get(REFRESH_TOKEN_COOKIE_NAME)
    try:
        if not token:
            raise UnauthorizedError("Authentication required")
        token_obj = AuthService(db).refresh_session(token)
    except UnauthorizedError:
        # Hangi kontrolun dustugu SIZDIRILMAZ; iki cerez de silinir ki
        # istemci olu bir yenileme cereziyle donguye girmesin.
        failed = JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": "Authentication required"},
        )
        _clear_session_cookies(failed)
        return failed

    _set_session_cookies(response, token_obj)
    return {
        "user": token_obj.user,
        "tenant": token_obj.tenant,
        "membership": token_obj.membership,
        "remember": token_obj.remember,
    }


# =============================================================================
# POST /auth/logout — Oturumu Kapat
# =============================================================================

@router.post(
    "/logout",
    summary="Oturumu Kapat",
    description="HttpOnly cookie'yi silerek oturumu kapatır.",
    status_code=status.HTTP_200_OK,
)
async def logout(response: Response) -> dict:
    """
    Erisim VE yenileme cerezlerini sifir max_age ile yeniden set ederek
    tarayicidan siler. Platform oturumu (ayri cerez) etkilenmez.
    """
    _clear_session_cookies(response)
    return {"detail": "Signed out"}


# =============================================================================
# GET /auth/memberships — Organizasyon secici
# =============================================================================

@router.get(
    "/memberships",
    summary="Gecis yapilabilir organizasyonlar",
    description=(
        "Mevcut kimligin AKTIF uyeligi olan ve kullanilabilir durumdaki "
        "organizasyonlari doner. Baska hicbir tenant bilgisi sizmaz."
    ),
)
async def list_memberships(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    from uuid import UUID

    from ..services import membership_service

    return {
        "memberships": membership_service.list_switchable_memberships(
            db, user_id=UUID(current_user.id)
        )
    }


# =============================================================================
# POST /auth/switch-tenant — Oturumu baska organizasyona tasi
# =============================================================================

class SwitchTenantRequest(BaseModel):
    tenant_id: str


@router.post(
    "/switch-tenant",
    summary="Organizasyon degistir",
    description=(
        "Govdedeki tenant_id bir TALEPTIR, otorite degildir: sunucu "
        "uyeligi ve tenant durumunu yeniden dogrular, ardindan yeni bir "
        "tenant-scoped oturum cerezi yazar."
    ),
)
async def switch_tenant(
    request: Request,
    response: Response,
    payload: SwitchTenantRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    from uuid import UUID

    from ..models.tenancy import Tenant
    from ..services import membership_service
    from ..services.tenant_resolver import USABLE_STATUSES, ResolvedTenant
    from ..services.user_service import UserService

    try:
        target_id = UUID(payload.tenant_id)
    except (ValueError, TypeError):
        # Bozuk UUID ile "uye degilim" AYNI yaniti alir.
        raise HTTPException(status_code=404, detail={
            "code": "membership_required",
            "message": "Workspace not available for this account.",
        })

    membership = membership_service.get_active_membership(
        db, tenant_id=target_id, user_id=UUID(current_user.id)
    )
    tenant_row = db.query(Tenant).filter(Tenant.id == target_id).first()

    # Uyelik yoksa VEYA tenant kullanilamiyorsa ayni 404: kullanici,
    # uyesi olmadigi bir organizasyonun VARLIGINI ogrenemez.
    if membership is None or tenant_row is None:
        raise HTTPException(status_code=404, detail={
            "code": "membership_required",
            "message": "Workspace not available for this account.",
        })
    if tenant_row.status not in USABLE_STATUSES:
        raise HTTPException(status_code=423, detail={
            "code": "workspace_unavailable",
            "message": "This workspace is currently unavailable.",
        })

    user = UserService(db).get_by_id(UUID(current_user.id))
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Authentication required")

    resolved = ResolvedTenant(
        id=str(tenant_row.id),
        slug=tenant_row.slug,
        display_name=tenant_row.display_name,
        status=tenant_row.status,
    )
    auth_service = AuthService(db)
    token = auth_service._create_token_for_user(
        user, tenant=resolved, membership=membership,
        auth_method=current_user.auth_method,
    )
    _set_auth_cookie(response, token)

    # Kayan oturum yeni tenant'a TASINIR; aksi halde bir sonraki
    # yenileme oturumu eski organizasyona geri dondururdu. "Acik tut"
    # secimi mevcut (ayni kullaniciya ait, gecerli) yenileme cerezinden
    # devralinir. Destek oturumu yenileme cerezi ALMAZ.
    if current_user.auth_method in ("local", "microsoft"):
        remember = False
        existing = request.cookies.get(REFRESH_TOKEN_COOKIE_NAME)
        if existing:
            try:
                prev = verify_refresh_token(existing)
                if prev.get("sub") == str(user.id):
                    remember = bool(prev.get("rmb"))
            except UnauthorizedError:
                pass
        _set_refresh_cookie(
            response,
            auth_service._create_refresh_token_for_user(
                user, tenant_id=resolved.id, membership_id=membership.id,
                auth_method=current_user.auth_method, remember=remember,
            ),
            remember=remember,
        )

    return {
        "tenant": {
            "id": resolved.id,
            "slug": resolved.slug,
            "display_name": resolved.display_name,
        },
        "membership": {
            "id": str(membership.id),
            "status": membership.status,
        },
    }


# =============================================================================
# GET /auth/users/me — Mevcut Kullanıcı Bilgisi
# =============================================================================

@router.get(
    "/users/me",
    summary="Mevcut Kullanıcı Bilgisi",
    description="Cookie veya Bearer token ile doğrulanmış kullanıcının bilgilerini döner.",
)
async def get_current_user_info(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """
    JWT token'dan (cookie veya Bearer) çıkarılan kullanıcı ID'si ile
    veritabanından güncel kullanıcı bilgilerini getirir.

    Raises:
        HTTPException 401: Token geçersizse.
        HTTPException 404: Kullanıcı bulunamazsa.
    """
    from ..services.user_service import UserService
    from uuid import UUID

    user_service = UserService(db)
    user = user_service.get_by_id(UUID(current_user.id))

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # WS8: sayfa yenilemesinde oturum geri yuklenirken TENANT da geri
    # gelmeli. Aksi halde frontend ilk istekleri "anonim" query
    # kapsaminda cache'ler ve tenant sonradan gelince ayni veriyi ikinci
    # kez ceker. Tenant dogrulanmis token'dan okunur — istekten degil.
    from ..models.tenancy import Tenant

    payload = UserResponse.model_validate(user).model_dump()
    tenant_row = (
        db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    )
    payload["tenant"] = (
        {
            "id": str(tenant_row.id),
            "slug": tenant_row.slug,
            "display_name": tenant_row.display_name,
        }
        if tenant_row is not None
        else None
    )
    payload["membership_id"] = current_user.membership_id

    # Profil fotografi (ADDITIVE): kendi fotografi her zaman gorunur.
    from ..services.user_photo_service import photo_meta_for

    photo_etags = photo_meta_for(
        db,
        caller_id=current_user.id,
        tenant_id=current_user.tenant_id,
        user_ids=[user.id],
    )
    payload["has_photo"] = str(user.id) in photo_etags
    payload["photo_etag"] = photo_etags.get(str(user.id))
    return payload
