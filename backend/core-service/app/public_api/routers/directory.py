# =============================================================================
# HERMES Public API - Users & Groups directory (Stage 5B-2, onayli)
# =============================================================================
# Gorunurluk LEAST-PRIVILEGE'dir ve CORE'da hesaplanir (onayli ilke):
#   - global binding → genis AKTIF dizin (auth-service'ten sayfali)
#   - explicit user/group binding → o hedefler
#   - diger binding'ler → yalnizca ZATEN gorunur is kayitlarinda gecen
#     kimlikler (public_directory_service.authorized_user_ids)
#   - user-bound tavan: iliskisiz calisan ENUMERATE EDILEMEZ
#   - arama YALNIZCA yetkili kume icinde yapilir (genis arama + sonradan
#     filtreleme YOK)
#   - kapsam disi kimlik == var olmayan kimlik (ayni 404 zarfi)
# auth-service YALNIZCA ID → minimal profil cozer; erisilemezse FAIL
# CLOSED (sanitize internal_error; detay sizmaz).
# =============================================================================

import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ...database import get_db
from ...services import (
    api_access_service,
    directory_client,
    public_directory_service as dir_svc,
)
from ..deps import ApiContext, require_scopes
from ..errors import PublicAPIError
from ..pagination import Page, PageParams, page_params, paginated
from ..schemas.resources import (
    PublicGroup,
    PublicUser,
    serialize_group,
    serialize_user,
)
from ..scopes import scope_docs

logger = logging.getLogger("hermes.public_api")

router = APIRouter(prefix="/v1", tags=["Directory"])


def _unavailable() -> PublicAPIError:
    # Sanitize: auth-service/S2S detayi disari sizmaz.
    return PublicAPIError(
        "internal_error",
        "Directory is temporarily unavailable. Retry shortly.",
    )


def _q_param():
    return Query(
        None,
        min_length=2,
        max_length=100,
        description="Name/e-mail contains (case-insensitive).",
    )


@router.get(
    "/users",
    response_model=Page[PublicUser],
    summary="List users",
    description=(
        "Lists user directory entries visible to this token — this is "
        "NOT a company-wide employee list. Global-bound tokens see the "
        "broad active directory; every other token sees only identities "
        "encountered in business records it can already access (task "
        "assignees/assigners, activity actors, comment authors, work-log "
        "owners, meeting attendees, members of its accessible groups). "
        "Search runs inside that authorized set only."
    ),
    openapi_extra=scope_docs("users:read"),
)
async def list_users(
    q: Optional[str] = _q_param(),
    params: PageParams = Depends(page_params),
    ctx: ApiContext = Depends(require_scopes("users:read")),
    db: Session = Depends(get_db),
):
    scope = api_access_service.resolve_access(db, ctx.client)
    authorized = dir_svc.authorized_user_ids(db, ctx.client, scope)
    try:
        if authorized is None:  # global → genis dizin auth'tan sayfali
            rows, has_more = directory_client.list_users_global(
                limit=params.limit, offset=params.offset, q=q
            )
            data = [serialize_user(u) for u in rows]
            return {
                "data": data,
                "pagination": {
                    "limit": params.limit,
                    "offset": params.offset,
                    "count": len(data),
                    "has_more": has_more,
                },
            }
        if not authorized:
            return paginated([], params)
        profiles = directory_client.resolve_users(
            [str(u) for u in authorized]
        )
    except directory_client.DirectoryUnavailable as exc:
        raise _unavailable() from exc

    users = sorted(
        profiles.values(), key=lambda u: (u.get("display_name") or "")
    )
    if q:
        needle = q.lower()
        users = [
            u
            for u in users
            if needle in (u.get("display_name") or "").lower()
            or needle in (u.get("work_email") or "").lower()
        ]
    window = users[params.offset : params.offset + params.fetch_limit]
    return paginated([serialize_user(u) for u in window], params)


@router.get(
    "/users/{user_id}",
    response_model=PublicUser,
    summary="Get user",
    description=(
        "Resolves one user id into a minimal directory entry. Identities "
        "outside the token's directory visibility return the same 404 as "
        "nonexistent ids."
    ),
    openapi_extra=scope_docs("users:read"),
)
async def get_user(
    user_id: UUID,
    ctx: ApiContext = Depends(require_scopes("users:read")),
    db: Session = Depends(get_db),
):
    scope = api_access_service.resolve_access(db, ctx.client)
    authorized = dir_svc.authorized_user_ids(db, ctx.client, scope)
    if authorized is not None and user_id not in authorized:
        raise PublicAPIError("resource_not_found", "User not found.")
    try:
        profiles = directory_client.resolve_users([str(user_id)])
    except directory_client.DirectoryUnavailable as exc:
        raise _unavailable() from exc
    profile = profiles.get(str(user_id))
    if profile is None:
        raise PublicAPIError("resource_not_found", "User not found.")
    return serialize_user(profile)


@router.get(
    "/groups",
    response_model=Page[PublicGroup],
    summary="List groups",
    description=(
        "Lists ACTIVE user groups visible to this token: global-bound "
        "tokens see all active groups; explicitly bound groups are "
        "visible; a user-bound token additionally sees the groups its "
        "bound user is an active member of. No member lists — only an "
        "active member count."
    ),
    openapi_extra=scope_docs("groups:read"),
)
async def list_groups(
    q: Optional[str] = _q_param(),
    params: PageParams = Depends(page_params),
    ctx: ApiContext = Depends(require_scopes("groups:read")),
    db: Session = Depends(get_db),
):
    scope = api_access_service.resolve_access(db, ctx.client)
    visible = dir_svc.authorized_group_ids(db, ctx.client, scope)
    rows = dir_svc.list_groups_visible(
        db,
        visible,
        q_text=q,
        fetch_limit=params.fetch_limit,
        offset=params.offset,
    )
    return paginated(
        [
            serialize_group(g, dir_svc.active_member_count(db, g.id))
            for g in rows
        ],
        params,
    )


@router.get(
    "/groups/{group_id}",
    response_model=PublicGroup,
    summary="Get group",
    description=(
        "Fetches one group. Groups outside the token's visibility return "
        "the same 404 as nonexistent ids."
    ),
    openapi_extra=scope_docs("groups:read"),
)
async def get_group(
    group_id: UUID,
    ctx: ApiContext = Depends(require_scopes("groups:read")),
    db: Session = Depends(get_db),
):
    scope = api_access_service.resolve_access(db, ctx.client)
    visible = dir_svc.authorized_group_ids(db, ctx.client, scope)
    group = dir_svc.get_group_visible(db, visible, group_id)
    if group is None:
        raise PublicAPIError("resource_not_found", "Group not found.")
    return serialize_group(
        group, dir_svc.active_member_count(db, group.id)
    )
