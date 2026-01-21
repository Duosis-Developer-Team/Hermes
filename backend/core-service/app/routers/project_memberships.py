from typing import List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ProjectMembership, Project
from ..schemas.project_membership import ProjectMembershipCreate, ProjectMembershipUpdate, ProjectMembershipResponse
from shared.auth import get_current_user

router = APIRouter(
    prefix="/project-memberships",
    tags=["Project Memberships"]
)

@router.post("", response_model=ProjectMembershipResponse, status_code=status.HTTP_201_CREATED)
def create_membership(
    mem_in: ProjectMembershipCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    # Proje var mı ?
    project = db.query(Project).filter(Project.id == mem_in.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Zaten üye mi?
    existing = db.query(ProjectMembership).filter(
        ProjectMembership.project_id == mem_in.project_id,
        ProjectMembership.user_id == mem_in.user_id
    ).first()
    
    if existing:
        raise HTTPException(status_code=400, detail="User is already a member of this project")

    new_mem = ProjectMembership(**mem_in.model_dump())
    db.add(new_mem)
    db.commit()
    db.refresh(new_mem)
    return new_mem

@router.get("", response_model=List[ProjectMembershipResponse])
def get_memberships(
    project_id: UUID = None,
    user_id: UUID = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    query = db.query(ProjectMembership)
    if project_id:
        query = query.filter(ProjectMembership.project_id == project_id)
    if user_id:
        query = query.filter(ProjectMembership.user_id == user_id)
    return query.all()

@router.delete("/{mem_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_membership(
    mem_id: UUID,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    mem = db.query(ProjectMembership).filter(ProjectMembership.id == mem_id).first()
    if not mem:
        raise HTTPException(status_code=404, detail="Membership not found")

    db.delete(mem)
    db.commit()
