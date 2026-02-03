# =============================================================================
# HERMES PLATFORM - Authentication Router
# =============================================================================
# Bu dosya, kimlik doğrulama endpoint'lerini tanımlar.
# Login (token alma) ve mevcut kullanıcı bilgisi endpoint'leri içerir.
#
# TAD Referansı (5.1):
# - POST /token: Kullanıcı girişi (E-posta/Şifre alır, JWT döner)
# - GET /users/me: Giriş yapmış kullanıcının bilgilerini döner
# =============================================================================

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.token import Token
from ..schemas.user import UserResponse
from ..services.auth_service import AuthService
from shared.auth import get_current_user, CurrentUser
from shared.exceptions import UnauthorizedError


# Router oluştur
router = APIRouter(
    prefix="/auth",
    tags=["Authentication"]
)


# =============================================================================
# POST /token - Login Endpoint
# =============================================================================

@router.post(
    "/token",
    response_model=Token,
    summary="Kullanıcı Girişi",
    description="E-posta ve şifre ile giriş yaparak JWT token alır."
)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
) -> Token:
    """
    Kullanıcı girişi yapar ve JWT token döner.
    
    OAuth2 password flow standardına uygun olarak, form_data.username
    alanı e-posta adresi olarak kullanılır.
    
    Args:
        form_data: OAuth2 form verisi (username=email, password)
        db: Veritabanı session'ı
    
    Returns:
        Token nesnesi (access_token, token_type, expires_in)
    
    Raises:
        HTTPException 401: E-posta veya şifre hatalıysa
    
    Örnek İstek (curl):
        curl -X POST "http://localhost:8000/api/v1/auth/token" \\
             -d "username=user@example.com&password=sifre123"
    
    Örnek Yanıt:
        {
            "access_token": "eyJhbGciOiJIUzI1NiIs...",
            "token_type": "bearer",
            "expires_in": 3600
        }
    """
    auth_service = AuthService(db)
    
    try:
        token = auth_service.authenticate(
            email=form_data.username,  # OAuth2 standardı - username = email
            password=form_data.password
        )
        return token
    except UnauthorizedError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=e.message,
            headers={"WWW-Authenticate": "Bearer"}
        )



# =============================================================================
# Microsoft SSO Endpoint
# =============================================================================

from pydantic import BaseModel

class MicrosoftLoginRequest(BaseModel):
    code: str
    redirect_uri: str

@router.post(
    "/microsoft",
    response_model=Token,
    summary="Microsoft ile Giriş Yap (SSO)",
    description="Microsoft Authorization Code'unu alır ve JWT token döner."
)
async def microsoft_login(
    login_request: MicrosoftLoginRequest,
    db: Session = Depends(get_db)
) -> Token:
    """
    Microsoft SSO akışını tamamlar.
    Frontend'den gelen 'code' parametresini kullanarak Microsoft'tan user bilgisini alır.
    """
    auth_service = AuthService(db)
    
    try:
        token = await auth_service.authenticate_microsoft(
            code=login_request.code,
            redirect_uri=login_request.redirect_uri
        )
        return token
    except UnauthorizedError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e)
        )
    except Exception as e:
        # Beklenmeyen hatalar için 400 veya 500
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"SSO Error: {str(e)}"
        )

# =============================================================================
# GET /users/me - Current User Endpoint
# =============================================================================

@router.get(
    "/users/me",
    response_model=UserResponse,
    summary="Mevcut Kullanıcı Bilgisi",
    description="Giriş yapmış kullanıcının bilgilerini döner."
)
async def get_current_user_info(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> UserResponse:
    """
    Giriş yapmış kullanıcının bilgilerini döner.
    
    Bu endpoint, JWT token'dan çıkarılan kullanıcı ID'si ile
    veritabanından güncel kullanıcı bilgilerini getirir.
    
    Args:
        current_user: Token'dan çıkarılan kullanıcı bilgisi
        db: Veritabanı session'ı
    
    Returns:
        UserResponse nesnesi
    
    Raises:
        HTTPException 401: Token geçersizse
        HTTPException 404: Kullanıcı bulunamazsa
    
    Örnek İstek:
        curl -X GET "http://localhost:8000/api/v1/auth/users/me" \\
             -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
    """
    from ..services.user_service import UserService
    from uuid import UUID
    
    user_service = UserService(db)
    user = user_service.get_by_id(UUID(current_user.id))
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Kullanıcı bulunamadı"
        )
    
    return user
