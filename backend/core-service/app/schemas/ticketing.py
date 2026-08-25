# =============================================================================
# HERMES core — Ticket API semalari
# =============================================================================
# UC AYRI yanit ailesi vardir ve bu ayrim bir GUVENLIK sinididir
# (02_HERMES §5):
#
#   TicketCustomer*   → musteri yuzeyi. Public mesaj/cozum; internal not,
#                       root cause, agent kimligi, teshis alanlari YOK.
#   TicketAgent*      → Duosis agent'i. Internal icerik dahil.
#   TicketAdminOps*   → teslimat/konfigurasyon operasyonu. Mesaj govdesi
#                       OTOMATIK DAHIL DEGIL.
#
# Kural: ORM nesnesi ASLA dogrudan serialize edilmez. Donusum
# `services/ticket_serializers.py` icinde ALAN ALAN yapilir ve
# `tests/test_ticket_internal_leakage.py` musteri semalarinda internal
# alan adi bulunmadigini YAPISAL olarak dogrular.
# =============================================================================

from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..ticket_contract import (
    CATEGORIES,
    DESCRIPTION_MAX_LENGTH,
    DESCRIPTION_MIN_LENGTH,
    IMPACTS,
    MESSAGE_MAX_LENGTH,
    PRIORITIES,
    REASON_MAX_LENGTH,
    REASON_MIN_LENGTH,
    RESOLUTION_CODES,
    RESOLUTION_SUMMARY_MAX_LENGTH,
    RESOLUTION_SUMMARY_MIN_LENGTH,
    SOURCE_ID_MAX_LENGTH,
    STATUSES,
    TITLE_MAX_LENGTH,
    TITLE_MIN_LENGTH,
)

CategoryLiteral = Literal[CATEGORIES]  # type: ignore[valid-type]
ImpactLiteral = Literal[IMPACTS]  # type: ignore[valid-type]
StatusLiteral = Literal[STATUSES]  # type: ignore[valid-type]
PriorityLiteral = Literal[PRIORITIES]  # type: ignore[valid-type]
ResolutionCodeLiteral = Literal[RESOLUTION_CODES]  # type: ignore[valid-type]


class _Strict(BaseModel):
    """Tanimsiz alanlari REDDEDER.

    Sessizce yok saymak yerine reddetmek bilincli: bir istemci
    `internal_note` diye bir alan gonderiyorsa, onu gormezden gelip
    "kaydedildi" demek yanlis bir guven verirdi.
    """

    model_config = ConfigDict(extra="forbid")


# =============================================================================
# Ortak parcalar
# =============================================================================

class ClientContextIn(_Strict):
    """Guvenli teshis baglami — ALLOWLIST (05 §4).

    Cookie/JWT/Authorization/form degeri/query string ASLA toplanmaz;
    sema bunlari kabul edecek bir alan bile TANIMLAMAZ.
    """

    app_version: Optional[str] = Field(None, max_length=120)
    environment: Optional[str] = Field(None, max_length=20)
    page_path: Optional[str] = Field(None, max_length=200)
    browser: Optional[str] = Field(None, max_length=120)
    os: Optional[str] = Field(None, max_length=120)
    device_class: Optional[str] = Field(None, max_length=40)
    locale: Optional[str] = Field(None, max_length=20)
    timezone: Optional[str] = Field(None, max_length=60)
    client_timestamp: Optional[datetime] = None


class GroupRef(BaseModel):
    id: Optional[UUID] = None
    name: Optional[str] = None


class SourceTenantRef(BaseModel):
    id: Optional[UUID] = None
    source_tenant_id: Optional[str] = None
    display_name: Optional[str] = None


class ApplicationRef(BaseModel):
    id: Optional[UUID] = None
    code: Optional[str] = None
    display_name: Optional[str] = None


class AttachmentOut(BaseModel):
    id: UUID
    file_name: str
    size_bytes: int
    mime_type: Optional[str] = None
    scan_status: str
    visibility: str
    created_at: datetime


class MessagePublicOut(BaseModel):
    """Musteriye gorunur mesaj. `visibility` alani BILEREK YOKTUR:
    musteri yuzeyinde yalnizca public mesajlar bulunur, dolayisiyla
    alanin var olmasi 'internal de olabilir' izlenimi verirdi."""

    id: UUID
    sequence: int
    author_type: str
    author_display_name: Optional[str] = None
    body: str
    body_format: str
    created_at: datetime
    attachments: List[AttachmentOut] = Field(default_factory=list)


