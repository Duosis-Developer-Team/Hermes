# =============================================================================
# HERMES Public API - Meetings read endpoints (Stage 3B)
# =============================================================================
# Gorunurluk katilimci-tabanlidir: user/group/global binding'ler gecerli;
# yalniz customer/project binding'i olan token'lar HIC meeting goremez
# (meetings'in musteri/proje iliskisi yoktur). Icerik minimizasyonu:
# body/description alanlari public semada YOK; private/confidential
# toplantilar yazim aninda maskelidir (subject = "Private Meeting").
# join_url yalnizca gorunurluk kapisini gecen token'lara doner.
# =============================================================================

from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ...database import get_db
from ...services import api_access_service, public_resource_service as res
from ..deps import ApiContext, require_scopes
from ..errors import PublicAPIError
from ..pagination import Page, PageParams, page_params, paginated
from ..schemas.resources import PublicMeeting, serialize_meeting
from ..scopes import scope_docs

router = APIRouter(prefix="/v1", tags=["Meetings"])

MeetingSortLiteral = Literal["start_datetime", "-start_datetime"]


@router.get(
    "/meetings",
    response_model=Page[PublicMeeting],
    summary="List meetings",
    description=(
        "Lists meetings where at least one user in the token's user/group "
        "access is an attendee (or everything for global bindings). "
        "Tokens with only customer/project bindings receive no meetings — "
        "meetings have no customer/project relationship. Body content is "
        "never exposed; private meetings keep their masked subject."
    ),
    openapi_extra=scope_docs("meetings:read"),
)
async def list_meetings(
    start_from: Optional[datetime] = Query(None),
    start_to: Optional[datetime] = Query(None),
    include_cancelled: bool = Query(False),
    sort: MeetingSortLiteral = Query("-start_datetime"),
    params: PageParams = Depends(page_params),
    ctx: ApiContext = Depends(require_scopes("meetings:read")),
    db: Session = Depends(get_db),
):
    scope = api_access_service.resolve_access(db, ctx.client)
    rows = res.list_meetings_scoped(
        db,
        scope,
        start_from=start_from,
        start_to=start_to,
        include_cancelled=include_cancelled,
        sort=sort,
        fetch_limit=params.fetch_limit,
        offset=params.offset,
    )
    return paginated([serialize_meeting(m) for m in rows], params)


@router.get(
    "/meetings/{meeting_id}",
    response_model=PublicMeeting,
    summary="Get meeting",
    description=(
        "Fetches one meeting by id. Meetings outside the token's access "
        "return the same 404 as nonexistent ids."
    ),
    openapi_extra=scope_docs("meetings:read"),
)
async def get_meeting(
    meeting_id: UUID,
    ctx: ApiContext = Depends(require_scopes("meetings:read")),
    db: Session = Depends(get_db),
):
    scope = api_access_service.resolve_access(db, ctx.client)
    meeting = res.get_meeting_scoped(db, scope, meeting_id)
    if meeting is None:
        raise PublicAPIError("resource_not_found", "Meeting not found.")
    return serialize_meeting(meeting)
