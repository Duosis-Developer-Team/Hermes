# =============================================================================
# HERMES PLATFORM - Plan Time Router
# =============================================================================
# Admin-Driven Meeting Invite System.
# Admin oluşturur, kullanıcılar accept/reject ile yanıt verir.
# =============================================================================

from typing import List, Optional
from uuid import UUID
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ..database import get_db
from ..models.plan_time import PlanTime, PlanTimeAssignment
from shared.auth import get_current_user, require_admin, CurrentUser

router = APIRouter(prefix="/plan-times", tags=["Plan Times"])


# =============================================================================
# Schemas (inline, no separate schemas file needed)
# =============================================================================

class PlanTimeCreate(BaseModel):
    customer_id: UUID
    project_id: UUID
    start_date: date
    end_date: date
    start_time: Optional[str] = None   # "HH:MM"
    end_time: Optional[str] = None     # "HH:MM"
    recurrence: str = "one_time"       # one_time | weekly | monthly
    description: Optional[str] = None
    user_ids: List[UUID]               # Atanacak kullanıcılar (en az 1)


class PlanTimeUpdate(BaseModel):
    customer_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    recurrence: Optional[str] = None
    description: Optional[str] = None
    user_ids: Optional[List[UUID]] = None  # None → dokunma, [] → hepsini sil


class RespondPayload(BaseModel):
    status: str  # "accepted" | "rejected"


# =============================================================================
# Helpers
# =============================================================================

def _serialize_plan_time(pt: PlanTime, user_status: Optional[str] = None) -> dict:
    return {
        "id": str(pt.id),
        "created_by_id": str(pt.created_by_id),
        "customer_id": str(pt.customer_id),
        "customer_name": pt.customer.name if pt.customer else None,
        "project_id": str(pt.project_id),
        "project_name": pt.project.name if pt.project else None,
        "start_date": pt.start_date.isoformat() if pt.start_date else None,
        "end_date": pt.end_date.isoformat() if pt.end_date else None,
        "start_time": pt.start_time,
        "end_time": pt.end_time,
        "recurrence": pt.recurrence,
        "description": pt.description,
        "created_at": pt.created_at.isoformat() if pt.created_at else None,
        # Kullanıcıya özel statü (my endpoint için)
        "status": user_status,
        # Admin görünümü için tüm atamalar
        "assignments": [
            {"user_id": str(a.user_id), "status": a.status}
            for a in pt.assignments
        ]
    }