class MessageAgentOut(MessagePublicOut):
    visibility: str


class ResolutionPublicOut(BaseModel):
    revision: int
    resolution_code: str
    summary: str
    workaround: Optional[str] = None
    fix_version: Optional[str] = None
    resolved_at: datetime
    resolved_by_team: Optional[str] = None
    attachments: List[AttachmentOut] = Field(default_factory=list)


class ResolutionAgentOut(ResolutionPublicOut):
    internal_root_cause: Optional[str] = None
    resolved_by_display_name: Optional[str] = None
    superseded_at: Optional[datetime] = None


# =============================================================================
# Musteri yuzeyi
# =============================================================================

class TicketCustomerListItem(BaseModel):
    id: UUID
    ticket_number: str
    title: str
    status: StatusLiteral
    category: CategoryLiteral
    impact: ImpactLiteral
    assigned_group: GroupRef
    created_at: datetime
    updated_at: datetime
    resolved_at: Optional[datetime] = None
    last_public_activity_at: Optional[datetime] = None
    requester_display_name: Optional[str] = None
    version: int


class TicketCustomerOut(TicketCustomerListItem):
    reproduction_steps: Optional[str] = None
    expected_result: Optional[str] = None
    actual_result: Optional[str] = None
    error_code: Optional[str] = None
    correlation_id: Optional[str] = None
    occurred_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    reopen_window_open: bool = False
    messages: List[MessagePublicOut] = Field(default_factory=list)
    resolution: Optional[ResolutionPublicOut] = None
    resolution_history: List[ResolutionPublicOut] = Field(
        default_factory=list
    )
    attachments: List[AttachmentOut] = Field(default_factory=list)


# =============================================================================
# Agent yuzeyi
# =============================================================================

class TicketAgentListItem(BaseModel):
    id: UUID
    ticket_number: str
    title: str
    status: StatusLiteral
    category: CategoryLiteral
    impact: ImpactLiteral
    priority: PriorityLiteral
    application: ApplicationRef
    source_tenant: SourceTenantRef
    assigned_group: GroupRef
    assigned_user_id: Optional[UUID] = None
    requester_display_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    first_response_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    last_public_activity_at: Optional[datetime] = None
    version: int


class TicketEventOut(BaseModel):
    id: UUID
    sequence: int
    event_type: str
    actor_type: str
    actor_display_name: Optional[str] = None
    reason: Optional[str] = None
    metadata: dict = Field(default_factory=dict)
    occurred_at: datetime


class TicketAgentOut(TicketAgentListItem):
    requester_source_user_id: str
    requester_email: Optional[str] = None
    reproduction_steps: Optional[str] = None
    expected_result: Optional[str] = None
    actual_result: Optional[str] = None
    error_code: Optional[str] = None
    correlation_id: Optional[str] = None
    occurred_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    client_context: dict = Field(default_factory=dict)
    route_version: int
    duplicate_of_ticket_id: Optional[UUID] = None
    messages: List[MessageAgentOut] = Field(default_factory=list)
    resolution: Optional[ResolutionAgentOut] = None
    resolution_history: List[ResolutionAgentOut] = Field(
        default_factory=list
    )
    attachments: List[AttachmentOut] = Field(default_factory=list)
    allowed_transitions: List[str] = Field(default_factory=list)


class TicketListResponse(BaseModel):
    items: List[TicketAgentListItem]
    total: int
    limit: int
    offset: int


class TicketCustomerListResponse(BaseModel):
    items: List[TicketCustomerListItem]
    total: int
    limit: int
    offset: int


# =============================================================================
# Komutlar
# =============================================================================

class TicketCreateRequest(_Strict):
    title: str = Field(
        ..., min_length=TITLE_MIN_LENGTH, max_length=TITLE_MAX_LENGTH
    )
    description: str = Field(
        ..., min_length=DESCRIPTION_MIN_LENGTH,
        max_length=DESCRIPTION_MAX_LENGTH,
    )
    category: CategoryLiteral
    impact: ImpactLiteral
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
    attachment_ids: List[UUID] = Field(default_factory=list, max_length=5)
    # Kaynakta uretilen kimlik; retry'da AYNI kalmali (02 §2). Portal
    # gondermezse sunucu uretir.
    source_ticket_id: Optional[str] = Field(
        None, max_length=SOURCE_ID_MAX_LENGTH
    )


