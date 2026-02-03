# =============================================================================
# HERMES PLATFORM - Customer Service
# =============================================================================
# Müşteri CRUD işlemlerini yöneten servis (FR 3.1).
# =============================================================================

from datetime import datetime, timezone
from sqlalchemy.orm import Session
from uuid import UUID

from ..models.customer import Customer
from ..schemas.customer import CustomerCreate, CustomerUpdate
from .base import BaseCRUDService


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
        """
        if data.contract_duration_days is not None:
             # Only reset start date if duration is explicitly provided in update
             # Logic: "ne zaman girilmişse o an başlangıç olacak"
             data.contract_start_date = datetime.now(timezone.utc)

        return super().update(id, data)
