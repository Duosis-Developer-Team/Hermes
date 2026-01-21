# =============================================================================
# HERMES PLATFORM - Customer Service
# =============================================================================
# Müşteri CRUD işlemlerini yöneten servis (FR 3.1).
# =============================================================================

from sqlalchemy.orm import Session

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