class MessageCreateRequest(_Strict):
    body: str = Field(..., min_length=1, max_length=MESSAGE_MAX_LENGTH)
    visibility: Literal["public", "internal"] = "public"
    attachment_ids: List[UUID] = Field(default_factory=list, max_length=5)
    expected_version: Optional[int] = Field(None, ge=1)


class CustomerMessageCreateRequest(_Strict):
    """Musteri composer'i: `visibility` alani YOKTUR — musteri internal
    not yazamaz ve semada boyle bir secim GORUNMEZ."""

    body: str = Field(..., min_length=1, max_length=MESSAGE_MAX_LENGTH)
    attachment_ids: List[UUID] = Field(default_factory=list, max_length=5)
    expected_version: Optional[int] = Field(None, ge=1)


class TransitionRequest(_Strict):
    to_status: StatusLiteral
    expected_version: int = Field(..., ge=1)
    reason: Optional[str] = Field(None, max_length=REASON_MAX_LENGTH)
    public_message: Optional[str] = Field(
        None, min_length=1, max_length=MESSAGE_MAX_LENGTH
    )
    attachment_ids: List[UUID] = Field(default_factory=list, max_length=5)


class AssignGroupRequest(_Strict):
    group_id: UUID
    expected_version: int = Field(..., ge=1)
    reason: Optional[str] = Field(None, max_length=REASON_MAX_LENGTH)


class AssignUserRequest(_Strict):
    user_id: Optional[UUID] = None
    expected_version: int = Field(..., ge=1)


class PriorityRequest(_Strict):
    priority: PriorityLiteral
    expected_version: int = Field(..., ge=1)


class ResolveRequest(_Strict):
    resolution_code: ResolutionCodeLiteral
    public_summary: str = Field(
        ..., min_length=RESOLUTION_SUMMARY_MIN_LENGTH,
        max_length=RESOLUTION_SUMMARY_MAX_LENGTH,
    )
    expected_version: int = Field(..., ge=1)
    public_workaround: Optional[str] = Field(
        None, max_length=RESOLUTION_SUMMARY_MAX_LENGTH
    )
    fix_version: Optional[str] = Field(None, max_length=120)
    internal_root_cause: Optional[str] = Field(
        None, max_length=RESOLUTION_SUMMARY_MAX_LENGTH
    )
    internal_note: Optional[str] = Field(None, max_length=MESSAGE_MAX_LENGTH)
    attachment_ids: List[UUID] = Field(default_factory=list, max_length=5)
    duplicate_of_ticket_id: Optional[UUID] = None


class ReasonRequest(_Strict):
    reason: str = Field(
        ..., min_length=REASON_MIN_LENGTH, max_length=REASON_MAX_LENGTH
    )
    expected_version: int = Field(..., ge=1)


class ConfirmCloseRequest(_Strict):
    expected_version: int = Field(..., ge=1)


# =============================================================================
# Yuzey baglami / kuyruklar
# =============================================================================

class TicketContextOut(BaseModel):
    """Frontend'in HANGI yuzeyi acacagini soyleyen tek kaynak.

    Karar SUNUCUDA verilir: istemci "ben Duosis miyim?" diye tahmin
    etmez, `surface` alanini okur. Boylece tenant kimligi frontend'e
    gomulmez.
    """

    module_enabled: bool
    surface: Literal["hub", "portal", "unavailable"]
    reason: Optional[str] = None
    permissions: List[str] = Field(default_factory=list)
    can_create: bool = False
    has_scope: bool = True
    attachments_enabled: bool = False
    route: Optional["RouteStatusOut"] = None


class RouteStatusOut(BaseModel):
    configured: bool
    group_name: Optional[str] = None
    route_version: Optional[int] = None


class QueueCountOut(BaseModel):
    key: str
    label: str
    count: int


class ApplicationOut(BaseModel):
    id: UUID
    code: str
    display_name: str
    status: str
    open_ticket_count: int = 0


class SourceTenantOut(BaseModel):
    id: UUID
    application_id: UUID
    source_tenant_id: str
    source_tenant_slug: Optional[str] = None
    display_name: str
    status: str
    route: Optional["RouteOut"] = None


class RouteOut(BaseModel):
    id: UUID
    group_id: UUID
    group_name: Optional[str] = None
    route_version: int
    is_active: bool
    verified_at: Optional[datetime] = None
    updated_at: datetime


