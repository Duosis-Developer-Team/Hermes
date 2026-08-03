from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Issue, Project
from ..models.project_membership import ProjectMembership
from ..schemas.issue import IssueCreate, IssueUpdate, IssueResponse
from shared.auth import get_current_user, CurrentUser
# RBAC R2: guard'lar izin-tabanli — is_admin bit'i karar mercii degil.
from ..authz import require_permissions
from shared.permissions import Perm

router = APIRouter(
    prefix="/issues",
    tags=["Issues"]
)

def _check_project_membership(
    project_id: UUID,
    current_user: CurrentUser,
    db: Session,
) -> None:
    """
    [KRİTİK-5] Kullanıcının projeye üye olup olmadığını doğrular.
    Admin'ler her projeye erişebilir. Standart kullanıcılar yalnızca
    üyesi oldukları projelerde issue oluşturabilir/güncelleyebilir/silebilir.
    """
    # RBAC R2: proje-uyeligi bypass'i artik projects.manage iznine bakar.
    from ..authz import user_has
    from shared.permissions import Perm

    if user_has(current_user, Perm.PROJECTS_MANAGE):
        return
    membership = db.query(ProjectMembership).filter(
        ProjectMembership.project_id == project_id,
        ProjectMembership.user_id == current_user.id,
        ProjectMembership.is_active == True,  # noqa: E712
    ).first()
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this project",
        )


@router.post("", response_model=IssueResponse, status_code=status.HTTP_201_CREATED)
def create_issue(
    issue_in: IssueCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    # Proje var mı kontrol et
    project = db.query(Project).filter(Project.id == issue_in.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # [KRİTİK-5] Proje üyeliği / admin kontrolü
    _check_project_membership(issue_in.project_id, current_user, db)

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
    project_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    query = db.query(Issue)
    if project_id:
        # [KRİTİK-5] Belirli bir proje isteniyorsa üyelik kontrolü yap
        _check_project_membership(project_id, current_user, db)
        query = query.filter(Issue.project_id == project_id)
    return query.all()

@router.get("/{issue_id}", response_model=IssueResponse)
def get_issue(
    issue_id: UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    # [KRİTİK-5] Issue'nun ait olduğu projeye erişim yetkisi kontrol et
    _check_project_membership(issue.project_id, current_user, db)
    return issue

@router.put("/{issue_id}", response_model=IssueResponse)
def update_issue(
    issue_id: UUID,
    issue_in: IssueUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    # [KRİTİK-5] Proje üyeliği / admin kontrolü
    _check_project_membership(issue.project_id, current_user, db)

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
    admin: CurrentUser = Depends(require_permissions(Perm.PROJECTS_MANAGE)),  # [KRİTİK-5] Silme yalnızca Admin
):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    db.delete(issue)
    db.commit()
