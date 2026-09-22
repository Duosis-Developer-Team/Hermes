# =============================================================================
# HERMES - Is kalemi → eski/yeni yanit sekli (PM rework P1.2 / A9)
# =============================================================================
# Iki serializer tek nesneden turer:
#   to_response(item)          → WorkItemResponse (TaskResponse ust kumesi;
#                                internal /core/tasks)
#   to_public_task(item)       → PublicTask (/v1; SEKIL DEGISMEZ)
#
# Eski alanlarin turetimi (08-p1-plani §4):
#   assignee_user_id     owner ∨ ilk atanan katilimci (∨ reporter — hic
#                        katilimci yoksa; NOT NULL alan bos kalmaz)
#   assigner_user_id     reporter
#   status               durum adindan/kategorisinden eski sozcuk
#   assignment_batch_id  >1 katilimcida is kaleminin id'si (frontend
#                        gruplama anahtari); tekilde None
#   task_code            item_key (alias'lar ayrica cozulur)
#   scheduled_date       start_date
#   completed_at         done kategorisinde closed_at
#
# `for_participant`: eski bulk/group uclari N satir donuyordu; ayni is
# kalemi N kez, her biri o katilimcinin bakisiyla (id = katilimci id,
# assignee = katilimci) serilestirilir — istemci sayimlari degismez.
# =============================================================================

from __future__ import annotations

from typing import List, Optional

from ..models.work_item import WorkItem, WorkItemParticipant, WorkflowState
from ..public_api.schemas.resources import PublicRef, PublicTask
from ..schemas.task import TaskActivityEventResponse, TaskCommentResponse
from ..schemas.work_item import (
    ParticipantResponse, WorkflowStateResponse, WorkItemResponse,
)
from .work_item_service import (
    LEGACY_BY_CATEGORY, LEGACY_BY_NAME, assignee_participants, legacy_status_of,
)


def state_response(st: WorkflowState) -> WorkflowStateResponse:
    return WorkflowStateResponse(
        id=st.id, name=st.name, category=st.category, position=st.position,
        is_default=bool(st.is_default), is_active=bool(st.is_active),
        legacy_status=LEGACY_BY_NAME.get(st.name) or LEGACY_BY_CATEGORY.get(st.category, "pending"),
    )


def participant_status(item: WorkItem, p: WorkItemParticipant) -> str:
    """Eski satir durumunun karsiligi (kisi basi)."""
    item_legacy = legacy_status_of(item)
    if item_legacy in ("cancelled", "rejected"):
        return item_legacy
    parts = assignee_participants(item)
    if len(parts) == 1 and p.role == "assignee":
        return item_legacy
    if p.completed_at is not None:
        return "completed"
    if p.accepted_at is not None:
        return "in_progress"
    return "pending"


def participant_response(item: WorkItem, p: WorkItemParticipant) -> ParticipantResponse:
    return ParticipantResponse(
        id=p.id, user_id=p.user_id, role=p.role, accepted_at=p.accepted_at,
        completed_at=p.completed_at, note=p.note, status=participant_status(item, p),
    )


def primary_assignee(item: WorkItem):
    if item.owner_user_id is not None:
        return item.owner_user_id
    parts = assignee_participants(item)
    if parts:
        return sorted(parts, key=lambda p: (p.created_at or 0, str(p.id)))[0].user_id
    return item.reporter_user_id