class RoutingGroupOut(BaseModel):
    """Integration'a acilan MINIMAL grup gorunumu — uye kimligi YOK."""

    id: UUID
    name: str
    description: Optional[str] = None
    member_count: int
    updated_at: Optional[datetime] = None


# =============================================================================
# Admin: konfigurasyon ve teslimat
# =============================================================================

class ApplicationUpsertRequest(_Strict):
    code: str = Field(..., min_length=2, max_length=50)
    display_name: str = Field(..., min_length=2, max_length=120)
    description: Optional[str] = Field(None, max_length=2000)
    callback_url: Optional[str] = Field(None, max_length=500)
    webhook_key_id: Optional[str] = Field(None, max_length=80)

    @field_validator("code")
    @classmethod
    def _lower_code(cls, value: str) -> str:
        return value.strip().lower()


class ApplicationUpdateRequest(_Strict):
    display_name: Optional[str] = Field(None, min_length=2, max_length=120)
    description: Optional[str] = Field(None, max_length=2000)
    callback_url: Optional[str] = Field(None, max_length=500)
    webhook_key_id: Optional[str] = Field(None, max_length=80)
    status: Optional[Literal["active", "disabled"]] = None


class SourceTenantUpsertRequest(_Strict):
    application_id: UUID
    source_tenant_id: str = Field(
        ..., min_length=1, max_length=SOURCE_ID_MAX_LENGTH
    )
    display_name: str = Field(..., min_length=1, max_length=200)
    source_tenant_slug: Optional[str] = Field(None, max_length=128)


class RouteUpsertRequest(_Strict):
    group_id: UUID


class IntegrationClientCreateRequest(_Strict):
    application_id: UUID
    name: str = Field(..., min_length=2, max_length=120)
    description: Optional[str] = Field(None, max_length=2000)
    scopes: List[str] = Field(..., min_length=1)
    rate_limit_per_min: Optional[int] = Field(None, ge=1, le=100000)


class IntegrationClientUpdateRequest(_Strict):
    scopes: Optional[List[str]] = None
    status: Optional[Literal["active", "disabled"]] = None
    rate_limit_per_min: Optional[int] = Field(None, ge=1, le=100000)


class IntegrationTokenCreateRequest(_Strict):
    expires_at: Optional[datetime] = None


class IntegrationTokenOut(BaseModel):
    id: UUID
    token_prefix: str
    status: str
    expires_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None
    created_at: datetime


class IntegrationTokenCreatedOut(BaseModel):
    """Plaintext YALNIZCA burada, YALNIZCA bir kez."""

    token: str
    token_id: UUID
    token_prefix: str
    expires_at: Optional[datetime] = None


class IntegrationClientOut(BaseModel):
    id: UUID
    application_id: UUID
    application_code: Optional[str] = None
    name: str
    description: Optional[str] = None
    environment: str
    scopes: List[str] = Field(default_factory=list)
    status: str
    rate_limit_per_min: Optional[int] = None
    created_at: datetime
    tokens: List[IntegrationTokenOut] = Field(default_factory=list)


class DeliveryEventOut(BaseModel):
    """Teslimat operasyon gorunumu. Mesaj GOVDESI otomatik dahil DEGIL:
    yalnizca kimlik, durum, guvenli hata kodu ve zamanlama."""

    id: UUID
    event_id: UUID
    event_type: str
    ticket_id: UUID
    ticket_number: Optional[str] = None
    application_code: Optional[str] = None
    status: str
    attempts: int
    sequence: int
    last_error_code: Optional[str] = None
    last_status_code: Optional[int] = None
    next_attempt_at: Optional[datetime] = None
    created_at: datetime
    sent_at: Optional[datetime] = None
    dead_at: Optional[datetime] = None


class DeliveryStatsOut(BaseModel):
    pending: int
    in_flight: int
    delivered: int
    dead: int
    oldest_pending_at: Optional[datetime] = None
    last_success_at: Optional[datetime] = None


class TicketHealthOut(BaseModel):
    module_state: str
    module_detail: Optional[str] = None
    support_tenant_configured: bool
    attachments_enabled: bool
    attachments_production_ready: bool
    attachments_reason: Optional[str] = None
    object_storage_reachable: Optional[bool] = None
    malware_scanner_reachable: Optional[bool] = None
    delivery: DeliveryStatsOut
    applications: int
    unrouted_source_tenants: int


TicketContextOut.model_rebuild()
SourceTenantOut.model_rebuild()
