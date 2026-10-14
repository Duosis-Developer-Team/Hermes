# =============================================================================
# HERMES core — Bilgi bankasi is mantigi (Dalga D3)
# =============================================================================
# Arama: saglayici basina makale sayisi kucuktur (yuzler); TR karakter
# duyarsiz katlama (`ticket_automation.fold`) + 5 harflik kok ile Python'da
# puanlanir:
#   baslik 3 · anahtar kelime 2 · ozet 1.5 · govde 1  (kelime basina)
# Yalniz yayinda makaleler aranir; musteri icin ayrica `public` sart.
# Bir PostgreSQL FTS yapilandirmasi Turkce kok/buyuk-kucuk harf icin ek
# kurulum ister; bu olcekte katlamali puanlama daha dogru ve bagimsizdir.
# =============================================================================

from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from ..models.ticket_kb import KB_AUDIENCES, KB_STATUSES, KbArticle, KbCategory, KbVote
from .ticket_automation import fold
from .ticket_service import TicketValidationError

MAX_SCAN = 2000
MAX_BODY = 50_000
#: Turkce eklemeli dildir ("sifremi", "parolami"): kelimenin ilk 5 harfi
#: kok yerine kullanilir (Turkce bilgi erisiminde bilinen etkili yontem).
STEM = 5


def _tokens(text: Optional[str], *, min_len: int) -> List[str]:
    return [t[:STEM] for t in fold(text).split() if len(t) >= min_len]


def _now():
    return datetime.now(timezone.utc)


def _clean_line(value, limit) -> str:
    return " ".join((value or "").split())[:limit]


# =============================================================================
# Kategori
# =============================================================================

def list_categories(db: Session, *, include_inactive: bool = False) -> List[KbCategory]:
    q = db.query(KbCategory)
    if not include_inactive:
        q = q.filter(KbCategory.is_active.is_(True))
    return q.order_by(KbCategory.position, KbCategory.name).all()


def save_category(db: Session, *, name: str, description: Optional[str], position: int = 0,
                  is_active: Optional[bool] = None, category: Optional[KbCategory] = None) -> KbCategory:
    clean = _clean_line(name, 120)
    if not clean:
        raise TicketValidationError("Category name is required.", code="validation_error")
    from sqlalchemy import func

    clash = db.query(KbCategory).filter(func.lower(KbCategory.name) == clean.lower()).first()
    if clash is not None and (category is None or clash.id != category.id):
        raise TicketValidationError("A category with this name already exists.", code="validation_error")
    if category is None:
        category = KbCategory()
        db.add(category)
    category.name = clean
    category.description = (description or "").strip()[:1000] or None
    category.position = int(position or 0)
    if is_active is not None:
        category.is_active = bool(is_active)
    db.flush()
    return category


# =============================================================================
# Makale
# =============================================================================

def save_article(db: Session, *, data: dict, actor_user_id, article: Optional[KbArticle] = None) -> KbArticle:
    title = _clean_line(data.get("title"), 200)
    if not title:
        raise TicketValidationError("Title is required.", code="validation_error")
    status = data.get("status") or "draft"
    audience = data.get("audience") or "public"
    if status not in KB_STATUSES or audience not in KB_AUDIENCES:
        raise TicketValidationError("Unknown status or audience.", code="validation_error")
    body = (data.get("body") or "").replace("\r\n", "\n")
    if len(body) > MAX_BODY:
        raise TicketValidationError("The article is too long.", code="validation_error")
    if status == "published" and not body.strip():
        raise TicketValidationError("A published article needs a body.", code="validation_error")
    category_id = data.get("category_id")
    if category_id and db.get(KbCategory, category_id) is None:
        raise TicketValidationError("Unknown category.", code="validation_error")
    keywords = [_clean_line(k, 40) for k in (data.get("keywords") or []) if _clean_line(k, 40)][:20]

    if article is None:
        article = KbArticle(author_user_id=actor_user_id)
        db.add(article)
    if status == "published" and article.status != "published":
        article.published_at = _now()
    article.title = title
    article.summary = _clean_line(data.get("summary"), 500) or None
    article.body = body
    article.status = status
    article.audience = audience
    article.category_id = category_id or None
    article.keywords = keywords
    article.updated_by_user_id = actor_user_id
    article.updated_at = _now()
    db.flush()
    return article


def visible_query(db: Session, *, customer: bool):
    q = db.query(KbArticle)
    if customer:
        q = q.filter(KbArticle.status == "published", KbArticle.audience == "public")
    return q


def get_visible(db: Session, article_id, *, customer: bool) -> Optional[KbArticle]:
    return visible_query(db, customer=customer).filter(KbArticle.id == article_id).first()


def _score(article: KbArticle, tokens: List[str]) -> float:
    title, summary, body = fold(article.title), fold(article.summary), fold(article.body)
    keywords = fold(" ".join(article.keywords or []))
    score = 0.0
    for tok in tokens:
        score += 3 * (tok in title) + 2 * (tok in keywords) + 1.5 * (tok in summary) + (tok in body)
    return score


def search(db: Session, *, q: Optional[str], customer: bool, category_id=None,
           status: Optional[str] = None, limit: int = 50) -> List[KbArticle]:
    query = visible_query(db, customer=customer)
    if category_id:
        query = query.filter(KbArticle.category_id == category_id)
    if status and not customer:
        query = query.filter(KbArticle.status == status)
    rows = query.order_by(KbArticle.updated_at.desc()).limit(MAX_SCAN).all()
    tokens = _tokens(q, min_len=2)
    if not tokens:
        return rows[:limit]
    scored: List[Tuple[float, KbArticle]] = [(s, a) for a in rows if (s := _score(a, tokens)) > 0]
    scored.sort(key=lambda pair: (-pair[0], -(pair[1].updated_at.timestamp() if pair[1].updated_at else 0)))
    return [a for _, a in scored[:limit]]


def suggest(db: Session, *, text: str, limit: int = 5) -> List[KbArticle]:
    """Yeni talep yazilirken musteriye oneriler: en az bir BASLIK veya
    anahtar kelime eslesmesi (govdede gecen tek kelime yetmez)."""
    tokens = _tokens(text, min_len=3)
    if not tokens:
        return []
    rows = visible_query(db, customer=True).limit(MAX_SCAN).all()
    out = []
    for article in rows:
        title, keywords = fold(article.title), fold(" ".join(article.keywords or []))
        if any(t in title or t in keywords for t in tokens):
            out.append((_score(article, tokens), article))
    out.sort(key=lambda pair: -pair[0])
    return [a for _, a in out[:limit]]


def record_view(db: Session, article: KbArticle) -> None:
    article.view_count = int(article.view_count or 0) + 1
    db.flush()


def vote(db: Session, article: KbArticle, *, reader: str, helpful: bool) -> KbArticle:
    row = (
        db.query(KbVote)
        .filter(KbVote.article_id == article.id, KbVote.reader == str(reader))
        .first()
    )
    if row is None:
        db.add(KbVote(article_id=article.id, reader=str(reader), helpful=bool(helpful)))
        if helpful:
            article.helpful_yes += 1
        else:
            article.helpful_no += 1
    elif row.helpful != bool(helpful):
        row.helpful = bool(helpful)
        if helpful:
            article.helpful_yes += 1
            article.helpful_no = max(0, article.helpful_no - 1)
        else:
            article.helpful_no += 1
            article.helpful_yes = max(0, article.helpful_yes - 1)
    db.flush()
    return article
