from typing import List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Issue, Project
from ..schemas.issue import IssueCreate, IssueUpdate, IssueResponse
from shared.auth import get_current_user

router = APIRouter(
    prefix="/issues",
    tags=["Issues"]
)

@router.post("", response_model=IssueResponse, status_code=status.HTTP_201_CREATED)
def create_issue(
    issue_in: IssueCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    # Proje var mı kontrol et
    project = db.query(Project).filter(Project.id == issue_in.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Issue Key unique olmalı (proje bazında)
    existing_issue = db.query(Issue).filter(
        Issue.project_id == issue_in.project_id,
        Issue.issue_key == issue_in.issue_key
    ).first()
    
    if existing_issue:
        raise HTTPException(status_code=400, detail="Issue key already exists in this project")

    new_issue = Issue(**issue_in.model_dump())
    db.add(new_issue)
    db.commit()
    db.refresh(new_issue)
    return new_issue

@router.get("", response_model=List[IssueResponse])
def get_issues(
    project_id: UUID = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    query = db.query(Issue)
    if project_id:
        query = query.filter(Issue.project_id == project_id)
    return query.all()

@router.get("/{issue_id}", response_model=IssueResponse)
def get_issue(
    issue_id: UUID,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    return issue

@router.put("/{issue_id}", response_model=IssueResponse)
def update_issue(
    issue_id: UUID,
    issue_in: IssueUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    update_data = issue_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(issue, field, value)

    db.commit()
    db.refresh(issue)
    return issue

@router.delete("/{issue_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_issue(
    issue_id: UUID,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    db.delete(issue)
    db.commit()
