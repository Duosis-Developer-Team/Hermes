"""
Platform Router - CRUD operations for platforms
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID

from ..database import get_db
from ..models.platform import Platform
from ..schemas.platform import PlatformCreate, PlatformUpdate, PlatformResponse
from shared.auth import require_admin

router = APIRouter(prefix="/platforms", tags=["Platforms"])


@router.get("", response_model=List[PlatformResponse])
async def get_all_platforms(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """Get all platforms"""
    items = db.query(Platform).filter(
        Platform.is_active == True
    ).offset(skip).limit(limit).all()
    return items


@router.get("/{item_id}", response_model=PlatformResponse)
async def get_platform(
    item_id: UUID,
    db: Session = Depends(get_db)
):
    """Get platform by ID"""
    item = db.query(Platform).filter(Platform.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Platform not found")
    return item


@router.post("", response_model=PlatformResponse, dependencies=[Depends(require_admin)])
async def create_platform(
    data: PlatformCreate,
    db: Session = Depends(get_db)
):
    """Create new platform (admin only)"""
    # Check for duplicate code
    existing = db.query(Platform).filter(Platform.code == data.code).first()
    if existing:
        raise HTTPException(status_code=400, detail="Platform code already exists")
    
    item = Platform(**data.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/{item_id}", response_model=PlatformResponse, dependencies=[Depends(require_admin)])
async def update_platform(
    item_id: UUID,
    data: PlatformUpdate,
    db: Session = Depends(get_db)
):
    """Update platform (admin only)"""
    item = db.query(Platform).filter(Platform.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Platform not found")
    
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(item, key, value)
    
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", dependencies=[Depends(require_admin)])
async def delete_platform(
    item_id: UUID,
    db: Session = Depends(get_db)
):
    """Soft delete platform (admin only)"""
    item = db.query(Platform).filter(Platform.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Platform not found")
    
    db.delete(item)
    db.commit()
    return {"message": "Platform deleted"}
