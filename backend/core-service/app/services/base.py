# =============================================================================
# HERMES PLATFORM - Base CRUD Service
# =============================================================================
# Bu dosya, tüm CRUD servislerinin türetildiği temel sınıfı içerir.
# Code reuse (kod tekrarını önleme) için tasarlanmıştır.
# =============================================================================

from typing import Generic, TypeVar, Type, List, Optional, Any
from uuid import UUID
from sqlalchemy.orm import Session
from pydantic import BaseModel
import logging

from shared.exceptions import NotFoundError, ConflictError

logger = logging.getLogger(__name__)


# Type variables for generic CRUD operations
ModelType = TypeVar("ModelType")
CreateSchemaType = TypeVar("CreateSchemaType", bound=BaseModel)
UpdateSchemaType = TypeVar("UpdateSchemaType", bound=BaseModel)


class BaseCRUDService(Generic[ModelType, CreateSchemaType, UpdateSchemaType]):
    """
    CRUD işlemleri için temel servis sınıfı.
    
    Bu sınıf, tüm model servislerinde ortak olan CRUD işlemlerini sağlar.
    Kod tekrarını önlemek için Generic pattern kullanılır.
    
    Type Parameters:
        ModelType: SQLAlchemy model sınıfı
        CreateSchemaType: Oluşturma için Pydantic şeması
        UpdateSchemaType: Güncelleme için Pydantic şeması
    
    Kullanım:
        class CustomerService(BaseCRUDService[Customer, CustomerCreate, CustomerUpdate]):
            def __init__(self, db: Session):
                super().__init__(db, Customer, "Müşteri")
    """
    
    def __init__(
        self,
        db: Session,
        model: Type[ModelType],
        resource_name: str = "Kaynak"
    ):
        """
        Args:
            db: SQLAlchemy session
            model: İşlemler için model sınıfı
            resource_name: Hata mesajlarında kullanılacak kaynak adı
        """
        self.db = db
        self.model = model
        self.resource_name = resource_name
    
    # =========================================================================
    # CREATE
    # =========================================================================
    
    def create(self, data: CreateSchemaType) -> ModelType:
        """
        Yeni kayıt oluşturur.
        
        Args:
            data: Oluşturma verisi (Pydantic schema)
        
        Returns:
            Oluşturulan model instance
        """
        db_obj = self.model(**data.model_dump())
        self.db.add(db_obj)
        self.db.flush()
        self.db.refresh(db_obj)
        return db_obj
    
    # =========================================================================
    # READ
    # =========================================================================
    
    def get_by_id(self, id: UUID) -> Optional[ModelType]:
        """ID ile kayıt getirir."""
        return self.db.query(self.model).filter(self.model.id == id).first()
    
    def get_by_id_or_404(self, id: UUID) -> ModelType:
        """ID ile kayıt getirir, yoksa NotFoundError fırlatır."""
        obj = self.get_by_id(id)
        if not obj:
            raise NotFoundError(self.resource_name, id)
        return obj
    
    def get_all(
        self,
        skip: int = 0,
        limit: int = 100,
        include_inactive: bool = False
    ) -> List[ModelType]:
        """Tüm kayıtları listeler."""
        query = self.db.query(self.model)
        
        # is_active alanı varsa filtrele
        if hasattr(self.model, 'is_active') and not include_inactive:
            query = query.filter(self.model.is_active == True)  # noqa: E712
        
        # created_at alanı varsa sırala
        if hasattr(self.model, 'created_at'):
            query = query.order_by(self.model.created_at.desc())
        
        return query.offset(skip).limit(limit).all()
    
    def count(self, include_inactive: bool = False) -> int:
        """Toplam kayıt sayısını döner."""
        query = self.db.query(self.model)
        
        if hasattr(self.model, 'is_active') and not include_inactive:
            query = query.filter(self.model.is_active == True)  # noqa: E712
        
        return query.count()
    
    # =========================================================================
    # UPDATE
    # =========================================================================
    
    def update(self, id: UUID, data: UpdateSchemaType) -> ModelType:
        """Kaydı günceller."""
        db_obj = self.get_by_id_or_404(id)
        
        # Sadece set edilmiş alanları güncelle
        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_obj, field, value)
        
        self.db.flush()
        self.db.refresh(db_obj)
        return db_obj
    
    # =========================================================================
    # DELETE
    # =========================================================================
    
    def delete(self, id: UUID, soft: bool = False) -> bool:
        """
        Kaydı siler.
        
        Args:
            id: Silinecek kaydın ID'si
            soft: True ise soft delete, False ise hard delete
        """
        logger.info(f"AUDIT: delete called for {self.resource_name} {id} with soft={soft}")
        db_obj = self.get_by_id_or_404(id)
        
        if soft and hasattr(self.model, 'is_active'):
            db_obj.is_active = False
            self.db.flush()
        else:
            self.db.delete(db_obj)
            self.db.flush()
        
        return True
