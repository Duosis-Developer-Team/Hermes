# =============================================================================
# HERMES PLATFORM - JWT Authentication & Authorization
# =============================================================================
# [KRİTİK-2] RS256 asimetrik JWT mimarisi:
#   - auth-service: JWT_PRIVATE_KEY ile TOKEN ÜRETIR (imzalar)
#   - core-service / reporting-service: JWT_PUBLIC_KEY ile DOĞRULAR ONLY
#
# [KRİTİK-6] Token taşıma: HttpOnly + Secure + SameSite=strict cookie
#   Öncelik: 1) HttpOnly cookie  2) Bearer header (Swagger UI / servisler arası)
# =============================================================================

import os
import sys
import uuid
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any

from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel

from .exceptions import UnauthorizedError, ForbiddenError

logger = logging.getLogger(__name__)

# =============================================================================
# Configuration — RS256 Asimetrik Anahtar Yükleme
# =============================================================================
#
# K8s secret'lar dosya olarak mount edilir; içerik env variable olarak okunur.
# Dosya yolu veya doğrudan PEM string her ikisi de desteklenir.
#
# auth-service Deployment'ında:
#   JWT_PRIVATE_KEY → hermes-jwt-auth secret'ından (private + public)
#   JWT_PUBLIC_KEY  → hermes-jwt-auth secret'ından
#
# core/reporting Deployment'larında:
#   JWT_PUBLIC_KEY  → hermes-jwt-public secret'ından (yalnızca public)
#   JWT_PRIVATE_KEY → TANIMLI DEĞİL (kasıtlı)
# =============================================================================

ALGORITHM = "RS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "60"))

# Cookie adı — tüm servisler ve frontend'de tutarlı
ACCESS_TOKEN_COOKIE_NAME = "access_token"

# =============================================================================
# WS3 — Audience ayrimi (tenant duzlemi vs platform duzlemi)
# =============================================================================
# Iki AYRI guvenlik duzlemi vardir ve token'lari BIRBIRINI KABUL ETMEZ:
#
#   aud=hermes-tenant         → normal Hermes uygulamasi (bir tenant'in
#                               icinde). tenant_id + membership_id tasir.
#   aud=hermes-platform-admin → Platform Super Admin Console. Tenant'i
#                               YOKTUR; tenant API'lerinde gecersizdir.
#
# Neden zorunlu: tenant yoneticisi ile SaaS operatoru ayri duzlemlerdir.
# Audience olmadan, platform oturumu tenant uclarinda (veya tersi)
# sessizce calisir; bu da "gorunmez god mode" demektir.
#
# Audience'siz (cutover ONCESI uretilmis) token'lar GECERSIZDIR. Bilerek:
# "gecici" bir tenant'siz mod acik birakilirsa cutover'dan sonra da
# ulasilabilir kalir (17_RISK_REGISTER §2).
TENANT_AUDIENCE = "hermes-tenant"
PLATFORM_AUDIENCE = "hermes-platform-admin"

# Platform oturumu AYRI cookie tasir: tenant cookie'si silinince platform
# oturumu dusmez ve tersi de gecerli degildir.
PLATFORM_SESSION_COOKIE_NAME = "hermes_platform_session"

# Ortam bazli issuer — dev'de uretilmis bir token test'te gecerli olmasin.
JWT_ISSUER = os.getenv("HERMES_JWT_ISSUER", "hermes")


def _load_pem_key(env_var: str) -> Optional[str]:
    """
    Ortam değişkeninden PEM anahtar içeriğini yükler.

    K8s'te secret'lar dosya olarak mount edilebilir. Bu durumda env variable
    dosya yolunu içerir. Alternatif olarak doğrudan PEM string'i olabilir
    (literal '\\n' karakterleri normalize edilir).
    """
    raw = os.getenv(env_var)
    if not raw:
        return None
    raw = raw.strip()
    if raw.startswith("/") or raw.startswith("./"):
        try:
            with open(raw, "r") as f:
                return f.read().strip()
        except OSError as exc:
            print(
                f"FATAL: {env_var} dosyası okunamadı: {exc}",
                file=sys.stderr,
                flush=True,
            )
            sys.exit(1)
    # Düz PEM string — literal \n → gerçek newline
    return raw.replace("\\n", "\n")


# Token imzalama anahtarı — YALNIZCA auth-service'te tanımlı
SIGNING_KEY: Optional[str] = _load_pem_key("JWT_PRIVATE_KEY")

# Token doğrulama anahtarı — TÜM servislerde zorunlu
VERIFY_KEY: Optional[str] = _load_pem_key("JWT_PUBLIC_KEY")

