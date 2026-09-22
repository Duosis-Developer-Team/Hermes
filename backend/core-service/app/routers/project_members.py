"""
=============================================================================
HERMES - Proje uyeleri (PM rework P2.1 / B2)
=============================================================================
Proje kapsamli uyelik yonetimi: `/projects/{project_id}/members`.

Yetki (09 §2 P2-5):
  - `projects.manage` → her sey (lead verme/alma dahil)
  - o projenin **lead**'i → kendi ekibini yonetir: `member`/`viewer`
    ekler, rolunu degistirir, cikarir; `lead` rolunu VEREMEZ/ALAMAZ
    (proje olceginde "son-admin" sorununu onlemek icin)
  - baskasi → 403 (uyelik gorunurlugu gizli bilgi degil; ama yonetim kapali)

Eski `/project-memberships` uclari (yalniz admin) aynen durur.
Uyelik gorunurluk verir (A3) — bu yuzden ekleme/cikarma is kalemi
gorunurlugunu aninda degistirir; test bunu kilitler.
=============================================================================
"""
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from shared.auth import CurrentUser, get_current_user
from shared.permissions import Perm

from ..models import Project, ProjectMembership
from ..schemas.project_membership import (
    MemberRoleLiteral,
    ProjectMemberCreate,
    ProjectMemberUpdate,
    ProjectMembersResponse,
    ProjectMembershipResponse,
)
from ..services import authz_client
from ..services.work_item_service import LEAD_ROLES, is_project_member
from ..tenant_db import get_tenant_db

router = APIRouter(prefix="/projects/{project_id}/members", tags=["Project Members"])


def _can_manage_all(user: CurrentUser) -> bool:
    try:
        return Perm.PROJECTS_MANAGE in authz_client.effective_permissions(
            user.id, tenant_id=user.tenant_id
        )
    except Exception:  # noqa: BLE001 — fail-closed
        return False


def _authority(db: Session, user: CurrentUser, project: Project):
    """(yonetebilir, lead verebilir)."""
    if _can_manage_all(user):
        return True, True
    if is_project_member(db, UUID(user.id), project.id, roles=LEAD_ROLES):
        return True, False
    return False, False


def _project(db: Session, project_id: UUID) -> Project:
    project = db.query(Project).filter(Project.id == project_id).first()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")
    return project


def _require_manage(db: Session, user: CurrentUser, project: Project):
    can_manage, can_lead = _authority(db, user, project)
    if not can_manage:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a project lead or a projects manager can manage members.",
        )
    return can_lead


def _require_lead_authority(can_lead: bool, role: MemberRoleLiteral) -> None:
    if role in LEAD_ROLES and not can_lead:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a projects manager can grant or revoke the lead role.",
        )


def _members(db: Session, project_id: UUID) -> List[ProjectMembership]:
    return (
        db.query(ProjectMembership)
        .filter(ProjectMembership.project_id == project_id)
        .order_by(ProjectMembership.created_at.asc())
        .all()
    )


def _response(db: Session, user: CurrentUser, project: Project) -> ProjectMembersResponse:
    can_manage, can_lead = _authority(db, user, project)
    return ProjectMembersResponse(
        project_id=project.id,
        can_manage=can_manage,
        can_assign_lead=can_lead,
        items=[ProjectMembershipResponse.model_validate(m) for m in _members(db, project.id)],
    )


@router.get("", response_model=ProjectMembersResponse)
def list_members(
    project_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    """Uyeler + cagiranin bu projedeki yonetim yetkisi (UI dugmeleri buna gore)."""
    return _response(db, current_user, _project(db, project_id))


@router.post("", response_model=ProjectMembersResponse, status_code=status.HTTP_201_CREATED)
def add_member(
    project_id: UUID,
    payload: ProjectMemberCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    project = _project(db, project_id)
    can_lead = _require_manage(db, current_user, project)
    _require_lead_authority(can_lead, payload.member_role)
    existing = (
        db.query(ProjectMembership)
        .filter(ProjectMembership.project_id == project.id,
                ProjectMembership.user_id == payload.user_id)
        .first()
    )
    if existing is not None:
        if existing.is_active:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="User is already a member of this project.")
        # Pasif uyelik yeniden etkinlestirilir (satir cogaltilmaz).
        _require_lead_authority(can_lead, existing.member_role or "member")
        existing.is_active = True
        existing.member_role = payload.member_role
        existing.end_date = None
    else:
        db.add(ProjectMembership(
            project_id=project.id, user_id=payload.user_id,
            member_role=payload.member_role, is_active=True,
        ))
    db.flush()
    return _response(db, current_user, project)


@router.patch("/{membership_id}", response_model=ProjectMembersResponse)
def update_member(
    project_id: UUID,
    membership_id: UUID,
    payload: ProjectMemberUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    project = _project(db, project_id)
    can_lead = _require_manage(db, current_user, project)
    row = (
        db.query(ProjectMembership)
        .filter(ProjectMembership.id == membership_id, ProjectMembership.project_id == project.id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership not found.")
    # Lead'e dokunmak (lead'i baska role cekmek de dahil) yonetici isi.
    _require_lead_authority(can_lead, row.member_role or "member")
    if payload.member_role is not None:
        _require_lead_authority(can_lead, payload.member_role)
        row.member_role = payload.member_role
    if payload.is_active is not None:
        row.is_active = payload.is_active
    db.flush()
    return _response(db, current_user, project)


@router.delete("/{membership_id}", response_model=ProjectMembersResponse)
def remove_member(
    project_id: UUID,
    membership_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_tenant_db),
):
    project = _project(db, project_id)
    can_lead = _require_manage(db, current_user, project)
    row = (
        db.query(ProjectMembership)
        .filter(ProjectMembership.id == membership_id, ProjectMembership.project_id == project.id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership not found.")
    _require_lead_authority(can_lead, row.member_role or "member")
    db.delete(row)
    db.flush()
    return _response(db, current_user, project)
