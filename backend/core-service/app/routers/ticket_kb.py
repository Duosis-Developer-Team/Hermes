# =============================================================================
# HERMES core — Bilgi bankasi / yardim merkezi uclari (Dalga D3)
# =============================================================================
#   /tickets/kb/...   ajan (saglayici, kendi verisi): tum makaleler; yazmak
#                     `tickets.config.manage` / `tickets.admin` ister.
#   /support/kb/...   talep eden (portal): YALNIZ yayinda + musteriye acik
#                     makaleler; saglayici talep agi baglantisindan cozulur
#                     (portal ile ayni dar gecit, `?provider=`).
# Ekip ici/taslak makale musteri icin YOKTUR (404 — varligi sizdirilmaz).
# =============================================================================

from __future__ import annotations

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from shared.auth import CurrentUser

from ..models.ticket_kb import KbArticle, KbCategory, KbVote
from ..services import ticket_kb as kb
from ..services import ticket_network as network
from ..services import ticket_visibility as visibility
from ..services.ticket_service import TicketValidationError
from .ticket_deps import (
    get_portal_db,
    get_support_db,
    hub_scope,
    http_error,
    portal_provider,
    require_customer_surface,
    translate,
)

hub_router = APIRouter(prefix="/tickets/kb", tags=["Knowledge Base"])
portal_router = APIRouter(prefix="/support/kb", tags=["Help Center"])


# =============================================================================
# Semalar
# =============================================================================

class CategoryIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = Field(None, max_length=1000)
    position: int = 0
    is_active: Optional[bool] = None


