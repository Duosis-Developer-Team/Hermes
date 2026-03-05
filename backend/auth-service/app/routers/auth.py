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
#   POST /auth/logout     — Cookie temizle
#   GET  /auth/users/me   — Mevcut kullanıcı bilgisi
# =============================================================================

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..schemas.user import UserResponse
from ..services.auth_service import AuthService
from shared.auth import ACCESS_TOKEN_COOKIE_NAME, ACCESS_TOKEN_EXPIRE_MINUTES, get_current_user, CurrentUser
from shared.exceptions import UnauthorizedError

settings = get_settings()

# Router
router = APIRouter(
    prefix="/auth",
    tags=["Authentication"],
)

# Cookie güvenlik ayarları — dev ortamında secure=False yapılabilir
_COOKIE_SECURE = not settings.DEBUG       # DEBUG=True → dev HTTP; False → prod HTTPS
_COOKIE_SAMESITE = "strict"
_COOKIE_MAX_AGE = ACCESS_TOKEN_EXPIRE_MINUTES * 60  # saniye


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
    db: Session = Depends(get_db),
) -> dict:
    """
    Kimlik doğrulama başarılıysa:
      - JWT token HttpOnly cookie olarak set edilir.
      - Response body'de yalnızca kullanıcı bilgisi döner (token yok).

    Raises:
        HTTPException 401: E-posta veya şifre hatalıysa.
    """
    auth_service = AuthService(db)

    try:
        token_obj = auth_service.authenticate(
            email=form_data.username,
            password=form_data.password,
        )
    except UnauthorizedError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=e.message,
            headers={"WWW-Authenticate": "Bearer"},
        )

    _set_auth_cookie(response, token_obj.access_token)

    # Token body'de DÖNMEZ — yalnızca kullanıcı bilgisi
    return {"user": token_obj.user if hasattr(token_obj, "user") else None}


# =============================================================================
# POST /auth/microsoft — Microsoft SSO Girişi
# =============================================================================

class MicrosoftLoginRequest(BaseModel):
    code: str
    redirect_uri: str


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
) -> dict:
    """
    Microsoft SSO akışını tamamlar.

    Raises:
        HTTPException 401: SSO kimlik doğrulama başarısızsa.
        HTTPException 400: Beklenmeyen hata.
    """
    auth_service = AuthService(db)

    try:
        token_obj = await auth_service.authenticate_microsoft(
            code=login_request.code,
            redirect_uri=login_request.redirect_uri,
        )
    except UnauthorizedError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="SSO kimlik doğrulama başarısız",
        )

    _set_auth_cookie(response, token_obj.access_token)

    return {"user": token_obj.user if hasattr(token_obj, "user") else None}


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
    Cookie'yi sıfır max_age ile yeniden set ederek tarayıcıdan siler.
    """
    response.delete_cookie(
        key=ACCESS_TOKEN_COOKIE_NAME,
        path="/",
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite=_COOKIE_SAMESITE,
    )
    return {"detail": "Oturum kapatıldı"}


# =============================================================================
# GET /auth/users/me — Mevcut Kullanıcı Bilgisi
# =============================================================================

@router.get(
    "/users/me",
    response_model=UserResponse,
    summary="Mevcut Kullanıcı Bilgisi",
    description="Cookie veya Bearer token ile doğrulanmış kullanıcının bilgilerini döner.",
)
async def get_current_user_info(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserResponse:
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
            detail="Kullanıcı bulunamadı",
        )

    return user
