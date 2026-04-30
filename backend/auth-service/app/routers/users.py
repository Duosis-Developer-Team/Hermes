# =============================================================================
# HERMES PLATFORM - Users Router
# =============================================================================
# Bu dosya, kullanıcı yönetimi endpoint'lerini tanımlar.
# Admin kullanıcıların kullanıcı CRUD işlemlerini yapabilmesi için (FR 3.4).
#
# TAD Referansı (5.1):
# - POST /users: Yeni kullanıcı oluştur (Admin)
# - GET /users: Tüm kullanıcıları listeler (Admin)
# - PUT /users/{user_id}: Kullanıcıyı günceller (Admin)
# =============================================================================

from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.user import (
    UserCreate,
    UserUpdate,
    UserResponse,
    UserListResponse
)
from ..services.user_service import UserService
from shared.auth import require_admin, get_current_user, CurrentUser
from shared.exceptions import NotFoundError, ConflictError
from shared.responses import success_response


# Router oluştur
router = APIRouter(
    prefix="/users",
    tags=["User Management"]
)


# =============================================================================
# POST /users - Create User
# =============================================================================

@router.post(
    "",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Yeni Kullanıcı Oluştur",
    description="Admin tarafından yeni kullanıcı oluşturulur."
)
async def create_user(
    user_data: UserCreate,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db)
) -> UserResponse:
    """
    Yeni kullanıcı oluşturur.
    
    Sadece Admin kullanıcılar bu endpoint'i kullanabilir.
    Yeni kullanıcı varsayılan olarak Standart Kullanıcı olarak oluşturulur.
    
    Args:
        user_data: Kullanıcı oluşturma verisi
        admin: Admin kullanıcı doğrulaması
        db: Veritabanı session'ı
    
    Returns:
        Oluşturulan kullanıcı bilgisi
    
    Raises:
        HTTPException 403: Kullanıcı admin değilse
        HTTPException 409: E-posta zaten kullanılıyorsa
    
    Örnek İstek:
        POST /api/v1/auth/users
        {
            "email": "yeni@sirket.com",
            "full_name": "Yeni Kullanıcı",
            "password": "guvenli123",
            "is_admin": false
        }
    """
    user_service = UserService(db)
    
    try:
        user = user_service.create(user_data)
        return user
    except ConflictError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=e.message
        )


# =============================================================================
# GET /users - List Users
# =============================================================================

@router.get(
    "",
    response_model=UserListResponse,
    summary="Kullanıcıları Listele",
    description="Tüm kullanıcıları listeler (Admin)."
)
async def list_users(
    skip: int = Query(0, ge=0, description="Atlanacak kayıt sayısı"),
    limit: int = Query(100, ge=1, le=500, description="Maksimum kayıt sayısı"),
    include_inactive: bool = Query(False, description="Pasif kullanıcıları dahil et"),
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db)
) -> UserListResponse:
    """
    Tüm kullanıcıları listeler.
    
    Sadece Admin kullanıcılar bu endpoint'i kullanabilir.
    Pagination için skip ve limit parametreleri kullanılır.
    
    Args:
        skip: Atlanacak kayıt sayısı
        limit: Maksimum döndürülecek kayıt sayısı
        include_inactive: Pasif kullanıcıları da dahil et mi?
        admin: Admin kullanıcı doğrulaması
        db: Veritabanı session'ı
    
    Returns:
        Kullanıcı listesi ve toplam sayı
    
    Örnek Yanıt:
        {
            "success": true,
            "data": [...],
            "total": 25
        }
    """
    user_service = UserService(db)
    
    users = user_service.get_all(
        skip=skip,
        limit=limit,
        include_inactive=include_inactive
    )
    total = user_service.count(include_inactive=include_inactive)
    
    return UserListResponse(
        success=True,
        data=users,
        total=total
    )


# =============================================================================
# GET /users/options - List User Options (Simplified)
# =============================================================================

@router.get(
    "/options",
    summary="Kullanıcı Seçeneklerini Listele",
    description="Dropdownlar için basitleştirilmiş kullanıcı listesi."
)
async def list_user_options(
    role: str = Query(None, description="Role göre filtrele (REVIEWER, ADMIN, USER)"),
    current_user: CurrentUser = Depends(require_admin), # Admin Only VEYA get_current_user olabilir. İhtiyaca göre get_current_user kullanıyorum ki herkes görebilsin
    db: Session = Depends(get_db)
):
    """
    Tüm kullanıcıları (veya role göre filtrelenmiş) listeler.
    Sadece id ve full_name döner.
    """
    user_service = UserService(db)
    
    # Service'e role filter eklememiz gerekebilir veya doğrudan query burada yazabiliriz
    # Basitlik için burada query yapalım veya service'i update edelim. 
    # Service update daha temiz.
    
    # Geçici olarak direkt DB query yapalım (Main service logic user_service'de olmalı ama)
    from ..models.user import User, UserRole
    
    query = db.query(User).filter(User.is_active == True)
    
    if role:
        # Case insensitive role check or strict? Strict for Enum.
        try:
             query = query.filter(User.role == UserRole(role))
        except ValueError:
             pass # Invalid role, ignore or return empty? Ignore filter.

    users = query.all()
    
    return [
        {"id": u.id, "full_name": u.full_name or u.email, "role": u.role} 
        for u in users
    ]


