# =============================================================================
# HERMES PLATFORM - User Service
# =============================================================================
# Bu dosya, kullanıcı yönetimi iş mantığını içerir. Tüm CRUD işlemleri
# ve kullanıcı ile ilgili iş kuralları bu servis üzerinden yönetilir.
# =============================================================================

from typing import List, Optional
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from ..models.user import User
from ..models.user import User, UserRole
from ..schemas.user import UserCreate, UserUpdate
from shared.auth import hash_password
from shared.exceptions import NotFoundError, ConflictError, ValidationError


class UserService:
    """
    Kullanıcı yönetimi servisi.
    
    Bu servis, kullanıcı CRUD işlemlerini ve ilgili iş kurallarını yönetir.
    FR 3.4 gereksinimlerini karşılar (Admin kullanıcı yönetimi).
    
    Tüm metodlar veritabanı işlemlerini encapsulate eder ve
    hata durumlarında uygun exception'lar fırlatır.
    
    Kullanım:
        service = UserService(db_session)
        user = service.create(user_data)
    """
    
    def __init__(self, db: Session):
        """
        UserService instance oluşturur.
        
        Args:
            db: SQLAlchemy veritabanı session'ı
        """
        self.db = db
    
    # =========================================================================
    # CREATE Operations
    # =========================================================================
    
    def create(self, user_data: UserCreate) -> User:
        """
        Yeni kullanıcı oluşturur.
        
        Args:
            user_data: Kullanıcı oluşturma verisi (email, password, etc.)
        
        Returns:
            Oluşturulan User nesnesi
        
        Raises:
            ConflictError: E-posta adresi zaten kullanılıyorsa
            ValidationError: Geçersiz veri varsa
        
        Örnek:
            user = service.create(UserCreate(
                email="yeni@sirket.com",
                password="guvenli123",
                full_name="Yeni Kullanıcı"
            ))
        """
        # E-posta kontrolü
        existing_user = self.get_by_email(user_data.email)
        if existing_user:
            raise ConflictError(
                message="This e-mail address is already in use",
                field="email"
            )
        
        # Şifreyi hash'le
        hashed_password = hash_password(user_data.password)
        
        # Admin check sync
        is_admin = user_data.is_admin
        if user_data.role == UserRole.ADMIN:
            is_admin = True
        elif is_admin:
            user_data.role = UserRole.ADMIN

        # User nesnesi oluştur
        db_user = User(
            email=user_data.email,
            full_name=user_data.full_name,
            hashed_password=hashed_password,
            is_admin=is_admin,
            role=user_data.role,
            is_active=True
        )
        
        # Veritabanına kaydet
        try:
            self.db.add(db_user)
            self.db.flush()
            # RBAC gecis koprusu: legacy is_admin=True ile olusturulan
            # kullanici system-admin rolunu de alir (tek dogruluk
            # kaynagi rol; sutun turetilmis).
            if db_user.is_admin:
                from .rbac_service import sync_admin_role_from_legacy_flag

                sync_admin_role_from_legacy_flag(
                    self.db, user_id=db_user.id, is_admin=True
                )
            self.db.commit()
            self.db.refresh(db_user)
            return db_user
        except IntegrityError:
            self.db.rollback()
            raise ConflictError(
                message="A conflict occurred while creating the user",
                field="email"
            )
    
    # =========================================================================
    # READ Operations
    # =========================================================================
    
    def get_by_id(self, user_id: UUID) -> Optional[User]:
        """
        ID ile kullanıcı getirir.
        
        Args:
            user_id: Kullanıcı UUID'si
        
        Returns:
            User nesnesi veya None (bulunamazsa)
        """
        return self.db.query(User).filter(User.id == user_id).first()
    
    def get_by_id_or_404(self, user_id: UUID) -> User:
        """
        ID ile kullanıcı getirir, bulunamazsa hata fırlatır.
        
        Args:
            user_id: Kullanıcı UUID'si
        
        Returns:
            User nesnesi
        
        Raises:
            NotFoundError: Kullanıcı bulunamazsa
        """
        user = self.get_by_id(user_id)
        if not user:
            raise NotFoundError("User", user_id)
        return user
    
    def get_by_email(self, email: str) -> Optional[User]:
        """
        E-posta ile kullanıcı getirir.
        
        Args:
            email: Kullanıcı e-posta adresi
        
        Returns:
            User nesnesi veya None (bulunamazsa)
        """
        return self.db.query(User).filter(User.email == email).first()
    
    def get_all(
        self,
        skip: int = 0,
        limit: int = 100,
        include_inactive: bool = False
    ) -> List[User]:
        """
        Tüm kullanıcıları listeler.
        
        Args:
            skip: Atlanacak kayıt sayısı (pagination için)
            limit: Maksimum kayıt sayısı
            include_inactive: Pasif kullanıcıları dahil et
        
        Returns:
            User listesi
        """
        query = self.db.query(User)
        
        if not include_inactive:
            query = query.filter(User.is_active == True)  # noqa: E712
        
        return query.order_by(User.created_at.desc()).offset(skip).limit(limit).all()
    
    def count(self, include_inactive: bool = False) -> int:
        """
        Toplam kullanıcı sayısını döner.
        
        Args:
            include_inactive: Pasif kullanıcıları dahil et
        
        Returns:
            Toplam kullanıcı sayısı
        """
        query = self.db.query(User)
        
        if not include_inactive:
            query = query.filter(User.is_active == True)  # noqa: E712
        
        return query.count()
    
    # =========================================================================
    # UPDATE Operations
    # =========================================================================
    
    def update(self, user_id: UUID, user_data: UserUpdate) -> User:
        """
        Kullanıcı bilgilerini günceller.
        
        Args:
            user_id: Güncellenecek kullanıcının UUID'si
            user_data: Güncelleme verisi
        
        Returns:
            Güncellenmiş User nesnesi
        
        Raises:
            NotFoundError: Kullanıcı bulunamazsa
            ConflictError: E-posta başka kullanıcıda varsa
        """
        # Kullanıcıyı bul
        db_user = self.get_by_id_or_404(user_id)
        
        # Güncelleme verilerini al (sadece set edilmiş alanları)
        update_data = user_data.model_dump(exclude_unset=True)
        
        # E-posta değişiyorsa, çakışma kontrolü yap
        if "email" in update_data and update_data["email"] != db_user.email:
            existing = self.get_by_email(update_data["email"])
            if existing:
                raise ConflictError(
                    message="This e-mail address is used by another user",
                    field="email"
                )
        
        # Şifre değişiyorsa hash'le
        if "password" in update_data:
            update_data["hashed_password"] = hash_password(update_data.pop("password"))
        
        # Role değişiyorsa is_admin'i de güncelle
        if "role" in update_data:
            if update_data["role"] == UserRole.ADMIN:
                db_user.is_admin = True
            elif "is_admin" not in update_data: # Eğer is_admin özellikle set edilmediyse rol tabanlı set et
                 # Dikkat: UserRole.ADMIN değilse is_admin'i False yapmalı mıyız? 
                 # Evet, rol sistemi esastır.
                 db_user.is_admin = False
                 
        # is_admin değişiyorsa rolü de güncelle
        if "is_admin" in update_data:
             if update_data["is_admin"]:
                 db_user.role = UserRole.ADMIN
             # False ise role dokunma, belki REVIEWER'dır. Ama ADMIN idiyse düşürmek lazım.
             elif db_user.role == UserRole.ADMIN:
                 db_user.role = UserRole.USER

        # Alanları güncelle
        for field, value in update_data.items():
            setattr(db_user, field, value)

        # RBAC gecis koprusu: legacy is_admin degisikligi rol atamasina
        # cevrilir (son-admin kilidi dahil — 409 fırlatabilir).
        if "is_admin" in update_data:
            from .rbac_service import sync_admin_role_from_legacy_flag

            sync_admin_role_from_legacy_flag(
                self.db,
                user_id=db_user.id,
                is_admin=bool(update_data["is_admin"]),
            )

        # Kaydet
        self.db.commit()
        self.db.refresh(db_user)
        return db_user
    
    # =========================================================================
    # DELETE Operations
    # =========================================================================
    
    def delete(self, user_id: UUID, soft: bool = False) -> bool:
        """
        Kullanıcıyı siler.
        
        Args:
            user_id: Silinecek kullanıcının UUID'si
            soft: True ise soft delete (is_active=False), False ise hard delete
        
        Returns:
            True (başarılı)
        
        Raises:
            NotFoundError: Kullanıcı bulunamazsa
        """
        db_user = self.get_by_id_or_404(user_id)

        # RBAC son-admin kilidi: son aktif system-admin silinirse/pasif
        # yapilirsa kimse RBAC yonetemez — 409 ile engellenir.
        if db_user.is_admin:
            from .rbac_service import enforce_last_admin_guard

            enforce_last_admin_guard(self.db, losing_user_id=db_user.id)

        if soft:
            # Soft delete - sadece pasif yap
            db_user.is_active = False
            self.db.commit()
        else:
            # Hard delete - veritabanından sil
            self.db.delete(db_user)
            self.db.commit()

        return True
    
    def reactivate(self, user_id: UUID) -> User:
        """
        Pasif kullanıcıyı tekrar aktif eder.
        
        Args:
            user_id: Aktifleştirilecek kullanıcının UUID'si
        
        Returns:
            Aktifleştirilen User nesnesi
        
        Raises:
            NotFoundError: Kullanıcı bulunamazsa
        """
        db_user = self.get_by_id_or_404(user_id)
        db_user.is_active = True
        self.db.commit()
        self.db.refresh(db_user)
        return db_user
