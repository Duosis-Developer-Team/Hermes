# =============================================================================
# HERMES Public API - Customers & Projects read endpoints (Stage 3B)
# =============================================================================
# Referans verisi LEAST-PRIVILEGE gorunurluk kuralina tabidir (onayli):
# global → tum aktif; acik binding → yalniz baglananlar; user/group →
# yalniz erisilebilir is kayitlarinda GECEN musteri/projeler. Bu
# endpoint'ler sirket envanterini enumere ETMEZ.
# =============================================================================

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ...database import get_db
from ...services import api_access_service, public_resource_service as res
from ..deps import ApiContext, require_scopes
from ..errors import PublicAPIError
from ..pagination import PageParams, page_params, paginated
from ..schemas.resources import serialize_customer, serialize_project
from ..scopes import scope_docs

router = APIRouter(prefix="/v1", tags=["Reference"])


@router.get(
    "/customers",
    summary="List customers",
    description=(
        "Lists ACTIVE customers visible to the client. Visibility is "
        "least-privilege: global bindings see all active customers; "
        "explicit customer/project bindings see only the bound entities; "
        "user/group bindings see only customers referenced by records the "
        "token can already access."
    ),
    openapi_extra=scope_docs("customers:read"),
)
async def list_customers(
    q: Optional[str] = Query(None, max_length=100, description="Name contains"),
    params: PageParams = Depends(page_params),
    ctx: ApiContext = Depends(require_scopes("customers:read")),
    db: Session = Depends(get_db),
):
    scope = api_access_service.resolve_access(db, ctx.client)
    rows = res.list_customers_scoped(
        db, scope, q_text=q, fetch_limit=params.fetch_limit, offset=params.offset
    )
    return paginated([serialize_customer(c) for c in rows], params)


@router.get(
    "/customers/{customer_id}",
    summary="Get customer",
    openapi_extra=scope_docs("customers:read"),
)
async def get_customer(
    customer_id: UUID,
    ctx: ApiContext = Depends(require_scopes("customers:read")),
    db: Session = Depends(get_db),
):
    scope = api_access_service.resolve_access(db, ctx.client)
    customer = res.get_customer_scoped(db, scope, customer_id)
    if customer is None:
        raise PublicAPIError("resource_not_found", "Customer not found.")
    return serialize_customer(customer)


@router.get(
    "/projects",
    summary="List projects",
    description=(
        "Lists ACTIVE projects visible to the client (same least-privilege "
        "rules as customers; an explicit customer binding exposes that "
        "customer's projects)."
    ),
    openapi_extra=scope_docs("projects:read"),
)
async def list_projects(
    customer_id: Optional[UUID] = Query(None),
    q: Optional[str] = Query(None, max_length=100, description="Name contains"),
    params: PageParams = Depends(page_params),
    ctx: ApiContext = Depends(require_scopes("projects:read")),
    db: Session = Depends(get_db),
):
    scope = api_access_service.resolve_access(db, ctx.client)
    rows = res.list_projects_scoped(
        db,
        scope,
        customer_id=customer_id,
        q_text=q,
        fetch_limit=params.fetch_limit,
        offset=params.offset,
    )
    return paginated([serialize_project(p) for p in rows], params)


@router.get(
    "/projects/{project_id}",
    summary="Get project",
    openapi_extra=scope_docs("projects:read"),
)
async def get_project(
    project_id: UUID,
    ctx: ApiContext = Depends(require_scopes("projects:read")),
    db: Session = Depends(get_db),
):
    scope = api_access_service.resolve_access(db, ctx.client)
    project = res.get_project_scoped(db, scope, project_id)
    if project is None:
        raise PublicAPIError("resource_not_found", "Project not found.")
    return serialize_project(project)
