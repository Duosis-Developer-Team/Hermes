# =============================================================================
# HERMES PLATFORM - Authentication Service
# =============================================================================
# Bu dosya, kimlik doğrulama iş mantığını içerir. Login, token üretimi ve
# şifre doğrulama işlemleri bu servis üzerinden yönetilir.
# =============================================================================

from datetime import timedelta
from sqlalchemy.orm import Session

from ..models.user import User
from ..schemas.token import Token
from ..config import get_settings
from shared.auth import (
    verify_password,
    create_access_token,
    hash_password
)
from shared.exceptions import UnauthorizedError


class AuthService:
    """
    Kimlik doğrulama servisi.
    
    Bu servis, kullanıcı login işlemlerini ve JWT token yönetimini sağlar.
    FR 1.1 gereksinimlerini karşılar (E-posta/Şifre ile giriş).
    
    Kullanım:
        auth_service = AuthService(db_session)
        token = auth_service.authenticate("user@example.com", "password123")
    """
    
    def __init__(self, db: Session):
        """
        AuthService instance oluşturur.
        
        Args:
            db: SQLAlchemy veritabanı session'ı
        """
        self.db = db
        self.settings = get_settings()
    
    # =========================================================================
    # Authentication
    # =========================================================================
    
    def authenticate(self, email: str, password: str) -> Token:
        """
        Kullanıcıyı e-posta ve şifre ile doğrular.
        
        Args:
            email: Kullanıcı e-posta adresi
            password: Kullanıcı şifresi (plain text)
        
        Returns:
            Token nesnesi (access_token, token_type, expires_in)
        
        Raises:
            UnauthorizedError: E-posta veya şifre yanlışsa veya kullanıcı pasifse
        
        Örnek:
            try:
                token = auth_service.authenticate("user@email.com", "pass123")
                print(f"Token: {token.access_token}")
            except UnauthorizedError:
                print("Login başarısız")
        """
        # Kullanıcıyı e-posta ile bul
        user = self._get_user_by_email(email)
        
        if not user:
            # Kullanıcı bulunamadı - genel hata mesajı (güvenlik için)
            raise UnauthorizedError("E-posta veya şifre hatalı")
        
        # Kullanıcı aktif mi kontrol et
        if not user.is_active:
            raise UnauthorizedError("Bu hesap devre dışı bırakılmış")
        
        # Şifre doğrulama
        if not verify_password(password, user.hashed_password):
            raise UnauthorizedError("E-posta veya şifre hatalı")
        
        # JWT token oluştur
        access_token = self._create_token_for_user(user)
        
        return Token(
            access_token=access_token,
            token_type="bearer",
            expires_in=self.settings.JWT_EXPIRE_MINUTES * 60,  # Saniye cinsinden
            user={
                "id": str(user.id),
                "email": user.email,
                "full_name": user.full_name,
                "is_admin": user.is_admin,
                "is_active": user.is_active
            }
        )
    
    # =========================================================================
    # Private Helper Methods
    # =========================================================================
    
    def _get_user_by_email(self, email: str) -> User | None:
        """
        E-posta ile kullanıcı getirir.
        
        Args:
            email: Kullanıcı e-posta adresi
        
        Returns:
            User nesnesi veya None
        """
        return self.db.query(User).filter(User.email == email).first()
    
    def _create_token_for_user(self, user: User) -> str:
        """
        Kullanıcı için JWT token oluşturur.
        
        Token payload'ı şunları içerir:
        - user_id: Kullanıcı UUID'si
        - email: E-posta adresi
        - is_admin: Admin yetkisi
        
        Args:
            user: User nesnesi
        
        Returns:
            JWT token string
        """
        token_data = {
            "user_id": str(user.id),
            "email": user.email,
            "is_admin": user.is_admin
        }
        
        expires_delta = timedelta(minutes=self.settings.JWT_EXPIRE_MINUTES)
        
        return create_access_token(data=token_data, expires_delta=expires_delta)
    
    # =========================================================================
    # Microsoft SSO Authentication
    # =========================================================================
    
    async def authenticate_microsoft(self, code: str, redirect_uri: str) -> Token:
        """
        Microsoft Outlook hesabı ile giriş yapar.
        
        Args:
            code: Microsoft'tan dönen authorization code
            redirect_uri: Orijinal yönlendirme adresi
            
        Returns:
            Token nesnesi
        """
        import httpx
        from urllib.parse import urlparse
        from ..models.user import AuthProvider
        
        # [YÜKSEK-4] Validate Redirect URI against allowed CORS origins
        is_valid_redirect = False
        for origin in self.settings.CORS_ORIGINS:
            if redirect_uri.startswith(origin):
                is_valid_redirect = True
                break
                
        if not is_valid_redirect:
            raise UnauthorizedError("Geçersiz Yönlendirme Adresi (Redirect URI doğrulaması başarısız).")
        
        # 1. Exchange Code for Token
        token_url = f"https://login.microsoftonline.com/{self.settings.AZURE_TENANT_ID}/oauth2/v2.0/token"
        token_data = {
            "client_id": self.settings.AZURE_CLIENT_ID,
            "scope": "User.Read",
            "code": code,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
            "client_secret": self.settings.AZURE_CLIENT_SECRET
        }
        
        async with httpx.AsyncClient() as client:
            token_resp = await client.post(token_url, data=token_data)
            if token_resp.status_code != 200:
                raise UnauthorizedError(f"Microsoft Login Failed: {token_resp.text}")
            
            token_json = token_resp.json()
            access_token = token_json.get("access_token")
            
            # 2. Get User Profile from Graph API
            graph_resp = await client.get(
                "https://graph.microsoft.com/v1.0/me",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            if graph_resp.status_code != 200:
                raise UnauthorizedError("Failed to fetch Microsoft profile")
                
            ms_user = graph_resp.json()
            email = ms_user.get("mail") or ms_user.get("userPrincipalName")
            full_name = ms_user.get("displayName")
            
            if not email:
                raise UnauthorizedError("No email found in Microsoft account")
                
        # 3. Find or Create User
        user = self._get_user_by_email(email)
        
        if user:
            # Kullanıcı zaten var
            if not user.is_active:
                raise UnauthorizedError("Account is disabled")
                
            # Eğer local hesap ise microsoft provider'a çevirmek isteyebiliriz veya
            # sadece login olmasına izin verebiliriz. Şimdilik sadece login.
        else:
            # [YÜKSEK-5] Microsoft hesabı otomatik kayıt (Auto-provisioning) kısıtlaması
            allowed_domain = getattr(self.settings, "ALLOWED_EMAIL_DOMAIN", "").strip()
            if allowed_domain and not email.lower().endswith(f"@{allowed_domain.lower()}"):
                raise UnauthorizedError(f"Yalnızca @{allowed_domain} uzantılı kurumsal e-postalar sisteme giriş yapabilir.")
            
            # Yeni kullanıcı oluştur (Auto-provisioning)
            user = User(
                email=email,
                full_name=full_name,
                hashed_password="", # SSO kullanıcıları için boş
                is_active=True,
                is_admin=False, # Varsayılan olarak standart kullanıcı
                auth_provider=AuthProvider.MICROSOFT
            )
            self.db.add(user)
            self.db.commit()
            self.db.refresh(user)
            
        # 4. Generate Local JWT
        jwt = self._create_token_for_user(user)
        
        return Token(
            access_token=jwt,
            token_type="bearer",
            expires_in=self.settings.JWT_EXPIRE_MINUTES * 60,
            user={
                "id": str(user.id),
                "email": user.email,
                "full_name": user.full_name,
                "is_admin": user.is_admin,
                "is_active": user.is_active
            }
        )
    
    # =========================================================================
    # Password Management
    # =========================================================================
    
    def change_password(
        self,
        user: User,
        current_password: str,
        new_password: str
    ) -> bool:
        """
        Kullanıcı şifresini değiştirir.
        
        Args:
            user: User nesnesi
            current_password: Mevcut şifre
            new_password: Yeni şifre
        
        Returns:
            True (başarılı)
        
        Raises:
            UnauthorizedError: Mevcut şifre yanlışsa
        """
        # Mevcut şifreyi doğrula
        if not verify_password(current_password, user.hashed_password):
            raise UnauthorizedError("Mevcut şifre hatalı")
        
        # Yeni şifreyi hash'le ve kaydet
        user.hashed_password = hash_password(new_password)
        self.db.commit()
        
        return True
