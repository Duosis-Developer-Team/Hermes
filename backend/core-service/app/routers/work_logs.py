# =============================================================================
# HERMES PLATFORM - Work Logs Router
# =============================================================================
# Zaman girişi endpoint'leri (FR 2.x).
# Tüm kullanıcılar kendi girişlerini oluşturabilir/görebilir.
# Admin'ler tüm girişleri görebilir/düzenleyebilir.
# =============================================================================

from typing import List, Optional
from uuid import UUID
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.work_log import WorkLog
from ..schemas.work_log import WorkLogCreate, WorkLogUpdate, WorkLogResponse, WorkLogListResponse
from ..services.work_log_service import WorkLogService
from shared.auth import get_current_user, require_admin, CurrentUser
from shared.exceptions import NotFoundError, ForbiddenError

router = APIRouter(prefix="/work-logs", tags=["Work Logs"])


# =============================================================================
# CREATE - Tüm kullanıcılar
# =============================================================================

@router.post("", response_model=WorkLogResponse, status_code=status.HTTP_201_CREATED)
async def create_work_log(
    data: WorkLogCreate,
    target_user_id: Optional[UUID] = Query(None, description="Admin: create log on behalf of this user"),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Yeni zaman girişi oluşturur.

    Admin, target_user_id query param'ı ile başka bir kullanıcı adına log oluşturabilir.
    """
    service = WorkLogService(db)
    try:
        if target_user_id and current_user.is_admin:
            effective_user_id = target_user_id
        else:
            effective_user_id = UUID(current_user.id)
        work_log = service.create(data, effective_user_id)
        return service.to_response(work_log)
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)


# =============================================================================
# READ - Kullanıcı kendi girişlerini, Admin hepsini görür
# =============================================================================

@router.get("", response_model=WorkLogListResponse)
async def list_work_logs(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    start_date: Optional[date] = Query(None, description="Başlangıç tarihi"),
    end_date: Optional[date] = Query(None, description="Bitiş tarihi"),
    user_id: Optional[UUID] = Query(None, description="Kullanıcı ID (Sadece Admin)"),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Kullanıcının kendi zaman girişlerini listeler.
    
    Standart kullanıcı sadece kendi girişlerini görür.
    Admin, user_id parametresi göndererek başkasının girişlerini görebilir.
    """
    service = WorkLogService(db)
    
    target_user_id = UUID(current_user.id)
    
    # Admin yetkisi kontrolü - Başkasının verisini istiyorsa
    if user_id:
        # Kendi ID'si ise sorun yok, başkası ise admin olmalı
        if str(user_id) != current_user.id:
            if not current_user.is_admin:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Başkasına ait zaman girişlerini görme yetkiniz yok"
                )
        target_user_id = user_id
    
    work_logs = service.get_user_logs(
        target_user_id,
        skip=skip,
        limit=limit,
        start_date=start_date,
        end_date=end_date
    )
    total = service.count_user_logs(target_user_id)
    
    return WorkLogListResponse(
        success=True,
        data=[service.to_response(wl) for wl in work_logs],
        total=total
    )


@router.get("/billable-summary")
async def get_billable_summary(
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Tüm projeler için toplam billable saat özetini döner (Admin).

    Tek bir DB sorgusuyla proje bazında SUM(billable_duration_hours) hesaplar.
    Dönüş: { "success": true, "data": { "<project_uuid>": <total_hours_float>, ... } }
    """
    rows = (
        db.query(WorkLog.project_id, func.sum(WorkLog.billable_duration_hours))
        .filter(WorkLog.project_id.isnot(None))
        .group_by(WorkLog.project_id)
        .all()
    )
    summary = {str(project_id): float(total or 0) for project_id, total in rows}
    return {"success": True, "data": summary}


@router.get("/all", response_model=WorkLogListResponse)
async def list_all_work_logs(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    customer_id: Optional[UUID] = Query(None),
    project_id: Optional[UUID] = Query(None),
    user_id: Optional[UUID] = Query(None),
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Tüm zaman girişlerini listeler (Admin).
    
    Raporlama ve dashboard için kullanılır.
    """
    service = WorkLogService(db)
    
    work_logs = service.get_all_logs(
        skip=skip,
        limit=limit,
        start_date=start_date,
        end_date=end_date,
        customer_id=customer_id,
        project_id=project_id,
        user_id=user_id
    )
    total = service.count_all_logs(
        start_date=start_date,
        end_date=end_date,
        customer_id=customer_id,
        project_id=project_id,
        user_id=user_id
    )
    
    return WorkLogListResponse(
        success=True,
        data=[service.to_response(wl) for wl in work_logs],
        total=total
    )


@router.get("/{work_log_id}", response_model=WorkLogResponse)
async def get_work_log(
    work_log_id: int,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Zaman girişi detaylarını getirir.
    
    Kullanıcı sadece kendi girişlerini, Admin hepsini görebilir.
    """
    service = WorkLogService(db)
    
    try:
        work_log = service.get_by_id_or_404(work_log_id)
        
        # Yetki kontrolü
        if str(work_log.user_id) != current_user.id and not current_user.is_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Bu zaman girişini görme yetkiniz yok"
            )
        
        return service.to_response(work_log)
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)


# =============================================================================
# UPDATE - Sahibi veya Admin
# =============================================================================

@router.put("/{work_log_id}", response_model=WorkLogResponse)
async def update_work_log(
    work_log_id: int,
    data: WorkLogUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Zaman girişini günceller.
    
    Sadece girişin sahibi veya Admin güncelleyebilir.
    """
    service = WorkLogService(db)
    
    try:
        work_log = service.update(
            work_log_id,
            data,
            UUID(current_user.id),
            current_user.is_admin
        )
        return service.to_response(work_log)
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)
    except ForbiddenError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=e.message)


# =============================================================================
# DELETE - Sahibi veya Admin
# =============================================================================

@router.delete("/{work_log_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_work_log(
    work_log_id: int,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Zaman girişini siler.
    
    Sadece girişin sahibi veya Admin silebilir.
    """
    service = WorkLogService(db)
    
    try:
        service.delete(work_log_id, UUID(current_user.id), current_user.is_admin)
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)
    except ForbiddenError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=e.message)
