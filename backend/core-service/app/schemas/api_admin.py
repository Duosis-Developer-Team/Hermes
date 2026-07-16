# =============================================================================
# HERMES - API Management admin semalari (Stage 2A)
# =============================================================================
# Admin → API Management endpoint'lerinin request/response modelleri.
# Scope katalogu ve binding kurallari SEMA seviyesinde de dogrulanir
# (fail-fast); service katmani ayni kurallari ikinci kez uygular.
# =============================================================================

from datetime import datetime
from typing import List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from ..public_api.scopes import SCOPES

ClientTypeLiteral = Literal["service", "user"]
EnvironmentLiteral = Literal["dev", "live"]
ClientStatusLiteral = Literal["active", "disabled"]
AccessTypeLiteral = Literal["global", "user", "group", "customer", "project"]


def _validate_scopes(scopes: List[str]) -> List[str]:
    unknown = [s for s in scopes if s not in SCOPES]
    if unknown:
        raise ValueError(f"Unknown scopes: {', '.join(sorted(unknown))}")
    # Tekillestir ama secim sirasini koru.
    seen: set = set()
    out: List[str] = []
    for s in scopes:
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out


class AccessBinding(BaseModel):
    access_type: AccessTypeLiteral
    target_id: Optional[UUID] = None

    @model_validator(mode="after")
    def _target_rule(self):
        if self.access_type == "global" and self.target_id is not None:
            raise ValueError("A global binding must not have a target.")
        if self.access_type != "global" and self.target_id is None:
            raise ValueError(
                f"A {self.access_type} binding requires a target_id."
            )
        return self


def _validate_bindings(
    bindings: List[AccessBinding],
    *,
    client_type: Optional[str] = None,
    bound_user_id: Optional[UUID] = None,
) -> List[AccessBinding]:
    """Amendment #5/#6 kurallari:
    - global binding baska binding'le birlikte olamaz;
    - user-bound client global binding alamaz ve bagli kullanicidan
      baska bir user binding'i tasiyamaz.
    """
    types = [b.access_type for b in bindings]
    if "global" in types and len(bindings) > 1:
        raise ValueError(
            "A global binding cannot coexist with narrower bindings."
        )
    if client_type == "user":
        if "global" in types:
            raise ValueError(
                "User-bound clients cannot have a global binding."
            )
        for b in bindings:
            if b.access_type == "user" and b.target_id != bound_user_id:
                raise ValueError(
                    "User-bound clients cannot bind other users."
                )
    # Ayni binding'in tekrari (DB unique'e dusmeden once) reddedilir.
    seen = set()
    for b in bindings:
        key = (b.access_type, b.target_id)
        if key in seen:
            raise ValueError("Duplicate access binding.")
        seen.add(key)
    return bindings


class ApiClientCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    description: Optional[str] = Field(None, max_length=2000)
    client_type: ClientTypeLiteral = "service"
    bound_user_id: Optional[UUID] = None
    environment: EnvironmentLiteral = "dev"
    scopes: List[str] = Field(default_factory=list)
    rate_limit_per_min: Optional[int] = Field(None, ge=1, le=10000)
    access: List[AccessBinding] = Field(default_factory=list)

    @field_validator("scopes")
    @classmethod
    def _scopes_in_catalog(cls, v):
        return _validate_scopes(v)

    @model_validator(mode="after")
    def _client_rules(self):
        if self.client_type == "user" and self.bound_user_id is None:
            raise ValueError("A user-bound client requires bound_user_id.")
        if self.client_type == "service" and self.bound_user_id is not None:
            raise ValueError(
                "bound_user_id is only valid for user-bound clients."
            )
        _validate_bindings(
            self.access,
            client_type=self.client_type,
            bound_user_id=self.bound_user_id,
        )
        return self


class ApiClientUpdate(BaseModel):
    """Kismi guncelleme. client_type / bound_user_id / environment bilerek
    DEGISTIRILEMEZ — kimlik niteligindeki alanlar icin yeni client acilir."""

    name: Optional[str] = Field(None, min_length=2, max_length=100)
    description: Optional[str] = Field(None, max_length=2000)
    status: Optional[ClientStatusLiteral] = None
    scopes: Optional[List[str]] = None
    rate_limit_per_min: Optional[int] = Field(None, ge=1, le=10000)

    @field_validator("scopes")
    @classmethod
    def _scopes_in_catalog(cls, v):
        if v is None:
            return v
        return _validate_scopes(v)


class AccessBindingsUpdate(BaseModel):
    """Binding setinin TAMAMEN degistirilmesi (replace semantigi)."""

    access: List[AccessBinding] = Field(default_factory=list)


class ApiTokenCreate(BaseModel):
    expires_at: Optional[datetime] = None


class ApiTokenExpiryUpdate(BaseModel):
    """Aktif token'in omrunu gunceller; None = suresiz."""

    expires_at: Optional[datetime] = None


class ApiTokenResponse(BaseModel):
    id: UUID
    client_id: UUID
    token_prefix: str
    status: str
    expires_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None
    last_used_ip: Optional[str] = None
    rotated_from_token_id: Optional[UUID] = None
    created_at: datetime


class ApiTokenCreatedResponse(BaseModel):
    """Yalnizca olusturma/rotate yanitinda doner — plaintext token BIR KEZ
    burada gorunur ve bir daha hicbir endpoint'ten alinamaz."""

    token: str
    token_row: ApiTokenResponse


class AccessBindingResponse(BaseModel):
    id: UUID
    access_type: str
    target_id: Optional[UUID] = None


class ApiClientResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    client_type: str
    bound_user_id: Optional[UUID] = None
    environment: str
    scopes: List[str]
    rate_limit_per_min: Optional[int] = None
    status: str
    created_by: UUID
    created_at: datetime
    updated_at: datetime
    access: List[AccessBindingResponse] = Field(default_factory=list)
    tokens: List[ApiTokenResponse] = Field(default_factory=list)


class ApiRequestLogResponse(BaseModel):
    id: int
    request_id: str
    client_id: Optional[UUID] = None
    token_id: Optional[UUID] = None
    method: str
    path: str
    status_code: int
    duration_ms: int
    source_ip: Optional[str] = None
    user_agent: Optional[str] = None
    rate_limited: bool
    created_at: datetime
