# =============================================================================
# HERMES PLATFORM - Work Type Service
# =============================================================================
# İş tipi CRUD işlemlerini yöneten servis (FR 3.2).
# =============================================================================

from sqlalchemy.orm import Session

from ..models.work_type import WorkType
from ..schemas.work_type import WorkTypeCreate, WorkTypeUpdate
from .base import BaseCRUDService


class WorkTypeService(BaseCRUDService[WorkType, WorkTypeCreate, WorkTypeUpdate]):
    """
    İş tipi yönetimi servisi (FR 3.2).
    
    Örnek iş tipleri: "Geliştirme", "Toplantı", "Destek", "Analiz"
    """
    
    def __init__(self, db: Session):
        super().__init__(db, WorkType, "İş Tipi")
    
    def get_by_name(self, name: str) -> WorkType | None:
        """İsme göre iş tipi arar."""
        return self.db.query(WorkType).filter(WorkType.name == name).first()
