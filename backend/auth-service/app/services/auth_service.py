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
    TENANT_AUDIENCE,
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
    
    def authenticate(self, email: str, password: str, *, tenant) -> Token:
        """
        Kullanıcıyı e-posta ve şifre ile, BELIRLI BIR TENANT icinde doğrular.

        Args:
            email: Kullanıcı e-posta adresi
            password: Kullanıcı şifresi (plain text)
            tenant: Istekten SUNUCU TARAFINDA cozulmus ResolvedTenant.
                Istemci govdesinden gelen hicbir tenant degeri kabul
                EDILMEZ (aksi halde kullanici hedef organizasyonu kendi
                secebilirdi).

        Returns:
            Token nesnesi (access_token, token_type, expires_in)

        Raises:
            UnauthorizedError: E-posta/sifre yanlissa, kullanici pasifse
                VEYA bu tenant'ta aktif uyeligi yoksa.

        Numaralandirma karsiti: dort basarisizlik da AYNI mesaji doner —
        aksi halde login ucu "bu e-posta bu sirkette var mi?" sorusuna
        cevap veren bir oracle olurdu.
        """
        from . import membership_service

        generic_failure = "E-posta veya şifre hatalı"

        # Kullanıcıyı e-posta ile bul
        user = self._get_user_by_email(email)

        if not user:
            raise UnauthorizedError(generic_failure)

        # Kullanıcı aktif mi kontrol et
        if not user.is_active:
            raise UnauthorizedError(generic_failure)

        # Şifre doğrulama
        if not verify_password(password, user.hashed_password):
            raise UnauthorizedError(generic_failure)

        # Bu TENANT'ta aktif uyelik sart. Global kimligin var olmasi
        # tek basina hicbir organizasyona erisim vermez.
        membership = membership_service.get_active_membership(
            self.db, tenant_id=tenant.id, user_id=user.id
        )
        if membership is None:
            raise UnauthorizedError(generic_failure)

        access_token = self._create_token_for_user(
            user, tenant=tenant, membership=membership, auth_method="local"
        )

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
            },
            tenant={
                "id": tenant.id,
                "slug": tenant.slug,
                "display_name": tenant.display_name,
            },
            membership={
                "id": str(membership.id),
                "status": membership.status,
            },
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
    
    def _create_token_for_user(
        self, user: User, *, tenant, membership, auth_method: str = "local"
    ) -> str:
        """
        Kullanıcı için TENANT-SCOPED JWT token oluşturur.

        Token payload'ı şunları içerir:
        - user_id, email
        - tenant_id, membership_id  (WS3 — dogrulanmis baglam)
        - is_admin: YALNIZCA gecis donemi uyumlulugu; hicbir yetki
          karari bunu okumaz (izinler auth DB'sinden cozulur).

        `aud=hermes-tenant` damgasi shared/auth.py tarafindan basilir;
        platform oturumlari bu token'i KABUL ETMEZ.

        Args:
            user: User nesnesi
            tenant: ResolvedTenant (sunucu tarafinda cozulmus)
            membership: TenantMembership (aktif oldugu dogrulanmis)
            auth_method: local | microsoft

        Returns:
            JWT token string
        """
        token_data = {
            "user_id": str(user.id),
            "email": user.email,
            "is_admin": user.is_admin,
            "tenant_id": str(tenant.id),
            "membership_id": str(membership.id),
            "auth_method": auth_method,
        }

        expires_delta = timedelta(minutes=self.settings.JWT_EXPIRE_MINUTES)

        return create_access_token(
            data=token_data,
            expires_delta=expires_delta,
            audience=TENANT_AUDIENCE,
        )
    
    # =========================================================================
    # Microsoft SSO Authentication
    # =========================================================================
    
    async def authenticate_microsoft(
        self, code: str, redirect_uri: str, *, tenant
    ) -> Token:
        """
        Microsoft hesabı ile BELIRLI BIR TENANT icinde giriş yapar.

        Args:
            code: Microsoft'tan dönen authorization code
            redirect_uri: Orijinal yönlendirme adresi
            tenant: Sunucu tarafinda cozulmus ResolvedTenant

        Returns:
            Token nesnesi

        WS3 degisiklikleri:
          - Kimlik dogrulandiktan SONRA bu tenant'ta aktif uyelik aranir;
            yoksa giris reddedilir. Bir Entra dizininde hesabi olmak,
            Hermes'te bir organizasyona uye olmak DEMEK DEGILDIR.
          - Otomatik hesap acma (auto-provisioning) KALDIRILDI. Tenant
            bazli auto-provision politikasi `tenant_identity_providers`
            tablosunda yasar ve varsayilani 'disabled'dir; e-posta alan
            adina bakip kullanici yaratmak, alan adini yetki kaynagi
            saymak olurdu.
        """
        import httpx
        from ..models.user import AuthProvider
        from . import membership_service

        # [YÜKSEK-4] Redirect URI dogrulamasi — TAM eslesme.
        # `startswith` yetersizdi: "https://hermes.duosis.com.evil.tr"
        # gibi bir adres izinli origin ile basliyor gorunur.
        allowed_origins = {o.rstrip("/") for o in self.settings.CORS_ORIGINS}
        parsed = httpx.URL(redirect_uri)
        origin = f"{parsed.scheme}://{parsed.netloc.decode()}"
        if origin not in allowed_origins:
            raise UnauthorizedError(
                "Geçersiz Yönlendirme Adresi (Redirect URI doğrulaması başarısız)."
            )
        
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
                
        # 3. Kimligi bul — YARATMA.
        generic_failure = "Bu organizasyona erişiminiz bulunmuyor."
        user = self._get_user_by_email(email)

        if user is None or not user.is_active:
            raise UnauthorizedError(generic_failure)

        # 4. Bu tenant'ta AKTIF uyelik sart.
        membership = membership_service.get_active_membership(
            self.db, tenant_id=tenant.id, user_id=user.id
        )
        if membership is None:
            raise UnauthorizedError(generic_failure)

        # 5. Tenant-scoped JWT
        jwt = self._create_token_for_user(
            user, tenant=tenant, membership=membership,
            auth_method="microsoft",
        )

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
            },
            tenant={
                "id": tenant.id,
                "slug": tenant.slug,
                "display_name": tenant.display_name,
            },
            membership={
                "id": str(membership.id),
                "status": membership.status,
            },
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
