"""
Activity Type Router - CRUD operations for activity types
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID

from ..database import get_db
from ..models.activity_type import ActivityType
from ..schemas.activity_type import ActivityTypeCreate, ActivityTypeUpdate, ActivityTypeResponse
from shared.auth import get_current_user
# RBAC R2: guard'lar izin-tabanli — is_admin bit'i karar mercii degil.
from ..authz import require_permissions
from shared.permissions import Perm

router = APIRouter(prefix="/activity-types", tags=["Activity Types"])


@router.get("", response_model=List[ActivityTypeResponse])
async def get_all_activity_types(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: object = Depends(get_current_user) # Allow any authenticated user
):
    """Get all activity types"""
    items = db.query(ActivityType).filter(
        ActivityType.is_active == True
    ).offset(skip).limit(limit).all()
    return items


@router.get("/{item_id}", response_model=ActivityTypeResponse)
async def get_activity_type(
    item_id: UUID,
    db: Session = Depends(get_db)
):
    """Get activity type by ID"""
    item = db.query(ActivityType).filter(ActivityType.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Activity type not found")
    return item


@router.post("", response_model=ActivityTypeResponse, dependencies=[Depends(require_permissions(Perm.REFERENCE_MANAGE))])
async def create_activity_type(
    data: ActivityTypeCreate,
    db: Session = Depends(get_db)
):
    """Create new activity type (admin only)"""
    # Check for duplicate code
    existing = db.query(ActivityType).filter(ActivityType.code == data.code).first()
    if existing:
        raise HTTPException(status_code=400, detail="Activity type code already exists")
    
    item = ActivityType(**data.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/{item_id}", response_model=ActivityTypeResponse, dependencies=[Depends(require_permissions(Perm.REFERENCE_MANAGE))])
async def update_activity_type(
    item_id: UUID,
    data: ActivityTypeUpdate,
    db: Session = Depends(get_db)
):
    """Update activity type (admin only)"""
    item = db.query(ActivityType).filter(ActivityType.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Activity type not found")
    
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(item, key, value)
    
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", dependencies=[Depends(require_permissions(Perm.REFERENCE_MANAGE))])
async def delete_activity_type(
    item_id: UUID,
    db: Session = Depends(get_db)
):
    """Soft delete activity type (admin only)"""
    item = db.query(ActivityType).filter(ActivityType.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Activity type not found")
    
    try:
        db.delete(item)
        db.commit()
        return {"message": "Activity type deleted"}
    except Exception as e:
        db.rollback()
        # Check for integrity error (foreign key constraint)
        if "integrityerror" in str(e).lower() or "foreign key constraint" in str(e).lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, 
                detail="This activity type cannot be deleted because it is used by existing records. Update the related work logs first."
            )
        raise e