def to_response(item: WorkItem, *, for_participant: Optional[WorkItemParticipant] = None) -> WorkItemResponse:
    legacy = legacy_status_of(item)
    parts = assignee_participants(item)
    project = item.project
    customer = project.customer if project is not None else None
    completed_at = item.closed_at if (item.state is not None and item.state.category == "done") else None
    if for_participant is not None:
        row_id = for_participant.id
        assignee = for_participant.user_id
        row_status = participant_status(item, for_participant)
        completed_at = for_participant.completed_at
        note = for_participant.note
        completed_by = for_participant.user_id if for_participant.completed_at else None
    else:
        row_id = item.id
        assignee = primary_assignee(item)
        row_status = legacy
        me = next((p for p in parts if item.owner_user_id and p.user_id == item.owner_user_id), None)
        note = me.note if me else (parts[0].note if len(parts) == 1 else None)
        completed_by = (me.user_id if me and me.completed_at else None)
    live_children = [c for c in (item.children or []) if c.archived_at is None]
    return WorkItemResponse(
        id=row_id,
        task_number=item.legacy_task_number,
        task_code=item.item_key,
        customer_id=customer.id if customer else project.customer_id,
        customer_name=customer.name if customer else None,
        project_id=item.project_id,
        project_name=project.name if project else None,
        sub_project_id=item.sub_project_id,
        sub_project_name=item.sub_project.name if item.sub_project else None,
        title=item.title,
        description=item.description,
        assignee_user_id=assignee,
        assigner_user_id=item.reporter_user_id,
        scheduled_date=item.start_date or item.created_at.date(),
        due_date=item.due_date,
        estimated_duration_minutes=item.estimate_minutes,
        priority=item.priority,
        status=row_status,
        task_type=item.item_type,
        assignee_note=note,
        completed_at=completed_at,
        completed_by_user_id=completed_by,
        created_at=item.created_at,
        updated_at=item.updated_at,
        archived_at=item.archived_at,
        assignment_batch_id=item.id if len(parts) > 1 else None,
        closed_at=item.closed_at,
        archive_reason=item.archive_reason,
        # yeni alanlar
        item_key=item.item_key,
        item_type=item.item_type,
        state=state_response(item.state) if item.state is not None else None,
        owner_user_id=item.owner_user_id,
        reporter_user_id=item.reporter_user_id,
        participants=[participant_response(item, p) for p in item.participants],
        is_billable=item.is_billable,
        billable_override_by=item.billable_override_by,
        origin_type=item.origin_type,
        origin_ref_id=item.origin_ref_id,
        parent_id=item.parent_id,
        parent_key=item.parent.item_key if item.parent is not None else None,
        subtask_count=len(live_children),
        subtask_done_count=sum(
            1 for c in live_children if c.state is not None and c.state.category == "done"
        ),
    )


def to_rows(item: WorkItem) -> List[WorkItemResponse]:
    """Eski bulk/group uclari: katilimci basina bir satir (ayni is kalemi)."""
    parts = assignee_participants(item)
    if not parts:
        return [to_response(item)]
    return [to_response(item, for_participant=p) for p in parts]


def to_public_task(item: WorkItem, *, for_participant: Optional[WorkItemParticipant] = None) -> PublicTask:
    project = item.project
    customer = project.customer
    assignee = for_participant.user_id if for_participant is not None else primary_assignee(item)
    return PublicTask(
        task_code=item.item_key,
        task_type=item.item_type or "task",
        title=item.title,
        description=item.description,
        status=participant_status(item, for_participant) if for_participant else legacy_status_of(item),
        priority=item.priority,
        customer=PublicRef(id=customer.id, name=customer.name),
        project=PublicRef(id=project.id, name=project.name),
        sub_project=(PublicRef(id=item.sub_project_id, name=item.sub_project.name)
                     if item.sub_project_id and item.sub_project else None),
        assignee_user_id=assignee,
        assigner_user_id=item.reporter_user_id,
        scheduled_date=item.start_date or item.created_at.date(),
        due_date=item.due_date,
        completed_at=item.closed_at if (item.state is not None and item.state.category == "done") else None,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def activity_response(e) -> TaskActivityEventResponse:
    return TaskActivityEventResponse(
        id=e.id, task_id=e.work_item_id, actor_user_id=e.actor_user_id,
        event_type=e.event_type, event_data=e.event_data, created_at=e.created_at,
    )


def comment_response(c) -> TaskCommentResponse:
    return TaskCommentResponse(
        id=c.id, task_id=c.work_item_id, author_user_id=c.author_user_id, body=c.body,
        created_at=c.created_at, updated_at=c.updated_at,
    )
