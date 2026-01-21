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
