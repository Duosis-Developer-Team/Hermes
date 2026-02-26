# =============================================================================
# HERMES PLATFORM - Project Service
# =============================================================================
# Proje CRUD işlemlerini yöneten servis (FR 3.3).
# =============================================================================

from typing import List, Optional
from uuid import UUID
from datetime import datetime, timezone
from sqlalchemy.orm import Session

from ..models.project import Project
from ..models.customer import Customer
from ..schemas.project import ProjectCreate, ProjectUpdate, ProjectResponse
from .base import BaseCRUDService
from shared.exceptions import NotFoundError


class ProjectService(BaseCRUDService[Project, ProjectCreate, ProjectUpdate]):
    """
    Proje yönetimi servisi (FR 3.3).
    
    Projeler opsiyonel olarak bir müşteriye bağlı olabilir.
    İç projeler (internal projects) müşterisiz olabilir.
    """
    
    def __init__(self, db: Session):
        super().__init__(db, Project, "Proje")
    
    def create(self, data: ProjectCreate) -> Project:
        """
        Yeni proje oluşturur.
        
        customer_id verilmişse, müşterinin varlığını doğrular.
        contract_duration_days verilip contract_start_date verilmemişse,
        otomatik olarak bugünün tarihi atanır.
        """
        # Müşteri ID'si verilmişse varlığını kontrol et
        if data.customer_id:
            customer = self.db.query(Customer).filter(
                Customer.id == data.customer_id
            ).first()
            if not customer:
                raise NotFoundError("Müşteri", data.customer_id)
        
        # Contract duration verilip start_date verilmemişse bugünü ata
        if data.contract_duration_days and not data.contract_start_date:
            data.contract_start_date = datetime.now(timezone.utc)
        
        return super().create(data)
    
    def update(self, id: UUID, data: ProjectUpdate) -> Project:
        """
        Projeyi günceller.
        
        contract_duration_days verilip contract_start_date verilmemişse,
        mevcut projede de yoksa otomatik olarak bugünün tarihi atanır.
        """
        # Müşteri ID'si verilmişse varlığını kontrol et
        update_data = data.model_dump(exclude_unset=True)
        
        if 'customer_id' in update_data and update_data['customer_id']:
            customer = self.db.query(Customer).filter(
                Customer.id == update_data['customer_id']
            ).first()
            if not customer:
                raise NotFoundError("Müşteri", update_data['customer_id'])
        
        # Contract duration verilip start_date yoksa otomatik bugünü ata
        if 'contract_duration_days' in update_data and update_data['contract_duration_days']:
            if 'contract_start_date' not in update_data or not update_data.get('contract_start_date'):
                project = self.get_by_id_or_404(id)
                if not project.contract_start_date:
                    update_data['contract_start_date'] = datetime.now(timezone.utc)
        
        # Do the update manually instead of calling super().update()
        project = self.get_by_id_or_404(id)
        for field, value in update_data.items():
            setattr(project, field, value)
        self.db.commit()
        self.db.refresh(project)
        return project
    
    def get_by_customer(
        self,
        customer_id: UUID,
        include_inactive: bool = False
    ) -> List[Project]:
        """Belirli bir müşteriye ait projeleri listeler."""
        query = self.db.query(Project).filter(Project.customer_id == customer_id)
        
        if not include_inactive:
            query = query.filter(Project.is_active == True)  # noqa: E712
        
        return query.order_by(Project.created_at.desc()).all()
    
    def to_response(self, project: Project) -> dict:
        """Project modelini response dict'e dönüştürür (customer_name ile)."""
        return {
            "id": project.id,
            "name": project.name,
            "project_key": project.project_key,
            "customer_id": project.customer_id,
            "customer_name": project.customer.name if project.customer else None,
            "is_active": project.is_active,
            "created_at": project.created_at,
            "contract_start_date": project.contract_start_date,
            "contract_duration_days": project.contract_duration_days,
        }
