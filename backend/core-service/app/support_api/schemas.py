# =============================================================================
# HERMES Support API — sozlesme semalari (04 §5-§9)
# =============================================================================
# Alan adlari SOZLESMEDIR: LogiSlot ve gelecekteki consumer'lar bunlari
# birebir gonderir/okur. Yeni OPSIYONEL alan eklemek v1 icinde
# serbesttir; alan adi degistirmek/kaldirmak DEGILDIR.
#
# `extra="forbid"`: govdede tanimsiz bir alan varsa istek REDDEDILIR.
# Sessizce yok saymak, consumer'in "gonderdim" sandigi bir veriyi
# kaybetmesi demek olurdu (orn. yanlis yazilmis `source_tenant_id`).
# =============================================================================

from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from ..schemas.ticketing import ClientContextIn
from ..ticket_contract import (
    CATEGORIES,
    CONTRACT_VERSION,
    DESCRIPTION_MAX_LENGTH,
    DESCRIPTION_MIN_LENGTH,
    IMPACTS,
    MESSAGE_MAX_LENGTH,
    REASON_MAX_LENGTH,
    REASON_MIN_LENGTH,
    SOURCE_ID_MAX_LENGTH,
    TITLE_MAX_LENGTH,
    TITLE_MIN_LENGTH,
)


class _Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SourceTenantIn(_Contract):
    id: str = Field(..., min_length=1, max_length=SOURCE_ID_MAX_LENGTH)
    slug: Optional[str] = Field(None, max_length=128)
    display_name: Optional[str] = Field(None, max_length=200)


class RouteIn(_Contract):
    group_id: UUID
    route_version: Optional[int] = Field(None, ge=1)


class RequesterIn(_Contract):
    """Requester kimligi KAYNAK BACKEND tarafindan dogrulanmis olarak
    gelir (04 §6). Hermes tarayici beyanina guvenmez; guven sinirini
    kaynak uygulamanin sunucusu tasir ve bu sinir service credential ile
    kanitlanir."""

    id: str = Field(..., min_length=1, max_length=SOURCE_ID_MAX_LENGTH)
    display_name: Optional[str] = Field(None, max_length=200)
    email: Optional[str] = Field(None, max_length=255)


class TicketCreateIn(_Contract):
    contract_version: str = Field(default=CONTRACT_VERSION, max_length=10)
    source_ticket_id: str = Field(
        ..., min_length=1, max_length=SOURCE_ID_MAX_LENGTH
    )
    source_tenant: SourceTenantIn
    route: RouteIn
    requester: RequesterIn
    title: str = Field(
        ..., min_length=TITLE_MIN_LENGTH, max_length=TITLE_MAX_LENGTH
    )
    description: str = Field(
        ..., min_length=DESCRIPTION_MIN_LENGTH,
        max_length=DESCRIPTION_MAX_LENGTH,
    )
    category: Literal[CATEGORIES]  # type: ignore[valid-type]
    impact: Literal[IMPACTS]  # type: ignore[valid-type]
    reproduction_steps: Optional[str] = Field(
        None, max_length=DESCRIPTION_MAX_LENGTH
    )
    expected_result: Optional[str] = Field(
        None, max_length=DESCRIPTION_MAX_LENGTH
    )
    actual_result: Optional[str] = Field(
        None, max_length=DESCRIPTION_MAX_LENGTH
    )
    error_code: Optional[str] = Field(None, max_length=80)
    correlation_id: Optional[str] = Field(None, max_length=64)
    occurred_at: Optional[datetime] = None
    client_context: Optional[ClientContextIn] = None
    attachment_upload_ids: List[UUID] = Field(
        default_factory=list, max_length=5
    )


class TicketCreatedOut(BaseModel):
    ticket_id: UUID
    ticket_number: str
    status: str
    assigned_group: dict
    created_at: datetime
    version: int


class CustomerCommandBase(_Contract):
    """Tum musteri komutlarinin ortak kimlik kismi.

    `requester` ZORUNLUDUR: komutu kimin verdigi, kaynak backend
    tarafindan dogrulanip iletilir. `view_all`, kaynak tarafta o
    kullanicinin tenant genelinde yetkili oldugunu soyleyen SUNUCU
    BEYANIDIR (04 §8) — tarayicidan gelmez.
    """

    source_tenant_id: str = Field(
        ..., min_length=1, max_length=SOURCE_ID_MAX_LENGTH
    )
    requester: RequesterIn
    view_all: bool = False


class MessageIn(CustomerCommandBase):
    body: str = Field(..., min_length=1, max_length=MESSAGE_MAX_LENGTH)
    source_message_id: Optional[str] = Field(
        None, max_length=SOURCE_ID_MAX_LENGTH
    )
    attachment_upload_ids: List[UUID] = Field(
        default_factory=list, max_length=5
    )


class ReasonIn(CustomerCommandBase):
    reason: str = Field(
        ..., min_length=REASON_MIN_LENGTH, max_length=REASON_MAX_LENGTH
    )


class ConfirmCloseIn(CustomerCommandBase):
    pass


class RouteValidateIn(_Contract):
    source_tenant: SourceTenantIn
    group_id: UUID


class RouteValidateOut(BaseModel):
    valid: bool
    group_active: bool
    group_name: Optional[str] = None
    source_tenant_known: bool
    route_configured: bool
    route_version: Optional[int] = None
    reason: Optional[str] = None


class RoutingGroupItem(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    member_count: int
    updated_at: Optional[datetime] = None


class RoutingGroupsOut(BaseModel):
    items: List[RoutingGroupItem]
    catalog_version: str


class AttachmentSessionIn(_Contract):
    source_tenant_id: str = Field(
        ..., min_length=1, max_length=SOURCE_ID_MAX_LENGTH
    )
    file_name: str = Field(..., min_length=1, max_length=255)
    size_bytes: int = Field(..., ge=1)
    declared_mime_type: Optional[str] = Field(None, max_length=120)
    sha256: Optional[str] = Field(None, min_length=64, max_length=64)


class AttachmentSessionOut(BaseModel):
    upload_id: UUID
    upload_url: str
    expires_at: datetime
    required_headers: dict = Field(default_factory=dict)
    max_size_bytes: int


class AttachmentDownloadIn(_Contract):
    """Kaynak uygulamanin indirme izni istegi.

    `application_code` sozlesme geregi govdede TASINIR ama YOK SAYILIR:
    uygulama sinirini token kaydindan gelen kapsam belirler (05 §9).
    Govdeden uygulama degistirme yolu YOKTUR.
    """

    ticket_id: UUID
    source_tenant_id: str = Field(
        ..., min_length=1, max_length=SOURCE_ID_MAX_LENGTH
    )
    application_code: Optional[str] = Field(None, max_length=50)


class AttachmentDownloadOut(_Contract):
    download_url: str
    expires_at: datetime
    file_name: str


class AttachmentStatusOut(BaseModel):
    upload_id: UUID
    status: str
    file_name: str
    size_bytes: int
    mime_type: Optional[str] = None
    reason: Optional[str] = None