if not VERIFY_KEY:
    print(
        "FATAL: JWT_PUBLIC_KEY ortam değişkeni tanımlı değil. "
        "Uygulama güvenli biçimde başlatılamıyor.",
        file=sys.stderr,
        flush=True,
    )
    sys.exit(1)

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# OAuth2 Bearer şeması — Swagger UI ve servisler arası çağrılar için
# auto_error=False: token bulunamazsa exception değil None döner (cookie'ye düşer)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token", auto_error=False)


# =============================================================================
# Token Data Models
# =============================================================================

class TokenData(BaseModel):
    """JWT token'dan çıkarılan kullanıcı bilgileri."""
    user_id: str
    email: str
    is_admin: bool = False
    exp: Optional[datetime] = None
    # WS3 — tenant baglami. Tenant audience'li token'larda ZORUNLU;
    # platform audience'li token'larda YOKTUR.
    tenant_id: Optional[str] = None
    membership_id: Optional[str] = None
    audience: Optional[str] = None
    auth_method: str = "local"
    jti: Optional[str] = None
    # Destek oturumu (Platform Admin'in sureli, denetlenen erisimi).
    # Bos ise normal kullanici oturumudur.
    support_grant_id: Optional[str] = None
    support_mode: Optional[str] = None


class CurrentUser(BaseModel):
    """Aktif kullanıcı bilgilerini taşıyan model.

    RBAC R2 notu: `is_admin` claim'i YALNIZCA gecis-donemi uyumlulugu
    icin tasinir; RBAC karar noktalari onu OKUMAZ (izinler auth-service
    DB'sinden cozulur). `allow_rbac_resolution=False`, public-API'nin
    sentezlenmis aktorleri icindir: bu aktorler icin izin cozumu HIC
    yapilmaz ve her izin kontrolu False doner — bagli kullanicinin RBAC
    yetkileri API token'i uzerinden YAPISAL olarak sizamaz.

    WS3: `tenant_id` artik her tenant istegi icin ZORUNLUDUR. Opsiyonel
    tenant filtreleme (`if tenant_id: ...`) YASAKTIR — tenant baglami
    yoksa istek zaten buraya ulasmamalidir.
    """
    id: str
    email: str
    is_admin: bool = False
    allow_rbac_resolution: bool = True
    # Dogrulanmis token'dan gelir; istek govdesinden/basligindan ASLA.
    tenant_id: str
    membership_id: Optional[str] = None
    auth_method: str = "local"
    # Destek oturumu baglami — salt-okunur destek yazma yapamaz.
    support_grant_id: Optional[str] = None
    support_mode: Optional[str] = None

    @property
    def is_support_session(self) -> bool:
        return self.support_grant_id is not None

    @property
    def is_read_only(self) -> bool:
        """Salt-okunur destek oturumu mu? (yazma dependency'leri bakar)"""
        return self.support_mode == "read_only"


class PlatformPrincipal(BaseModel):
    """Platform Super Admin oturumu — tenant'i YOKTUR.

    Bu nesne tenant veri yollarinda KULLANILAMAZ: tenant dependency'leri
    yalnizca `CurrentUser` uretir ve o da tenant audience'i ister.
    Platform admini bir tenant'in is verisine ancak sureli/denetlenen
    bir destek izni (support grant) ile, TENANT audience'li ayri bir
    oturum uzerinden erisir.
    """
    id: str
    email: str
    permissions: tuple = ()
    jti: Optional[str] = None


# =============================================================================
# Password Hashing
# =============================================================================

def hash_password(password: str) -> str:
    """Şifreyi bcrypt ile hash'ler."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Plain text şifreyi hash ile karşılaştırır."""
    return pwd_context.verify(plain_password, hashed_password)


# =============================================================================
# JWT Token Operations
# =============================================================================

