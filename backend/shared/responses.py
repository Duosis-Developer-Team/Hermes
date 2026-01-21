# =============================================================================
# HERMES PLATFORM - Standart API Yanıt Formatları
# =============================================================================
# Bu dosya, tüm API endpoint'lerinden dönen yanıtların tutarlı bir formatta
# olmasını sağlayan yardımcı fonksiyonları içerir. Tüm servisler bu formatları
# kullanarak birbirleriyle uyumlu yanıtlar üretir.
# =============================================================================

from typing import Any, Dict, List, Optional, TypeVar, Generic
from pydantic import BaseModel

T = TypeVar("T")


# =============================================================================
# Response Models (Pydantic Schemas)
# =============================================================================

class SuccessResponse(BaseModel, Generic[T]):
    """
    Başarılı API yanıtları için standart format.
    
    Örnek:
        {
            "success": true,
            "data": { ... },
            "message": "İşlem başarılı"
        }
    """
    success: bool = True
    data: Optional[T] = None
    message: Optional[str] = None


class ErrorResponse(BaseModel):
    """
    Hatalı API yanıtları için standart format.
    
    Örnek:
        {
            "success": false,
            "error": {
                "code": "NOT_FOUND",
                "message": "Kayıt bulunamadı",
                "details": {}
            }
        }
    """
    success: bool = False
    error: Dict[str, Any]


class PaginationMeta(BaseModel):
    """
    Sayfalama meta bilgileri.
    
    Frontend'in sayfalama kontrollerini göstermesi için gerekli bilgiler.
    """
    page: int
    page_size: int
    total_items: int
    total_pages: int
    has_next: bool
    has_previous: bool


class PaginatedResponse(BaseModel, Generic[T]):
    """
    Sayfalanmış liste yanıtları için standart format.
    
    Örnek:
        {
            "success": true,
            "data": [...],
            "pagination": {
                "page": 1,
                "page_size": 20,
                "total_items": 100,
                "total_pages": 5,
                "has_next": true,
                "has_previous": false
            }
        }
    """
    success: bool = True
    data: List[T]
    pagination: PaginationMeta


# =============================================================================
# Helper Functions
# =============================================================================

def success_response(
    data: Any = None,
    message: Optional[str] = None
) -> Dict[str, Any]:
    """
    Başarılı yanıt oluşturur.
    
    Args:
        data: Yanıtta döndürülecek veri (dict, list, veya model instance)
        message: Opsiyonel başarı mesajı
    
    Returns:
        Standart formatta başarı yanıtı (dict)
    
    Örnek kullanım:
        return success_response(
            data={"user_id": "123", "name": "John"},
            message="Kullanıcı başarıyla oluşturuldu"
        )
    """
    response = {"success": True}
    
    if data is not None:
        response["data"] = data
    
    if message:
        response["message"] = message
    
    return response


def error_response(
    code: str,
    message: str,
    details: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Hata yanıtı oluşturur.
    
    Args:
        code: Uygulama-spesifik hata kodu (örn: "VALIDATION_ERROR")
        message: Kullanıcıya gösterilecek hata mesajı
        details: Ek hata detayları (opsiyonel)
    
    Returns:
        Standart formatta hata yanıtı (dict)
    
    Örnek kullanım:
        return error_response(
            code="VALIDATION_ERROR",
            message="E-posta formatı geçersiz",
            details={"field": "email"}
        )
    """
    return {
        "success": False,
        "error": {
            "code": code,
            "message": message,
            "details": details or {}
        }
    }


def paginated_response(
    items: List[Any],
    page: int,
    page_size: int,
    total_items: int
) -> Dict[str, Any]:
    """
    Sayfalanmış liste yanıtı oluşturur.
    
    Args:
        items: Sayfadaki öğeler listesi
        page: Mevcut sayfa numarası (1-indexed)
        page_size: Sayfa başına öğe sayısı
        total_items: Toplam öğe sayısı
    
    Returns:
        Sayfalama meta bilgileriyle birlikte standart format
    
    Örnek kullanım:
        users = db.query(User).offset(skip).limit(limit).all()
        total = db.query(User).count()
        return paginated_response(
            items=users,
            page=1,
            page_size=20,
            total_items=total
        )
    """
    # Toplam sayfa sayısını hesapla
    total_pages = (total_items + page_size - 1) // page_size if page_size > 0 else 0
    
    return {
        "success": True,
        "data": items,
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total_items": total_items,
            "total_pages": total_pages,
            "has_next": page < total_pages,
            "has_previous": page > 1
        }
    }
