"""
Platform Pydantic Schemas
"""

from pydantic import BaseModel, Field
from typing import Optional
from uuid import UUID
from datetime import datetime


class PlatformBase(BaseModel):
    """Base schema for Platform"""
    name: str = Field(..., min_length=1, max_length=100)
    code: str = Field(..., min_length=1, max_length=20)
    description: Optional[str] = Field(None, max_length=255)
    is_active: bool = True


class PlatformCreate(PlatformBase):
    """Schema for creating Platform"""
    pass


class PlatformUpdate(BaseModel):
    """Schema for updating Platform"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    code: Optional[str] = Field(None, min_length=1, max_length=20)
    description: Optional[str] = Field(None, max_length=255)
    is_active: Optional[bool] = None


class PlatformResponse(PlatformBase):
    """Schema for Platform response"""
    id: UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
