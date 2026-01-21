# =============================================================================
# HERMES PLATFORM - Shared Module
# =============================================================================
# Bu modül, tüm mikroservislerin ortak kullandığı yardımcı fonksiyonları,
# exception sınıflarını ve middleware'leri içerir. Kod tekrarını önlemek ve
# tutarlı bir API davranışı sağlamak için tasarlanmıştır.
# =============================================================================

"""
Hermes Platform - Shared Module

Bu modül aşağıdaki ortak bileşenleri sağlar:
- auth: JWT doğrulama ve kullanıcı kimlik kontrolü
- exceptions: Özel exception sınıfları
- responses: Standart API yanıt formatları
"""

from .auth import verify_token, get_current_user, require_admin
from .exceptions import (
    HermesException,
    NotFoundError,
    UnauthorizedError,
    ForbiddenError,
    ValidationError,
    ConflictError
)
from .responses import (
    success_response,
    error_response,
    paginated_response
)

__all__ = [
    # Auth
    "verify_token",
    "get_current_user",
    "require_admin",
    # Exceptions
    "HermesException",
    "NotFoundError",
    "UnauthorizedError",
    "ForbiddenError",
    "ValidationError",
    "ConflictError",
    # Responses
    "success_response",
    "error_response",
    "paginated_response",
]
