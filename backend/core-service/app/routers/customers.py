# =============================================================================
# HERMES PLATFORM - Customers Router
# =============================================================================
# Müşteri CRUD endpoint'leri (FR 3.1). Sadece Admin erişebilir.
# =============================================================================

from typing import List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.customer import CustomerCreate, CustomerUpdate, CustomerResponse
from ..services.customer_service import CustomerService
from shared.auth import require_admin, CurrentUser, get_current_user
from shared.exceptions import NotFoundError

router = APIRouter(prefix="/customers", tags=["Customers"])


@router.post("", response_model=CustomerResponse, status_code=status.HTTP_201_CREATED)
async def create_customer(
    data: CustomerCreate,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Yeni müşteri oluşturur (Admin)."""
    service = CustomerService(db)
    return service.create(data)


@router.get("", response_model=List[CustomerResponse])
async def list_customers(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    include_inactive: bool = Query(False),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Müşterileri listeler (Authenticated Users)."""
    service = CustomerService(db)
    # Regular users should only see active customers unless specified otherwise (logic can be refined)
    return service.get_all(skip=skip, limit=limit, include_inactive=include_inactive)


@router.get("/{customer_id}", response_model=CustomerResponse)
async def get_customer(
    customer_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Müşteri detaylarını getirir (Authenticated Users)."""
    service = CustomerService(db)
    try:
        return service.get_by_id_or_404(customer_id)
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)


@router.put("/{customer_id}", response_model=CustomerResponse)
async def update_customer(
    customer_id: UUID,
    data: CustomerUpdate,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Müşteriyi günceller (Admin)."""
    service = CustomerService(db)
    try:
        return service.update(customer_id, data)
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)


@router.delete("/{customer_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_customer(
    customer_id: UUID,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Müşteriyi siler - soft delete (Admin)."""
    service = CustomerService(db)
    try:
        service.delete(customer_id, soft=False)
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)
    except Exception as e:
        # Check for integrity error (foreign key constraint)
        if "integrityerror" in str(e).lower() or "foreign key constraint" in str(e).lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, 
                detail="Bu müşteriye ait kayıtlar olduğu için silinemiyor. Önce ilgili iş kayıtlarını ve projeleri silmelisiniz."
            )
        raise e
