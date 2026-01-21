"""
Work Line Router - CRUD operations for work lines
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID

from ..database import get_db
from ..models.work_line import WorkLine
from ..schemas.work_line import WorkLineCreate, WorkLineUpdate, WorkLineResponse
from shared.auth import require_admin, get_current_user

router = APIRouter(prefix="/work-lines", tags=["Work Lines"])


@router.get("", response_model=List[WorkLineResponse])
async def get_all_work_lines(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: object = Depends(get_current_user)
):
    """Get all work lines"""
    items = db.query(WorkLine).filter(
        WorkLine.is_active == True
    ).offset(skip).limit(limit).all()
    return items


@router.get("/{item_id}", response_model=WorkLineResponse)
async def get_work_line(
    item_id: UUID,
    db: Session = Depends(get_db)
):
    """Get work line by ID"""
    item = db.query(WorkLine).filter(WorkLine.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Work line not found")
    return item


@router.post("", response_model=WorkLineResponse, dependencies=[Depends(require_admin)])
async def create_work_line(
    data: WorkLineCreate,
    db: Session = Depends(get_db)
):
    """Create new work line (admin only)"""
    # Check for duplicate code
    existing = db.query(WorkLine).filter(WorkLine.code == data.code).first()
    if existing:
        raise HTTPException(status_code=400, detail="Work line code already exists")
    
    item = WorkLine(**data.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/{item_id}", response_model=WorkLineResponse, dependencies=[Depends(require_admin)])
async def update_work_line(
    item_id: UUID,
    data: WorkLineUpdate,
    db: Session = Depends(get_db)
):
    """Update work line (admin only)"""
    item = db.query(WorkLine).filter(WorkLine.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Work line not found")
    
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(item, key, value)
    
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", dependencies=[Depends(require_admin)])
async def delete_work_line(
    item_id: UUID,
    db: Session = Depends(get_db)
):
    """Soft delete work line (admin only)"""
    item = db.query(WorkLine).filter(WorkLine.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Work line not found")
    
    db.delete(item)
    db.commit()
    return {"message": "Work line deleted"}
