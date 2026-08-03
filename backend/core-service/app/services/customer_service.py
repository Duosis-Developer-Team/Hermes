# =============================================================================
# HERMES PLATFORM - Customer Service
# =============================================================================
# Müşteri CRUD işlemlerini yöneten servis (FR 3.1).
# =============================================================================

import logging
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from uuid import UUID
from fastapi import HTTPException, status

from ..models.customer import Customer
from ..schemas.customer import CustomerCreate, CustomerUpdate
from .base import BaseCRUDService

logger = logging.getLogger(__name__)


class CustomerService(BaseCRUDService[Customer, CustomerCreate, CustomerUpdate]):
    """
    Müşteri yönetimi servisi (FR 3.1).
    
    BaseCRUDService'den tüm temel CRUD işlemlerini miras alır.
    Müşteriye özel ek işlemler bu sınıfta tanımlanabilir.
    """
    
    def __init__(self, db: Session):
        super().__init__(db, Customer, "Müşteri")
    
    def get_by_name(self, name: str) -> Customer | None:
        """İsme göre müşteri arar."""
        return self.db.query(Customer).filter(Customer.name == name).first()

    def create(self, data: CustomerCreate) -> Customer:
        """
        Creates a new customer.
        If contract_duration_days is provided, sets contract_start_date to NOW.
        """
        if data.contract_duration_days:
            data.contract_start_date = datetime.now(timezone.utc)
        
        return super().create(data)

    def update(self, id: UUID, data: CustomerUpdate) -> Customer:
        """
        Updates a customer.
        If contract_duration_days is being updated (and has value), resets contract_start_date to NOW.

        [YÜKSEK-8] contract_duration_days için iş mantığı validasyonu eklendi:
        - 0 veya negatif değer kabul edilmez.
        - Güncelleme audit log'a yazılır.
        """
        if data.contract_duration_days is not None:
            # [YÜKSEK-8] Minimum süre kontrolü
            if data.contract_duration_days < 1:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="The contract period must be at least 1 day.",
                )
            # Logic: "ne zaman girilmişse o an başlangıç olacak"
            data.contract_start_date = datetime.now(timezone.utc)
            logger.info(
                "Müşteri sözleşme süresi güncellendi",
                extra={
                    "customer_id": str(id),
                    "new_duration_days": data.contract_duration_days,
                },
            )

        return super().update(id, data)