# =============================================================================
# CREATE — Admin only
# =============================================================================

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_plan_time(
    data: PlanTimeCreate,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Admin: Yeni Plan Time olayı oluşturur ve kullanıcılara atar.
    Her atama için 'pending' statüsünde PlanTimeAssignment kaydı oluşturulur.
    """
    if not data.user_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="En az bir kullanıcı seçilmelidir."
        )

    if data.recurrence not in ("one_time", "weekly", "monthly"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Geçersiz recurrence değeri. 'one_time', 'weekly' veya 'monthly' olmalıdır."
        )

    plan = PlanTime(
        created_by_id=UUID(admin.id),
        customer_id=data.customer_id,
        project_id=data.project_id,
        start_date=data.start_date,
        end_date=data.end_date,
        start_time=data.start_time,
        end_time=data.end_time,
        recurrence=data.recurrence,
        description=data.description,
    )
    db.add(plan)
    db.flush()  # ID almak için flush

    # Creator her zaman assignee olur (listede olmasa bile)
    creator_uuid = UUID(admin.id)
    all_user_ids = list({creator_uuid} | {uid for uid in data.user_ids})

    for user_id in all_user_ids:
        assignment = PlanTimeAssignment(
            plan_time_id=plan.id,
            user_id=user_id,
            status="pending"
        )
        db.add(assignment)

    db.commit()
    db.refresh(plan)

    return {"success": True, "data": _serialize_plan_time(plan)}


# =============================================================================
# GET MY — Kullanıcının kendi atamaları (tarih filtreli, takvim için)
# =============================================================================

@router.get("/my")
async def get_my_plan_times(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Kullanıcının atandığı plan time olaylarını getirir.
    Tarih aralığı ile filtrelenebilir (haftalık takvim için).
    """
    user_uuid = UUID(current_user.id)

    query = (
        db.query(PlanTimeAssignment)
        .join(PlanTime, PlanTimeAssignment.plan_time_id == PlanTime.id)
        .filter(PlanTimeAssignment.user_id == user_uuid)
    )

    if start_date:
        # Recurring plans always show after their start; one_time needs end_date in range
        query = query.filter(
            or_(
                PlanTime.end_date >= start_date,
                PlanTime.recurrence.in_(["weekly", "monthly", "daily"])
            )
        )
    if end_date:
        query = query.filter(PlanTime.start_date <= end_date)

    assignments = query.all()

    data = []
    for a in assignments:
        serialized = _serialize_plan_time(a.plan_time, user_status=a.status)
        serialized["assignment_id"] = str(a.id)
        data.append(serialized)

    return {"success": True, "data": data}


# =============================================================================
# GET ALL — Admin only
# =============================================================================

@router.get("")
async def get_all_plan_times(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Admin: Tüm plan time olaylarını getirir.
    """
    query = db.query(PlanTime)

    if start_date:
        query = query.filter(
            or_(
                PlanTime.end_date >= start_date,
                PlanTime.recurrence.in_(["weekly", "monthly", "daily"])
            )
        )
    if end_date:
        query = query.filter(PlanTime.start_date <= end_date)

    plans = query.order_by(PlanTime.start_date.desc()).all()

    return {
        "success": True,
        "data": [_serialize_plan_time(p) for p in plans]
    }


# =============================================================================
# RESPOND — Kullanıcının accept/reject yanıtı
# =============================================================================

@router.patch("/{plan_time_id}/respond")
async def respond_to_plan_time(
    plan_time_id: UUID,
    payload: RespondPayload,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Kullanıcı kendi atamasına yanıt verir (accept/reject).
    Fikir değiştirilmek istenirse tekrar çağrılabilir.
    """
    if payload.status not in ("accepted", "rejected"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Geçersiz statü. 'accepted' veya 'rejected' olmalıdır."
        )

    user_uuid = UUID(current_user.id)

    assignment = (
        db.query(PlanTimeAssignment)
        .filter(
            PlanTimeAssignment.plan_time_id == plan_time_id,
            PlanTimeAssignment.user_id == user_uuid
        )
        .first()
    )

    if not assignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bu plan time olayına atanmamışsınız."
        )

    assignment.status = payload.status
    db.commit()
    db.refresh(assignment)

    return {
        "success": True,
        "data": {
            "assignment_id": str(assignment.id),
            "plan_time_id": str(assignment.plan_time_id),
            "status": assignment.status
        }
    }


# =============================================================================
# UPDATE — Admin only
# =============================================================================

@router.patch("/{plan_time_id}")
async def update_plan_time(
    plan_time_id: UUID,
    data: PlanTimeUpdate,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Admin: Plan time olayını günceller (tarih, saat, recurrence, açıklama).
    Atamalar (user_ids) değiştirilmez.
    """
    plan = db.query(PlanTime).filter(PlanTime.id == plan_time_id).first()

    if not plan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Plan time bulunamadı."
        )

    if data.recurrence and data.recurrence not in ("one_time", "weekly", "monthly", "daily"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Geçersiz recurrence değeri."
        )

    if data.customer_id is not None:
        plan.customer_id = data.customer_id
    if data.project_id is not None:
        plan.project_id = data.project_id
    if data.start_date is not None:
        plan.start_date = data.start_date
    if data.end_date is not None:
        plan.end_date = data.end_date
    if data.start_time is not None:
        plan.start_time = data.start_time
    if data.end_time is not None:
        plan.end_time = data.end_time
    if data.recurrence is not None:
        plan.recurrence = data.recurrence
    if data.description is not None:
        plan.description = data.description

    # Assignments güncelle — user_ids verilmişse
    if data.user_ids is not None:
        existing = {a.user_id: a for a in plan.assignments}
        new_ids = set(data.user_ids)

        # Yeni eklenenlere pending assignment oluştur
        for uid in new_ids:
            if uid not in existing:
                db.add(PlanTimeAssignment(
                    plan_time_id=plan.id,
                    user_id=uid,
                    status="pending"
                ))

        # Listeden çıkarılanları sil
        for uid, assignment in existing.items():
            if uid not in new_ids:
                db.delete(assignment)

    db.commit()
    db.refresh(plan)

    return {"success": True, "data": _serialize_plan_time(plan)}


# =============================================================================
# DELETE — Admin only
# =============================================================================

@router.delete("/{plan_time_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_plan_time(
    plan_time_id: UUID,
    admin: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Admin: Plan time olayını siler. Cascade ile tüm atamalar da silinir.
    """
    plan = db.query(PlanTime).filter(PlanTime.id == plan_time_id).first()

    if not plan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Plan time bulunamadı."
        )

    db.delete(plan)
    db.commit()