class CategoryOut(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    position: int
    is_active: bool
    article_count: int = 0


class ArticleIn(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    summary: Optional[str] = Field(None, max_length=500)
    body: str = Field("", max_length=kb.MAX_BODY)
    status: str = "draft"
    audience: str = "public"
    category_id: Optional[UUID] = None
    keywords: List[str] = Field(default_factory=list, max_length=20)


class ArticleListItem(BaseModel):
    id: UUID
    title: str
    summary: Optional[str] = None
    category_id: Optional[UUID] = None
    status: str
    audience: str
    view_count: int = 0
    helpful_yes: int = 0
    helpful_no: int = 0
    updated_at: Optional[datetime] = None


class ArticleOut(ArticleListItem):
    body: str
    keywords: List[str] = Field(default_factory=list)
    published_at: Optional[datetime] = None
    my_vote: Optional[bool] = None


class VoteIn(BaseModel):
    helpful: bool


def _item(a: KbArticle) -> ArticleListItem:
    return ArticleListItem(
        id=a.id, title=a.title, summary=a.summary, category_id=a.category_id, status=a.status,
        audience=a.audience, view_count=a.view_count, helpful_yes=a.helpful_yes,
        helpful_no=a.helpful_no, updated_at=a.updated_at,
    )


def _full(db: Session, a: KbArticle, reader: Optional[str] = None) -> ArticleOut:
    mine = None
    if reader:
        row = db.query(KbVote.helpful).filter(KbVote.article_id == a.id, KbVote.reader == str(reader)).first()
        mine = row[0] if row else None
    return ArticleOut(**_item(a).model_dump(), body=a.body, keywords=a.keywords or [],
                      published_at=a.published_at, my_vote=mine)


def _categories(db: Session, *, customer: bool) -> List[CategoryOut]:
    counts = dict(
        kb.visible_query(db, customer=customer)
        .with_entities(KbArticle.category_id, func.count(KbArticle.id))
        .group_by(KbArticle.category_id).all()
    )
    rows = kb.list_categories(db, include_inactive=not customer)
    out = [CategoryOut(id=c.id, name=c.name, description=c.description, position=c.position,
                       is_active=c.is_active, article_count=int(counts.get(c.id, 0))) for c in rows]
    # Musteri bos kategori gormez.
    return [c for c in out if c.article_count] if customer else out


def _require_editor(scope: visibility.HubScope) -> None:
    if not (scope.can_manage_config or scope.is_admin):
        raise http_error("forbidden", "tickets.config.manage permission is required.")


def _validation(exc: Exception):
    if isinstance(exc, TicketValidationError):
        return http_error("validation_error", str(exc))
    return translate(exc)


# =============================================================================
# Ajan (hub)
# =============================================================================

@hub_router.get("/categories", response_model=List[CategoryOut])
def hub_categories(scope=Depends(hub_scope), db: Session = Depends(get_support_db)):
    return _categories(db, customer=False)


@hub_router.post("/categories", response_model=CategoryOut, status_code=201)
def create_category(payload: CategoryIn, scope=Depends(hub_scope), db: Session = Depends(get_support_db)):
    _require_editor(scope)
    try:
        c = kb.save_category(db, name=payload.name, description=payload.description, position=payload.position)
    except Exception as exc:  # noqa: BLE001
        raise _validation(exc)
    return CategoryOut(id=c.id, name=c.name, description=c.description, position=c.position, is_active=c.is_active)


@hub_router.patch("/categories/{category_id}", response_model=CategoryOut)
def update_category(category_id: UUID, payload: CategoryIn, scope=Depends(hub_scope),
                    db: Session = Depends(get_support_db)):
    _require_editor(scope)
    category = db.get(KbCategory, category_id)
    if category is None:
        raise http_error("not_found", "Category not found.")
    try:
        c = kb.save_category(db, name=payload.name, description=payload.description,
                             position=payload.position, is_active=payload.is_active, category=category)
    except Exception as exc:  # noqa: BLE001
        raise _validation(exc)
    return CategoryOut(id=c.id, name=c.name, description=c.description, position=c.position, is_active=c.is_active)


@hub_router.get("/articles", response_model=List[ArticleListItem])
def hub_articles(
    q: Optional[str] = Query(None, max_length=120),
    category_id: Optional[UUID] = Query(None),
    status: Optional[str] = Query(None, pattern="^(draft|published)$"),
    scope=Depends(hub_scope),
    db: Session = Depends(get_support_db),
):
    return [_item(a) for a in kb.search(db, q=q, customer=False, category_id=category_id, status=status)]


@hub_router.get("/articles/{article_id}", response_model=ArticleOut)
def hub_article(article_id: UUID, scope=Depends(hub_scope), db: Session = Depends(get_support_db)):
    article = kb.get_visible(db, article_id, customer=False)
    if article is None:
        raise http_error("not_found", "Article not found.")
    return _full(db, article, reader=scope.user_id)


@hub_router.post("/articles", response_model=ArticleOut, status_code=201)
def create_article(payload: ArticleIn, scope=Depends(hub_scope), db: Session = Depends(get_support_db)):
    _require_editor(scope)
    try:
        article = kb.save_article(db, data=payload.model_dump(), actor_user_id=UUID(str(scope.user_id)))
    except Exception as exc:  # noqa: BLE001
        raise _validation(exc)
    return _full(db, article)


@hub_router.put("/articles/{article_id}", response_model=ArticleOut)
def update_article(article_id: UUID, payload: ArticleIn, scope=Depends(hub_scope),
                   db: Session = Depends(get_support_db)):
    _require_editor(scope)
    article = db.get(KbArticle, article_id)
    if article is None:
        raise http_error("not_found", "Article not found.")
    try:
        article = kb.save_article(db, data=payload.model_dump(), actor_user_id=UUID(str(scope.user_id)),
                                  article=article)
    except Exception as exc:  # noqa: BLE001
        raise _validation(exc)
    return _full(db, article)


# =============================================================================
# Musteri (yardim merkezi)
# =============================================================================

def _customer_access(current_user: CurrentUser) -> None:
    from shared.permissions import Perm

    if Perm.TICKETS_ACCESS not in visibility.effective_ticket_permissions(current_user):
        raise http_error("forbidden", "tickets.access permission is required.")


@portal_router.get("/categories", response_model=List[CategoryOut])
def portal_categories(
    current_user: CurrentUser = Depends(require_customer_surface),
    link: network.ProviderLink = Depends(portal_provider),
    db: Session = Depends(get_portal_db),
):
    _customer_access(current_user)
    return _categories(db, customer=True)


@portal_router.get("/articles", response_model=List[ArticleListItem])
def portal_articles(
    q: Optional[str] = Query(None, max_length=120),
    category_id: Optional[UUID] = Query(None),
    current_user: CurrentUser = Depends(require_customer_surface),
    link: network.ProviderLink = Depends(portal_provider),
    db: Session = Depends(get_portal_db),
):
    _customer_access(current_user)
    return [_item(a) for a in kb.search(db, q=q, customer=True, category_id=category_id)]


@portal_router.get("/suggest", response_model=List[ArticleListItem])
def portal_suggest(
    q: str = Query(..., min_length=1, max_length=200),
    current_user: CurrentUser = Depends(require_customer_surface),
    link: network.ProviderLink = Depends(portal_provider),
    db: Session = Depends(get_portal_db),
):
    """Yeni talep yazilirken basliga gore oneriler (talep acilmadan cozum)."""
    _customer_access(current_user)
    return [_item(a) for a in kb.suggest(db, text=q)]


@portal_router.get("/articles/{article_id}", response_model=ArticleOut)
def portal_article(
    article_id: UUID,
    current_user: CurrentUser = Depends(require_customer_surface),
    link: network.ProviderLink = Depends(portal_provider),
    db: Session = Depends(get_portal_db),
):
    _customer_access(current_user)
    article = kb.get_visible(db, article_id, customer=True)
    if article is None:
        raise http_error("not_found", "Article not found.")
    kb.record_view(db, article)
    return _full(db, article, reader=str(current_user.id))


@portal_router.post("/articles/{article_id}/vote", response_model=ArticleOut)
def portal_vote(
    article_id: UUID,
    payload: VoteIn,
    current_user: CurrentUser = Depends(require_customer_surface),
    link: network.ProviderLink = Depends(portal_provider),
    db: Session = Depends(get_portal_db),
):
    _customer_access(current_user)
    article = kb.get_visible(db, article_id, customer=True)
    if article is None:
        raise http_error("not_found", "Article not found.")
    kb.vote(db, article, reader=str(current_user.id), helpful=payload.helpful)
    return _full(db, article, reader=str(current_user.id))
