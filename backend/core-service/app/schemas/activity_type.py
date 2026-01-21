"""
Activity Type Pydantic Schemas
"""

from pydantic import BaseModel, Field
from typing import Optional
from uuid import UUID
from datetime import datetime


class ActivityTypeBase(BaseModel):
    """Base schema for ActivityType"""
    name: str = Field(..., min_length=1, max_length=100)
    code: str = Field(..., min_length=1, max_length=20)
    description: Optional[str] = Field(None, max_length=255)
    is_active: bool = True


class ActivityTypeCreate(ActivityTypeBase):
    """Schema for creating ActivityType"""
    pass


class ActivityTypeUpdate(BaseModel):
    """Schema for updating ActivityType"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    code: Optional[str] = Field(None, min_length=1, max_length=20)
    description: Optional[str] = Field(None, max_length=255)
    is_active: Optional[bool] = None


class ActivityTypeResponse(ActivityTypeBase):
    """Schema for ActivityType response"""
    id: UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
