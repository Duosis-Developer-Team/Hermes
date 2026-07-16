# =============================================================================
# HERMES Public API - Pagination standard
# =============================================================================
# Tum public liste endpoint'leri ayni sozlesmeyi kullanir:
#
#   Istek : ?limit=25&offset=0     (limit 1..100, default 25; offset >= 0)
#   Yanit : {
#     "data": [ ... ],
#     "pagination": {
#       "limit": 25, "offset": 0, "count": <bu sayfadaki adet>,
#       "has_more": true|false
#     }
#   }
#
# has_more, toplam satir SAYMADAN hesaplanir: sorgu limit+1 satir ceker,
# fazlalik varsa has_more=true olur ve fazla satir atilir. Boylece buyuk
# tablolarda pahali COUNT(*) calistirilmaz (toplam sayi bilincli olarak
# sozlesmede yok; ihtiyac olursa ayri bir opt-in parametreyle eklenir).
# =============================================================================

from dataclasses import dataclass

from fastapi import Query

DEFAULT_LIMIT = 25
MAX_LIMIT = 100


@dataclass
class PageParams:
    limit: int
    offset: int

    @property
    def fetch_limit(self) -> int:
        """Sorguya verilecek limit: has_more tespiti icin +1."""
        return self.limit + 1


def page_params(
    limit: int = Query(
        DEFAULT_LIMIT,
        ge=1,
        le=MAX_LIMIT,
        description="Items per page (1-100).",
    ),
    offset: int = Query(
        0,
        ge=0,
        description="Number of items to skip.",
    ),
) -> PageParams:
    """FastAPI dependency: `params: PageParams = Depends(page_params)`."""
    return PageParams(limit=limit, offset=offset)


def paginated(items: list, params: PageParams) -> dict:
    """`items` fetch_limit (limit+1) ile cekilmis ham liste olmalidir;
    fazlalik burada kirpilir ve has_more hesaplanir."""
    has_more = len(items) > params.limit
    page = items[: params.limit]
    return {
        "data": page,
        "pagination": {
            "limit": params.limit,
            "offset": params.offset,
            "count": len(page),
            "has_more": has_more,
        },
    }