# =============================================================================
# GET /users/lookup - Minimal user info for any authenticated user
# =============================================================================

@router.get(
    "/lookup",
    summary="Lookup users (minimal fields, any authenticated user)",
    description=(
        "Returns minimal info (id, full_name, email, role, is_admin, is_active) "
        "for active users. Used by feature modules (e.g. Tasks) to display "
        "assigner/assignee names without requiring admin privileges. "
        "Optionally filter to a specific list of user IDs via repeated 'ids' query."
    )
)
async def lookup_users(
    ids: Optional[List[UUID]] = Query(None, description="Optional filter — restrict to these user IDs"),
    include_inactive: bool = Query(False, description="Include inactive users (admin only — ignored otherwise)"),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Lightweight, read-only user lookup for any authenticated user."""
    from ..models.user import User

    query = db.query(User)

    if include_inactive and current_user.is_admin:
        pass  # No filter
    else:
        query = query.filter(User.is_active == True)  # noqa: E712

    if ids:
        query = query.filter(User.id.in_(ids))

    users = query.order_by(User.full_name.asc().nulls_last(), User.email.asc()).all()

    return [
        {
            "id": str(u.id),
            "full_name": u.full_name or u.email,
            "email": u.email,
            "role": u.role.value if hasattr(u.role, "value") else (str(u.role) if u.role else None),
            "is_admin": bool(u.is_admin),
            "is_active": bool(u.is_active),
        }
        for u in users
    ]


# =============================================================================
# GET /users/{user_id} - Get User by ID
# =============================================================================

@router.get(
    "/{user_id}",
    response_model=UserResponse,
    summary="Kullanıcı Detayı",
    description="Belirli bir kullanıcının detaylarını getirir (Admin)."
)
async def get_user(
    user_id: UUID,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db)
) -> UserResponse:
    """
    ID ile kullanıcı detaylarını getirir.
    
    Args:
        user_id: Kullanıcı UUID'si
        admin: Admin kullanıcı doğrulaması
        db: Veritabanı session'ı
    
    Returns:
        Kullanıcı bilgisi
    
    Raises:
        HTTPException 404: Kullanıcı bulunamazsa
    """
    user_service = UserService(db)
    
    try:
        user = user_service.get_by_id_or_404(user_id)
        return user
    except NotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=e.message
        )


# =============================================================================
# PUT /users/{user_id} - Update User
# =============================================================================

@router.put(
    "/{user_id}",
    response_model=UserResponse,
    summary="Kullanıcı Güncelle",
    description="Belirli bir kullanıcının bilgilerini günceller (Admin)."
)
async def update_user(
    user_id: UUID,
    user_data: UserUpdate,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db)
) -> UserResponse:
    """
    Kullanıcı bilgilerini günceller.
    
    Sadece gönderilen alanlar güncellenir (partial update).
    
    Args:
        user_id: Güncellenecek kullanıcının UUID'si
        user_data: Güncelleme verisi
        admin: Admin kullanıcı doğrulaması
        db: Veritabanı session'ı
    
    Returns:
        Güncellenmiş kullanıcı bilgisi
    
    Raises:
        HTTPException 404: Kullanıcı bulunamazsa
        HTTPException 409: E-posta çakışması varsa
    
    Örnek İstek:
        PUT /api/v1/auth/users/550e8400-e29b-41d4-a716-446655440000
        {
            "full_name": "Yeni İsim",
            "is_admin": true
        }
    """
    user_service = UserService(db)
    
    try:
        user = user_service.update(user_id, user_data)
        return user
    except NotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=e.message
        )
    except ConflictError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=e.message
        )


# =============================================================================
# DELETE /users/{user_id} - Delete User (Soft Delete)
# =============================================================================

@router.delete(
    "/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Kullanıcı Sil",
    description="Kullanıcıyı pasif yapar (soft delete)."
)
async def delete_user(
    user_id: UUID,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Kullanıcıyı soft delete yapar (is_active = False).
    
    Not: Hard delete yapmaz, sadece kullanıcıyı pasif yapar.
    
    Args:
        user_id: Silinecek kullanıcının UUID'si
        admin: Admin kullanıcı doğrulaması
        db: Veritabanı session'ı
    
    Raises:
        HTTPException 404: Kullanıcı bulunamazsa
    """
    user_service = UserService(db)
    
    try:
        user_service.delete(user_id, soft=False)
    except NotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=e.message
        )
