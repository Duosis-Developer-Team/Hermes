# =============================================================================
# HERMES PLATFORM - Work Log Service
# =============================================================================
# Zaman girişi işlemlerini yöneten servis (FR 2.x).
# Bu, platformun temel işlevi olan zaman takibinin ana servisidir.
# =============================================================================

from typing import List, Optional
from uuid import UUID
from datetime import date, timedelta
from sqlalchemy.orm import Session, joinedload

from ..models.work_log import WorkLog
from ..models.customer import Customer
from ..models.project import Project
from ..models.work_type import WorkType
from ..models.task import Task
from ..models.meeting import Meeting
from ..schemas.work_log import WorkLogCreate, WorkLogUpdate
from shared.exceptions import NotFoundError, ForbiddenError
from . import task_lifecycle, task_service


class WorkLogService:
    """
    Zaman girişi yönetimi servisi (FR 2.x).
    
    Bu servis, çalışanların yaptıkları işlerin kaydını yönetir.
    CRUD işlemleri ve filtreleme özellikleri sağlar.
    
    Yetkilendirme kuralları:
    - Tüm kullanıcılar kendi girişlerini oluşturabilir
    - Kullanıcılar sadece kendi girişlerini görebilir/düzenleyebilir
    - Admin'ler tüm girişleri görebilir/düzenleyebilir
    """
    
    def __init__(self, db: Session):
        self.db = db
    
    # =========================================================================
    # CREATE
    # =========================================================================
    
    def create(self, data: WorkLogCreate, user_id: UUID) -> WorkLog:
        """
        Yeni zaman girişi oluşturur.
        
        Args:
            data: Zaman girişi verisi
            user_id: İşi giren kullanıcının ID'si
        
        Returns:
            Oluşturulan WorkLog instance
        
        Raises:
            NotFoundError: Müşteri, proje veya iş tipi bulunamazsa
        """
        # İlişkili kayıtların varlığını doğrula
        self._validate_references(
            data.customer_id,
            data.project_id,
            data.work_type_id,
            activity_type_id=data.activity_type_id,
            platform_id=data.platform_id,
            work_line_id=data.work_line_id,
            issue_id=data.issue_id
        )
        
        # Optional task link — Tasks → Log Time flow passes task_id so
        # we can pin the work log to its source task. Verify the task
        # actually exists; if not, drop the link silently rather than
        # 404'ing the work log creation.
        linked_task_id = data.task_id
        if linked_task_id is not None:
            exists = (
                self.db.query(Task.id)
                .filter(Task.id == linked_task_id)
                .first()
            )
            if not exists:
                linked_task_id = None

        # Optional meeting link — Meetings → Log Time flow passes
        # meeting_id. Same defensive pattern as task_id: drop the
        # link silently if the referenced meeting no longer exists
        # (e.g. user logging time off a card while a concurrent
        # re-sync deleted/replaced the event row).
        linked_meeting_id = data.meeting_id
        if linked_meeting_id is not None:
            exists = (
                self.db.query(Meeting.id)
                .filter(Meeting.id == linked_meeting_id)
                .first()
            )
            if not exists:
                linked_meeting_id = None

        # WorkLog oluştur
        db_obj = WorkLog(
            user_id=user_id,
            customer_id=data.customer_id,
            project_id=data.project_id,
            work_type_id=data.work_type_id,

            # Yeni Alanlar (v1.1)
            activity_type_id=data.activity_type_id,
            platform_id=data.platform_id,
            work_line_id=data.work_line_id,
            issue_id=data.issue_id,
            issue_key_manual=data.issue_key_manual,

            date_worked=data.date_worked,
            duration_hours=data.duration_hours,
            # Varsayılan olarak billable = duration
            billable_duration_hours=data.billable_duration_hours if data.billable_duration_hours is not None else data.duration_hours,
            description=data.description,
            task_id=linked_task_id,
            meeting_id=linked_meeting_id,
        )

        self.db.add(db_obj)
        self.db.flush()  # need db_obj.id for the activity event

        if linked_task_id is not None:
            task_service.record_log_time_event(
                self.db,
                task_id=linked_task_id,
                actor_user_id=user_id,
                work_log_id=db_obj.id,
                duration_hours=float(db_obj.duration_hours),
                date_worked=db_obj.date_worked,
            )
            # Log Time BASARIYLA olustu → ilgili logical work item'in
            # kapanisi yeniden hesaplanir. "completed ama saati
            # girilmemis" is, bu an gelene kadar KAPANMIS sayilmaz ve
            # otomatik arsiv sirasina girmez. Work log kaydinin
            # KENDISINE bu akista asla dokunulmaz.
            linked = (
                self.db.query(Task).filter(Task.id == linked_task_id).first()
            )
            if linked is not None:
                task_lifecycle.recompute_closure(self.db, linked)

        self.db.commit()
        self.db.refresh(db_obj)
        return db_obj
    
    # =========================================================================
    # READ
    # =========================================================================
    
    def get_by_id(self, id: int) -> Optional[WorkLog]:
        """ID ile zaman girişi getirir."""
        return self.db.query(WorkLog).options(
            joinedload(WorkLog.customer),
            joinedload(WorkLog.project),
            joinedload(WorkLog.work_type)
        ).filter(WorkLog.id == id).first()
    
    def get_by_id_or_404(self, id: int) -> WorkLog:
        """ID ile zaman girişi getirir, yoksa hata fırlatır."""
        obj = self.get_by_id(id)
        if not obj:
            raise NotFoundError("Time entry", id)
        return obj
    
    def get_user_logs(
        self,
        user_id: UUID,
        skip: int = 0,
        limit: int = 100,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None
    ) -> List[WorkLog]:
        """
        Kullanıcının zaman girişlerini listeler.
        
        Args:
            user_id: Kullanıcı ID'si
            skip: Atlanacak kayıt sayısı
            limit: Maksimum kayıt sayısı
            start_date: Başlangıç tarihi filtresi
            end_date: Bitiş tarihi filtresi
        """
        query = self.db.query(WorkLog).options(
            joinedload(WorkLog.customer),
            joinedload(WorkLog.project),
            joinedload(WorkLog.work_type)
        ).filter(WorkLog.user_id == user_id)
        
        # Tarih filtreleri
        if start_date:
            query = query.filter(WorkLog.date_worked >= start_date)
        if end_date:
            query = query.filter(WorkLog.date_worked <= end_date)
        
        return query.order_by(WorkLog.date_worked.desc()).offset(skip).limit(limit).all()
    
    def get_all_logs(
        self,
        skip: int = 0,
        limit: int = 100,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        customer_id: Optional[UUID] = None,
        project_id: Optional[UUID] = None,
        user_id: Optional[UUID] = None
    ) -> List[WorkLog]:
        """
        Tüm zaman girişlerini listeler (Admin için).
        
        Filtreleme seçenekleri:
        - Tarih aralığı
        - Müşteri
        - Proje
        - Kullanıcı
        """
        query = self.db.query(WorkLog).options(
            joinedload(WorkLog.customer),
            joinedload(WorkLog.project),
            joinedload(WorkLog.work_type)
        )
        
        # Filtreler
        if start_date:
            query = query.filter(WorkLog.date_worked >= start_date)
        if end_date:
            query = query.filter(WorkLog.date_worked <= end_date)
        if customer_id:
            query = query.filter(WorkLog.customer_id == customer_id)
        if project_id:
            query = query.filter(WorkLog.project_id == project_id)
        if user_id:
            query = query.filter(WorkLog.user_id == user_id)
        
        return query.order_by(WorkLog.date_worked.desc()).offset(skip).limit(limit).all()
    
    def count_user_logs(self, user_id: UUID) -> int:
        """Kullanıcının toplam zaman girişi sayısını döner."""
        return self.db.query(WorkLog).filter(WorkLog.user_id == user_id).count()
    
    def count_all_logs(
        self,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        customer_id: Optional[UUID] = None,
        project_id: Optional[UUID] = None,
        user_id: Optional[UUID] = None
    ) -> int:
        """Toplam zaman girişi sayısını döner."""
        query = self.db.query(WorkLog)
        if start_date:
            query = query.filter(WorkLog.date_worked >= start_date)
        if end_date:
            query = query.filter(WorkLog.date_worked <= end_date)
        if customer_id:
            query = query.filter(WorkLog.customer_id == customer_id)
        if project_id:
            query = query.filter(WorkLog.project_id == project_id)
        if user_id:
            query = query.filter(WorkLog.user_id == user_id)
        return query.count()
    
    # =========================================================================
    # UPDATE
    # =========================================================================
    
    def update(
        self,
        id: int,
        data: WorkLogUpdate,
        user_id: UUID,
        is_admin: bool = False
    ) -> WorkLog:
        """
        Zaman girişini günceller.
        
        Args:
            id: Güncellenecek kaydın ID'si
            data: Güncelleme verisi
            user_id: İsteği yapan kullanıcının ID'si
            is_admin: Kullanıcı admin mi?
        
        Raises:
            NotFoundError: Kayıt bulunamazsa
            ForbiddenError: Kullanıcı yetkili değilse
        """
        db_obj = self.get_by_id_or_404(id)
        
        # Yetki kontrolü: Sadece sahibi veya admin güncelleyebilir
        if db_obj.user_id != user_id and not is_admin:
            raise ForbiddenError("Bu zaman girişini düzenleme yetkiniz yok")
        
        # Güncelleme verilerini al
        update_data = data.model_dump(exclude_unset=True)
        
        # İlişkili kaydı değiştiriyorsa varlığını doğrula
        if "customer_id" in update_data or "project_id" in update_data or "work_type_id" in update_data:
            self._validate_references(
                update_data.get("customer_id", db_obj.customer_id),
                update_data.get("project_id", db_obj.project_id),
                update_data.get("work_type_id", db_obj.work_type_id),
                activity_type_id=update_data.get("activity_type_id", db_obj.activity_type_id),
                platform_id=update_data.get("platform_id", db_obj.platform_id),
                work_line_id=update_data.get("work_line_id", db_obj.work_line_id),
                issue_id=update_data.get("issue_id", db_obj.issue_id)
            )
        
        # Auto-sync billable_duration_hours when duration_hours changes,
        # but only if billable was never manually overridden (still equals old duration).
        if "duration_hours" in update_data and "billable_duration_hours" not in update_data:
            old_duration = db_obj.duration_hours
            old_billable = db_obj.billable_duration_hours
            if old_billable is None or old_billable == old_duration:
                update_data["billable_duration_hours"] = update_data["duration_hours"]

        # Alanları güncelle
        for field, value in update_data.items():
            setattr(db_obj, field, value)
        
        self.db.commit()
        self.db.refresh(db_obj)
        return db_obj
    
    # =========================================================================
    # DELETE
    # =========================================================================
    
    def delete(self, id: int, user_id: UUID, is_admin: bool = False) -> bool:
        """
        Zaman girişini siler.
        
        Args:
            id: Silinecek kaydın ID'si
            user_id: İsteği yapan kullanıcının ID'si
            is_admin: Kullanıcı admin mi?
        
        Raises:
            NotFoundError: Kayıt bulunamazsa
            ForbiddenError: Kullanıcı yetkili değilse
        """
        db_obj = self.get_by_id_or_404(id)
        
        # Yetki kontrolü
        if db_obj.user_id != user_id and not is_admin:
            raise ForbiddenError("Bu zaman girişini silme yetkiniz yok")
        
        self.db.delete(db_obj)
        self.db.commit()
        return True
    
    # =========================================================================
    # Helpers
    # =========================================================================
    
    def _validate_references(
        self,
        customer_id: UUID,
        project_id: UUID,
        work_type_id: UUID,
        activity_type_id: Optional[UUID] = None,
        platform_id: Optional[UUID] = None,
        work_line_id: Optional[UUID] = None,
        issue_id: Optional[UUID] = None
    ) -> None:
        """İlişkili kayıtların varlığını doğrular."""
        # Müşteri kontrolü
        customer = self.db.query(Customer).filter(
            Customer.id == customer_id,
            Customer.is_active == True  # noqa: E712
        ).first()
        if not customer:
            raise NotFoundError("Customer", customer_id)
        
        # Proje kontrolü
        project = self.db.query(Project).filter(
            Project.id == project_id,
            Project.is_active == True  # noqa: E712
        ).first()
        if not project:
            raise NotFoundError("Project", project_id)
        
        # İş tipi kontrolü
        work_type = self.db.query(WorkType).filter(
            WorkType.id == work_type_id,
            WorkType.is_active == True  # noqa: E712
        ).first()
        if not work_type:
            raise NotFoundError("Work type", work_type_id)
            
        # Activity Type check
        if activity_type_id:
            from ..models.activity_type import ActivityType
            obj = self.db.query(ActivityType).filter(ActivityType.id == activity_type_id).first()
            if not obj: raise NotFoundError("Activity Type", activity_type_id)

        # Platform check
        if platform_id:
            from ..models.platform import Platform
            obj = self.db.query(Platform).filter(Platform.id == platform_id).first()
            if not obj: raise NotFoundError("Platform", platform_id)

        # Work Line check
        if work_line_id:
            from ..models.work_line import WorkLine
            obj = self.db.query(WorkLine).filter(WorkLine.id == work_line_id).first()
            if not obj: raise NotFoundError("Work Line", work_line_id)

        # Issue check
        if issue_id:
            from ..models.issue import Issue
            obj = self.db.query(Issue).filter(Issue.id == issue_id).first()
            if not obj: raise NotFoundError("Issue", issue_id)
    
    def to_response(self, work_log: WorkLog, user_name: Optional[str] = None) -> dict:
        """WorkLog modelini response dict'e dönüştürür."""
        return {
            "id": work_log.id,
            "user_id": work_log.user_id,
            "customer_id": work_log.customer_id,
            "project_id": work_log.project_id,
            "work_type_id": work_log.work_type_id,
            "date_worked": work_log.date_worked,
            "duration_hours": work_log.duration_hours,
            "billable_duration_hours": work_log.billable_duration_hours,
            "description": work_log.description,
            "created_at": work_log.created_at,
            "updated_at": work_log.updated_at,
            "customer_name": work_log.customer.name if work_log.customer else None,
            "project_name": work_log.project.name if work_log.project else None,
            "work_type_name": work_log.work_type.name if work_log.work_type else None,
            "activity_type_name": work_log.activity_type.name if work_log.activity_type else None,
            "platform_name": work_log.platform.name if work_log.platform else None,
            "work_line_name": work_log.work_line.name if work_log.work_line else None,
            "issue_key_manual": work_log.issue_key_manual,
            
            # IDs for Edit Mode
            "activity_type_id": work_log.activity_type_id,
            "platform_id": work_log.platform_id,
            "work_line_id": work_log.work_line_id,
            "issue_id": work_log.issue_id,
            
            "user_name": user_name
        }