def create_access_token(
    data: Dict[str, Any],
    expires_delta: Optional[timedelta] = None,
    *,
    audience: str,
) -> str:
    """
    RS256 private key ile imzalanmış JWT access token oluşturur.

    YALNIZCA auth-service bu fonksiyonu çağırabilir.
    Diğer servisler JWT_PRIVATE_KEY'e sahip olmadığından RuntimeError alır.

    Args:
        data: Zorunlu: user_id, email. Tenant token'lari icin ayrica
            tenant_id ve membership_id.
        expires_delta: Token geçerlilik süresi.
        audience: TENANT_AUDIENCE veya PLATFORM_AUDIENCE. ZORUNLUDUR —
            varsayilani yoktur, cunku "hangi duzlem" sorusu her token
            uretiminde bilincli bir karar olmalidir.

    Returns:
        RS256 imzalı JWT string.

    Raises:
        RuntimeError: JWT_PRIVATE_KEY bu serviste tanımlı değilse.
        ValueError: audience taninmiyorsa veya tenant token'i tenant
            baglami tasimiyorsa.
    """
    if not SIGNING_KEY:
        raise RuntimeError(
            "create_access_token yalnızca auth-service içinde çağrılabilir. "
            "JWT_PRIVATE_KEY bu serviste tanımlı değil."
        )
    if audience not in (TENANT_AUDIENCE, PLATFORM_AUDIENCE):
        raise ValueError(f"Bilinmeyen audience: {audience}")

    to_encode = data.copy()

    # Tenant token'i tenant baglami OLMADAN uretilemez. Bu kontrol
    # olmasaydi, bir kod yolu yanlislikla tenant'siz bir tenant token'i
    # uretebilir ve asagi akista "tenant yok = tum tenant'lar" gibi
    # yorumlanabilirdi.
    if audience == TENANT_AUDIENCE:
        if not to_encode.get("tenant_id"):
            raise ValueError(
                "Tenant token'i tenant_id claim'i olmadan uretilemez"
            )
    else:
        # Platform token'i tenant baglami TASIMAZ.
        to_encode.pop("tenant_id", None)
        to_encode.pop("membership_id", None)

    now = datetime.now(timezone.utc)
    expire = now + (
        expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({
        "iss": JWT_ISSUER,
        "aud": audience,
        "iat": now,
        "nbf": now,
        "exp": expire,
        "jti": to_encode.get("jti") or uuid.uuid4().hex,
    })

    return jwt.encode(to_encode, SIGNING_KEY, algorithm=ALGORITHM)


def verify_token(token: str, *, expected_audience: str) -> TokenData:
    """
    JWT token'ı RS256 public key ile doğrular ve decode eder.

    Args:
        token: JWT token string.
        expected_audience: Bu ucun kabul ettigi TEK audience. ZORUNLU —
            varsayilan verilmez, cunku "her audience'i kabul et"
            davranisi tenant/platform ayrimini sessizce yok ederdi.

    Returns:
        TokenData nesnesi.

    Raises:
        UnauthorizedError: Token gecersiz, suresi dolmus veya YANLIS
            audience tasiyorsa.
    """
    try:
        # VERIFY_KEY None olamaz — modül yüklenirken kontrol edildi (sys.exit)
        # `audience` parametresi: jose, aud claim'i eslesmezse
        # JWTClaimsError firlatir — yanlis duzlemin token'i buradan
        # gecemez.
        payload = jwt.decode(
            token,
            VERIFY_KEY,  # type: ignore[arg-type]
            algorithms=[ALGORITHM],
            audience=expected_audience,
            issuer=JWT_ISSUER,
        )

        user_id: Optional[str] = payload.get("user_id")
        email: Optional[str] = payload.get("email")
        is_admin: bool = payload.get("is_admin", False)

        if user_id is None or email is None:
            raise UnauthorizedError("Token içeriği geçersiz")

        tenant_id = payload.get("tenant_id")
        if expected_audience == TENANT_AUDIENCE and not tenant_id:
            # Cutover ONCESI uretilmis (tenant'siz) token. Kabul etmek,
            # tenant baglami olmayan bir istek uretmek demektir.
            raise UnauthorizedError("Kimlik doğrulama başarısız")

        return TokenData(
            user_id=user_id,
            email=email,
            is_admin=is_admin,
            tenant_id=tenant_id,
            membership_id=payload.get("membership_id"),
            audience=payload.get("aud"),
            auth_method=payload.get("auth_method", "local"),
            jti=payload.get("jti"),
            support_grant_id=payload.get("support_grant_id"),
            support_mode=payload.get("support_mode"),
        )

    except JWTError as e:
        # [KRİTİK-4] Anahtar veya hata detayı asla loglanmaz / istemciye dönmez.
        # Yanlis audience de dahil TUM basarisizliklar ayni yanit —
        # istemci hangi duzlemin token'ini tuttugunu ogrenemez.
        logger.warning(
            "JWT doğrulama başarısız",
            extra={"error_type": type(e).__name__},
        )
        raise UnauthorizedError("Kimlik doğrulama başarısız")


# =============================================================================
# Token Extraction — Cookie öncelikli, Bearer header fallback
# =============================================================================

def _extract_token(request: Request, bearer_token: Optional[str]) -> Optional[str]:
    """
    İstekten JWT token'ı çıkarır.

    Öncelik:
      1. HttpOnly cookie ("access_token") — tarayıcı istekleri
      2. Authorization: Bearer <token> — Swagger UI / servisler arası
    """
    cookie_token = request.cookies.get(ACCESS_TOKEN_COOKIE_NAME)
    if cookie_token:
        return cookie_token
    return bearer_token or None


# =============================================================================
# FastAPI Dependencies
# =============================================================================

def _current_user_from_token_data(token_data: TokenData) -> CurrentUser:
    """Dogrulanmis TENANT token'ini principal'a cevirir."""
    return CurrentUser(
        id=token_data.user_id,
        email=token_data.email,
        is_admin=token_data.is_admin,
        # tenant_id token'da ZORUNLU: verify_token, tenant audience'li
        # ama tenant'siz bir token'i zaten reddeder.
        tenant_id=token_data.tenant_id,  # type: ignore[arg-type]
        membership_id=token_data.membership_id,
        auth_method=token_data.auth_method,
        support_grant_id=token_data.support_grant_id,
        support_mode=token_data.support_mode,
    )


async def get_current_user(
    request: Request,
    bearer_token: Optional[str] = Depends(oauth2_scheme),
) -> CurrentUser:
    """
    HttpOnly cookie veya Bearer header'dan TENANT kullanicisini dogrular.

    Cookie varsa önceliklidir (tarayıcı akışı).
    Cookie yoksa Bearer header'a düşer (Swagger UI / servisler arasi).

    YALNIZCA `aud=hermes-tenant` kabul edilir. Platform Admin oturumu
    buradan GECEMEZ — platform token'i tenant verisine erisemez.

    Raises:
        HTTPException 401: Token bulunamazsa, geçersizse veya audience
            yanlissa.
    """
    token = _extract_token(request, bearer_token)

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        token_data = verify_token(token, expected_audience=TENANT_AUDIENCE)
        return _current_user_from_token_data(token_data)
    except UnauthorizedError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e.message),
            headers={"WWW-Authenticate": "Bearer"},
        )


