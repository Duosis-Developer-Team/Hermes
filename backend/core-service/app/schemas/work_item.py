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
from typing import List, Literal, Optional
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
    billable_override_by: Optional[UUID] = None
    origin_type: Optional[str] = None
    origin_ref_id: Optional[UUID] = None
    parent_id: Optional[UUID] = None
    # A7 rollup: ust isin kodu ve alt is sayilari (arsivli alt isler haric).
    parent_key: Optional[str] = None
    subtask_count: int = 0
    subtask_done_count: int = 0


class WorkItemStatusUpdate(BaseModel):
    """PATCH /tasks/{id}/status — eski `status` YA DA yeni `state_id`."""
    status: Optional[str] = None
    state_id: Optional[UUID] = None


class WatcherAdd(BaseModel):
    """POST /tasks/{id}/watchers — `user_id` yoksa cagiran kendini ekler."""
    user_id: Optional[UUID] = None


LinkTypeLiteral = Literal["relates", "duplicates", "blocks"]


class WorkItemLinkCreate(BaseModel):
    """POST /tasks/{id}/links — `blocks` GORSEL + filtre; tarih/durum etkisi YOK."""
    to_item_id: UUID
    link_type: LinkTypeLiteral = "relates"


class WorkItemLinkResponse(BaseModel):
    id: UUID
    link_type: LinkTypeLiteral
    #: outbound = bu is → diger; inbound = diger → bu is
    direction: Literal["outbound", "inbound"]
    item_id: UUID
    item_key: Optional[str] = None
    title: str
    status: str
