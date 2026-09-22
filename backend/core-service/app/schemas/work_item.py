# =============================================================================
# HERMES - Is kalemi semalari (PM rework P1.2)
# =============================================================================
# `WorkItemResponse`, eski `TaskResponse`'un UST KUMESIdir: frontend'in
# dokunulmayan parcalari eski alanlari okumaya devam eder (assignee_user_id,
# assigner_user_id, status, assignment_batch_id, task_code ...), yeni
# parcalar `participants` ve `state`i okur. Iki sekil tek nesneden turer
# (work_item_compat.py) — ikinci bir gercek kaynak yok.
# =============================================================================
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel

from .task import TaskResponse


class WorkflowStateResponse(BaseModel):
    id: UUID
    name: str
    category: str
    position: int
    is_default: bool
    is_active: bool
    # Eski istemciler icin kategoriden turetilmis legacy durum sozcugu.
    legacy_status: str


class ParticipantResponse(BaseModel):
    id: UUID
    user_id: UUID
    role: str
    accepted_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    note: Optional[str] = None
    # Kisi basi turetilmis durum (eski satir durumunun karsiligi):
    # completed | in_progress | pending | (is kalemi iptal/redde ise o).
    status: str


class WorkItemResponse(TaskResponse):
    """Eski TaskResponse + is kalemi alanlari (additive)."""
    item_key: Optional[str] = None
    item_type: str = "task"
    state: Optional[WorkflowStateResponse] = None
    owner_user_id: Optional[UUID] = None
    reporter_user_id: Optional[UUID] = None
    participants: List[ParticipantResponse] = []
    is_billable: Optional[bool] = None
    origin_type: Optional[str] = None
    origin_ref_id: Optional[UUID] = None
    parent_id: Optional[UUID] = None


class WorkItemStatusUpdate(BaseModel):
    """PATCH /tasks/{id}/status — eski `status` YA DA yeni `state_id`."""
    status: Optional[str] = None
    state_id: Optional[UUID] = None
