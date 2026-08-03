# =============================================================================
# HERMES PLATFORM - Custom Exceptions
# =============================================================================
# Bu dosya, Hermes platformunun tüm servislerinde kullanılan özel exception
# sınıflarını tanımlar. HTTP durum kodlarıyla eşlenmiş exception'lar,
# tutarlı hata yönetimi ve API yanıtları sağlar.
# =============================================================================

from typing import Any, Dict, Optional


class HermesException(Exception):
    """
    Hermes platformu için temel exception sınıfı.
    
    Tüm özel exception'lar bu sınıftan türetilir. FastAPI exception handler'ları
    bu exception'ları yakalayarak uygun HTTP yanıtlarına dönüştürür.
    
    Attributes:
        message: Kullanıcıya gösterilecek hata mesajı
        status_code: HTTP durum kodu
        error_code: Uygulama-spesifik hata kodu (opsiyonel)
        details: Ek hata detayları (opsiyonel)
    """
    
    def __init__(
        self,
        message: str,
        status_code: int = 500,
        error_code: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None
    ):
        self.message = message
        self.status_code = status_code
        self.error_code = error_code or f"ERR_{status_code}"
        self.details = details or {}
        super().__init__(self.message)
    
    def to_dict(self) -> Dict[str, Any]:
        """Exception'ı JSON-serializable bir dict'e dönüştürür."""
        return {
            "success": False,
            "error": {
                "code": self.error_code,
                "message": self.message,
                "details": self.details
            }
        }


# =============================================================================
# HTTP 400 - Bad Request
# =============================================================================

class ValidationError(HermesException):
    """
    Geçersiz veri veya parametre hatası için kullanılır.
    
    Örnek kullanım:
        raise ValidationError("E-posta formatı geçersiz", field="email")
    """
    
    def __init__(
        self,
        message: str = "Invalid data",
        field: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None
    ):
        error_details = details or {}
        if field:
            error_details["field"] = field
        super().__init__(
            message=message,
            status_code=400,
            error_code="VALIDATION_ERROR",
            details=error_details
        )


# =============================================================================
# HTTP 401 - Unauthorized
# =============================================================================

class UnauthorizedError(HermesException):
    """
    Kimlik doğrulama başarısız olduğunda kullanılır.
    
    Örnek durumlar:
        - Geçersiz veya eksik JWT token
        - Yanlış kullanıcı adı/şifre
        - Süresi dolmuş token
    """
    
    def __init__(
        self,
        message: str = "Authentication failed",
        details: Optional[Dict[str, Any]] = None
    ):
        super().__init__(
            message=message,
            status_code=401,
            error_code="UNAUTHORIZED",
            details=details or {}
        )


# =============================================================================
# HTTP 403 - Forbidden
# =============================================================================

class ForbiddenError(HermesException):
    """
    Yetkilendirme başarısız olduğunda kullanılır.
    
    Kullanıcı kimliği doğrulanmış ancak bu işlem için yetkisi yok.
    
    Örnek durumlar:
        - Standart kullanıcı admin sayfasına erişmeye çalışıyor
        - Kullanıcı başkasının kaydını silmeye çalışıyor
    """
    
    def __init__(
        self,
        message: str = "You do not have permission to do this",
        details: Optional[Dict[str, Any]] = None
    ):
        super().__init__(
            message=message,
            status_code=403,
            error_code="FORBIDDEN",
            details=details or {}
        )


# =============================================================================
# HTTP 404 - Not Found
# =============================================================================

class NotFoundError(HermesException):
    """
    Kaynak bulunamadığında kullanılır.
    
    Örnek durumlar:
        - ID ile aranan kullanıcı veritabanında yok
        - İstenilen proje silinmiş veya mevcut değil
    
    Örnek kullanım:
        raise NotFoundError("Müşteri", customer_id)
    """
    
    def __init__(
        self,
        resource_name: str = "Kaynak",
        resource_id: Optional[Any] = None,
        details: Optional[Dict[str, Any]] = None
    ):
        message = f"{resource_name} not found"
        if resource_id:
            message = f"{resource_name} not found (ID: {resource_id})"
        
        error_details = details or {}
        if resource_id:
            error_details["resource_id"] = str(resource_id)
        error_details["resource_name"] = resource_name
        
        super().__init__(
            message=message,
            status_code=404,
            error_code="NOT_FOUND",
            details=error_details
        )


# =============================================================================
# HTTP 409 - Conflict
# =============================================================================

class ConflictError(HermesException):
    """
    Kaynak çakışması durumunda kullanılır.
    
    Örnek durumlar:
        - Aynı e-posta ile ikinci bir kullanıcı oluşturulmaya çalışılıyor
        - Aynı isimde proje/müşteri zaten mevcut
    
    Örnek kullanım:
        raise ConflictError("Bu e-posta adresi zaten kullanılıyor", field="email")
    """
    
    def __init__(
        self,
        message: str = "Resource conflict",
        field: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None
    ):
        error_details = details or {}
        if field:
            error_details["field"] = field
        super().__init__(
            message=message,
            status_code=409,
            error_code="CONFLICT",
            details=error_details
        )
