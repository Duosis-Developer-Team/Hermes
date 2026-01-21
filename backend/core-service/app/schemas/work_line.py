"""
Work Line Pydantic Schemas
"""

from pydantic import BaseModel, Field
from typing import Optional
from uuid import UUID
from datetime import datetime


class WorkLineBase(BaseModel):
    """Base schema for WorkLine"""
    name: str = Field(..., min_length=1, max_length=100)
    code: str = Field(..., min_length=1, max_length=20)
    description: Optional[str] = Field(None, max_length=255)
    is_active: bool = True


class WorkLineCreate(WorkLineBase):
    """Schema for creating WorkLine"""
    pass


class WorkLineUpdate(BaseModel):
    """Schema for updating WorkLine"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    code: Optional[str] = Field(None, min_length=1, max_length=20)
    description: Optional[str] = Field(None, max_length=255)
    is_active: Optional[bool] = None


class WorkLineResponse(WorkLineBase):
    """Schema for WorkLine response"""
    id: UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
