# =============================================================================
# HERMES PLATFORM - User Service
# =============================================================================
# Bu dosya, kullanıcı yönetimi iş mantığını içerir. Tüm CRUD işlemleri
# ve kullanıcı ile ilgili iş kuralları bu servis üzerinden yönetilir.
# =============================================================================

from typing import List, Optional
from uuid import UUID
from sqlalchemy import false
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
    
    def create(self, user_data: UserCreate, *, tenant_id) -> User:
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
        # E-posta tek kanonik yazimla saklanir (kucuk harf) — SSO
        # dizininden gelen yazim ne olursa olsun ayni kaydi bulur.
        user_data.email = (user_data.email or "").strip().lower()

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

            # TENANT UYELIGI — cutover sonrasi ZORUNLU.
            #
            # `users` GLOBAL bir tablodur; bir kimligin bir organizasyona
            # erisimi YALNIZCA aktif uyelik satiriyla vardir. Cutover'dan
            # once kullanici yaratmak yeterliydi; sonra degil. Uyelik
            # yaratilmayinca kullanici olusuyor, listede gorunuyor, ama:
            #   - giris "E-posta veya sifre hatali" ile reddediliyor
            #     (parola dogru olsa bile — uyelik yok),
            #   - rol atamasi "User not found" donuyor (ayni mesaj
            #     bilerek kullanilir, numaralandirmayi onlemek icin).
            # Canlida birebir bu yasandi.
            if tenant_id is not None:
                from ..models.tenancy import TenantMembership

                self.db.add(TenantMembership(
                    tenant_id=tenant_id,
                    user_id=db_user.id,
                    status="active",
                ))
                self.db.flush()

            # RBAC gecis koprusu: legacy is_admin=True ile olusturulan
            # kullanici system-admin rolunu de alir (tek dogruluk
            # kaynagi rol; sutun turetilmis).
            if db_user.is_admin:
                from .rbac_service import sync_admin_role_from_legacy_flag

                sync_admin_role_from_legacy_flag(
                    self.db, user_id=db_user.id, is_admin=True,
                    tenant_id=tenant_id,
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
    
    # =========================================================================
    # TENANT KAPSAMI (2026-09-29)
    # =========================================================================
    # `users` global bir tablodur. Tenant yonetim yuzeyi (liste, detay,
    # guncelle, sil) YALNIZCA cagiranin mevcut tenant'inda uyelik satiri
    # olan kimlikleri gorur/etkiler; baska tenant'in kullanicisi = var
    # olmayan kullanici (404, ayni yanit). Platform yuzeyi ayridir.

    @staticmethod
    def tenant_uuid(tenant_id) -> Optional[UUID]:
        try:
            return UUID(str(tenant_id))
        except (TypeError, ValueError):
            return None

    def tenant_members_query(self, tenant_id, *, include_inactive: bool):
        """Bu tenant'in uyeleri. include_inactive=False: kullanici aktif
        VE uyelik aktif; True: bu tenant'ta HERHANGI durumda uyeligi olan
        her kullanici. Bozuk tenant -> bos sonuc (fail-closed)."""
        from ..models.tenancy import TenantMembership
        from .membership_service import ACTIVE_MEMBERSHIP_STATUS

        tid = self.tenant_uuid(tenant_id)
        query = self.db.query(User).join(
            TenantMembership,
            (TenantMembership.user_id == User.id)
            & (TenantMembership.tenant_id == tid),
        )
        if tid is None:
            return query.filter(false())
        if not include_inactive:
            query = query.filter(
                User.is_active == True,  # noqa: E712
                TenantMembership.status == ACTIVE_MEMBERSHIP_STATUS,
            )
        return query

    def get_in_tenant_or_404(self, user_id: UUID, *, tenant_id) -> User:
        """Bu tenant'ta uyeligi (her durumda) olan kullanici; aksi 404."""
        user = (
            self.tenant_members_query(tenant_id, include_inactive=True)
            .filter(User.id == user_id)
            .first()
        )
        if not user:
            raise NotFoundError("User", user_id)
        return user

    def has_other_memberships(self, user_id, *, tenant_id) -> bool:
        """Kullanicinin cagiran DISINDA bir tenant'ta (her durumda) uyelik
        satiri var mi? Varsa global `users` satiri ORTAK veridir: bir
        tenant admini onu degistiremez/yok edemez."""
        from ..models.tenancy import TenantMembership

        tid = self.tenant_uuid(tenant_id)
        return (
            self.db.query(TenantMembership.id)
            .filter(
                TenantMembership.user_id == user_id,
                TenantMembership.tenant_id != tid,
            )
            .first()
            is not None
        )

    def membership_statuses(self, user_ids, *, tenant_id) -> dict:
        """{user_id: bu tenant'taki uyelik durumu}."""
        from ..models.tenancy import TenantMembership

        tid = self.tenant_uuid(tenant_id)
        ids = list(user_ids)
        if tid is None or not ids:
            return {}
        rows = (
            self.db.query(TenantMembership.user_id, TenantMembership.status)
            .filter(
                TenantMembership.tenant_id == tid,
                TenantMembership.user_id.in_(ids),
            )
            .all()
        )
        return {uid: st for uid, st in rows}

    def holds_tenant_admin(self, user_id, *, tenant_id) -> bool:
        """Bu tenant'ta system-admin atamasi var mi (tenant-dogru)."""
        from ..models.rbac import RbacUserRole
        from .rbac_service import SYSTEM_ADMIN_CODE, get_role_by_code

        tid = self.tenant_uuid(tenant_id)
        admin_role = get_role_by_code(
            self.db, SYSTEM_ADMIN_CODE, tenant_id=tid
        )
        if admin_role is None:
            return False
        return (
            self.db.query(RbacUserRole.id)
            .filter(
                RbacUserRole.user_id == user_id,
                RbacUserRole.role_id == admin_role.id,
                RbacUserRole.tenant_id == tid,
            )
            .first()
            is not None
        )

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
        # BUYUK/kucuk harf duyarsiz: ayni kisi icin ikinci hesap
        # acilmasini onler (SSO dizini farkli yazimla donebilir).
        from sqlalchemy import func

        return (
            self.db.query(User)
            .filter(func.lower(User.email) == (email or "").strip().lower())
            .first()
        )
    
    def get_all(
        self,
        skip: int = 0,
        limit: int = 100,
        include_inactive: bool = False,
        *,
        tenant_id,
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
        query = self.tenant_members_query(
            tenant_id, include_inactive=include_inactive
        )
        return query.order_by(User.created_at.desc()).offset(skip).limit(limit).all()

    def count(self, include_inactive: bool = False, *, tenant_id) -> int:
        """
        Toplam kullanıcı sayısını döner.
        
        Args:
            include_inactive: Pasif kullanıcıları dahil et
        
        Returns:
            Toplam kullanıcı sayısı
        """
        return self.tenant_members_query(
            tenant_id, include_inactive=include_inactive
        ).count()
    
    # =========================================================================
    # UPDATE Operations
    # =========================================================================
    
    def update(
        self, user_id: UUID, user_data: UserUpdate, *, tenant_id
    ) -> User:
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
        # Kullaniciyi BU TENANT icinde bul (baska tenant = 404)
        db_user = self.get_in_tenant_or_404(user_id, tenant_id=tenant_id)
        
        # Güncelleme verilerini al (sadece set edilmiş alanları)
        update_data = user_data.model_dump(exclude_unset=True)

        # RBAC son-admin kilidi: bu tenant'in son aktif system-admin'i
        # pasiflestirilemez (tek ve cok tenant'li kullanici icin ayni).
        if update_data.get("is_active") is False and self.holds_tenant_admin(
            db_user.id, tenant_id=tenant_id
        ):
            from .rbac_service import enforce_last_admin_guard

            enforce_last_admin_guard(
                self.db, losing_user_id=db_user.id,
                tenant_id=self.tenant_uuid(tenant_id),
            )

        # CAPRAZ-TENANT KORUMASI (2026-09-29): kullanici BASKA tenant'larda
        # da uyeyse global `users` satiri ORTAK veridir.
        #   - is_active -> YALNIZCA bu tenant'taki uyelik durumu
        #     (false: 'suspended', true: 'active'); global bayrak degismez.
        #   - e-posta / parola / ad degisikligi -> 409 (gercekten DEGISEN
        #     deger; form ayni degeri geri gonderirse sorun degil).
        #   - Rol/admin bayraklari tenant kapsamlidir (rol atamasi) ve
        #     calismaya devam eder.
        if self.has_other_memberships(db_user.id, tenant_id=tenant_id):
            changed = []
            if ("email" in update_data
                    and (update_data["email"] or "").strip().lower()
                    != (db_user.email or "").lower()):
                changed.append("email")
            if update_data.get("password"):
                changed.append("password")
            if ("full_name" in update_data
                    and (update_data["full_name"] or None)
                    != (db_user.full_name or None)):
                changed.append("full_name")
            if changed:
                raise ConflictError(
                    message=(
                        "This user belongs to other workspaces; profile "
                        "and credentials can only be changed by the user "
                        "or a platform administrator."
                    ),
                    field=changed[0],
                )
            for key in ("email", "password", "full_name"):
                update_data.pop(key, None)
            if "is_active" in update_data:
                from ..models.tenancy import TenantMembership
                from .membership_service import ACTIVE_MEMBERSHIP_STATUS

                want_active = bool(update_data.pop("is_active"))
                self.db.query(TenantMembership).filter(
                    TenantMembership.user_id == db_user.id,
                    TenantMembership.tenant_id == self.tenant_uuid(tenant_id),
                ).update(
                    {"status": ACTIVE_MEMBERSHIP_STATUS if want_active
                     else "suspended"},
                    synchronize_session=False,
                )
        
        # E-posta değişiyorsa, çakışma kontrolü yap
        if "email" in update_data:
            update_data["email"] = (update_data["email"] or "").strip().lower()
        if ("email" in update_data
                and update_data["email"] != (db_user.email or "").lower()):
            existing = self.get_by_email(update_data["email"])
            # Kendi kaydini farkli yazimla guncellemek cakisma degildir.
            if existing and existing.id != db_user.id:
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
                tenant_id=tenant_id,
            )

        # Kaydet
        self.db.commit()
        self.db.refresh(db_user)
        return db_user
    
    # =========================================================================
    # DELETE Operations
    # =========================================================================
    
    def delete(
        self, user_id: UUID, soft: bool = False, *, tenant_id
    ) -> bool:
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
        from ..models.rbac import RbacUserRole
        from ..models.tenancy import TenantMembership
        from .rbac_service import enforce_last_admin_guard

        db_user = self.get_in_tenant_or_404(user_id, tenant_id=tenant_id)
        tid = self.tenant_uuid(tenant_id)

        # Bu tenant'ta system-admin atamasi var mi? (tenant-dogru kontrol;
        # users.is_admin coklu tenant'ta anlamsiz bir turev sutundur)
        holds_tenant_admin = self.holds_tenant_admin(
            db_user.id, tenant_id=tid
        )

        # CAPRAZ-TENANT KORUMASI (2026-09-29): `users` satiri GLOBALDIR.
        # Kullanicinin BASKA tenant'larda uyeligi varsa bir tenant admini
        # o kimligi yok edemez — yalnizca KENDI tenant'indaki uyelik
        # 'removed' yapilir ve bu tenant'in rol atamalari silinir. Global
        # satir ve diger uyelikler DOKUNULMADAN kalir.
        other_memberships = (
            self.db.query(TenantMembership.id)
            .filter(
                TenantMembership.user_id == db_user.id,
                TenantMembership.tenant_id != tid,
            )
            .count()
        )
        if other_memberships:
            # Son-admin kilidi: bu tenant'i adminsiz birakamaz (409).
            if holds_tenant_admin:
                enforce_last_admin_guard(
                    self.db, losing_user_id=db_user.id, tenant_id=tid
                )
            self.db.query(RbacUserRole).filter(
                RbacUserRole.user_id == db_user.id,
                RbacUserRole.tenant_id == tid,
            ).delete(synchronize_session=False)
            # Satir SILINMEZ, 'removed' yapilir: (1) gecmis kayitlardaki ad
            # cozumu (lookup include_inactive) calismaya devam eder; (2)
            # satir silinseydi alan adi otomatik katilimi kullaniciyi bir
            # sonraki SSO girisinde geri eklerdi.
            self.db.query(TenantMembership).filter(
                TenantMembership.user_id == db_user.id,
                TenantMembership.tenant_id == tid,
            ).update({"status": "removed"}, synchronize_session=False)
            self.db.commit()
            return True

        # Bu tenant kullanicinin SON uyeligi: eski davranis aynen.
        # RBAC son-admin kilidi: son aktif system-admin silinirse/pasif
        # yapilirsa kimse RBAC yonetemez — 409 ile engellenir.
        if db_user.is_admin or holds_tenant_admin:
            enforce_last_admin_guard(
                self.db, losing_user_id=db_user.id, tenant_id=tenant_id
            )

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