# =============================================================================
# Platform duzlemi — AYRI cookie, AYRI audience, AYRI dependency
# =============================================================================

def _extract_platform_token(
    request: Request, bearer_token: Optional[str]
) -> Optional[str]:
    """Platform oturum token'i AYRI cookie'den okunur.

    Tenant cookie'sine BILEREK bakilmaz: aksi halde tenant oturumu olan
    biri, yalnizca audience yanlis oldugu icin reddedilen bir yolda
    platform ucuna kadar ilerlerdi. Iki cookie tamamen bagimsizdir.
    """
    cookie_token = request.cookies.get(PLATFORM_SESSION_COOKIE_NAME)
    if cookie_token:
        return cookie_token
    return bearer_token or None


async def get_platform_principal(
    request: Request,
    bearer_token: Optional[str] = Depends(oauth2_scheme),
) -> PlatformPrincipal:
    """Platform Super Admin oturumunu dogrular.

    YALNIZCA `aud=hermes-platform-admin` kabul edilir; tenant token'i
    buradan GECEMEZ. Bu principal'in tenant_id'si YOKTUR — dolayisiyla
    tenant veri yollarinda kullanilamaz.

    Not: bu yalnizca KIMLIK dogrulamasidir. Platform izin kontrolu
    (`platform.tenants.manage` vb.) auth-service tarafindaki ayri bir
    guard ile, `platform_admins` tablosundan cozulur — izin JWT'ye
    GOMULMEZ (tenant tarafiyla ayni ilke).
    """
    token = _extract_platform_token(request, bearer_token)

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        token_data = verify_token(token, expected_audience=PLATFORM_AUDIENCE)
    except UnauthorizedError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e.message),
            headers={"WWW-Authenticate": "Bearer"},
        )

    return PlatformPrincipal(
        id=token_data.user_id,
        email=token_data.email,
        jti=token_data.jti,
    )


# RBAC R4 NOTU: require_admin SILINDI (superseden yol tamamen kaldirilir
# kurali). Yerine gecenler:
#   - auth-service:      app.services.rbac_service.require_permissions
#   - core-service:      app.authz.require_permissions (S2S cozumlu)
#   - reporting-service: app.rbac.require_reports_view (JWT-forward)
# is_admin claim'i yalnizca gecis-donemi uyumlulugu icin token'da durur;
# hicbir guard artik onu OKUMAZ.


async def get_current_user_optional(
    request: Request,
    bearer_token: Optional[str] = Depends(oauth2_scheme),
) -> Optional[CurrentUser]:
    """
    Opsiyonel kimlik doğrulama. Token yoksa veya geçersizse None döner.

    "Gecersiz" yanlis audience'i DA kapsar: platform token'i burada da
    None uretir, tenant kullanicisi gibi davranmaz.
    """
    token = _extract_token(request, bearer_token)
    if not token:
        return None

    try:
        token_data = verify_token(token, expected_audience=TENANT_AUDIENCE)
        return _current_user_from_token_data(token_data)
    except UnauthorizedError:
        return None
