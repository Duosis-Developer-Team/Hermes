# =============================================================================
# HERMES - Stage 2A testleri: model metadata + admin sema validasyonu
# =============================================================================
# DB baglantisi olmadan calisir: SQLAlchemy metadata introspection +
# pydantic validator davranislari.
# =============================================================================

import uuid

import pytest
from pydantic import ValidationError

from app.database import Base
import app.models  # noqa: F401 — tum modelleri metadata'ya kaydettirir
from app.schemas.api_admin import (
    AccessBinding,
    ApiClientCreate,
    ApiClientUpdate,
)

UID = uuid.uuid4()


# ── Model metadata (tablolar / kisitlar / indexler) ─────────────────────


def test_all_four_tables_registered():
    for t in (
        "api_clients",
        "api_tokens",
        "api_client_access",
        "api_request_logs",
    ):
        assert t in Base.metadata.tables, f"missing table: {t}"


def _constraint_names(table_name):
    t = Base.metadata.tables[table_name]
    names = {c.name for c in t.constraints if c.name}
    names |= {i.name for i in t.indexes}
    return names


def test_api_clients_constraints():
    names = _constraint_names("api_clients")
    assert {
        "uq_api_clients_name",
        "chk_api_clients_type",
        "chk_api_clients_environment",
        "chk_api_clients_status",
        "chk_api_clients_user_requires_binding",
        "chk_api_clients_rate_limit_positive",
    } <= names


def test_api_tokens_constraints():
    names = _constraint_names("api_tokens")
    assert {"uq_api_tokens_hash", "chk_api_tokens_status"} <= names
    # RESTRICT: token varken client silinemez.
    fk = next(
        fk
        for fk in Base.metadata.tables["api_tokens"].foreign_keys
        if fk.column.table.name == "api_clients"
    )
    assert fk.ondelete == "RESTRICT"


def test_api_client_access_constraints():
    names = _constraint_names("api_client_access")
    assert {
        "chk_api_client_access_type",
        "chk_api_client_access_target",
        "uq_api_client_access_binding",
        "uq_api_client_access_global",
    } <= names


def test_api_request_logs_indexes():
    names = _constraint_names("api_request_logs")
    assert {
        "idx_api_request_logs_created",
        "idx_api_request_logs_client",
    } <= names


def test_no_existing_table_touched():
    # 2A yalnizca YENI tablolar ekler — mevcut kritik tablolar metadata'da
    # aynen durur (regresyon bekcisi).
    for t in ("tasks", "work_logs", "customers", "projects", "meetings"):
        assert t in Base.metadata.tables


# ── Scope validasyonu ───────────────────────────────────────────────────


def _client(**kw):
    base = dict(name="Reporting Bot", created_by=None)
    base.pop("created_by")
    base.update(kw)
    return ApiClientCreate(**base)


def test_valid_scopes_accepted():
    c = _client(scopes=["tasks:read", "work-logs:read"])
    assert c.scopes == ["tasks:read", "work-logs:read"]


def test_unknown_scope_rejected():
    with pytest.raises(ValidationError, match="Unknown scopes"):
        _client(scopes=["tasks:read", "tasks:delete-everything"])


def test_duplicate_scopes_deduped():
    c = _client(scopes=["tasks:read", "tasks:read"])
    assert c.scopes == ["tasks:read"]


def test_update_scope_validation():
    with pytest.raises(ValidationError, match="Unknown scopes"):
        ApiClientUpdate(scopes=["admin:api-clients"])


# ── Binding kurallari (amendment #5/#6) ─────────────────────────────────


def test_global_binding_must_be_alone():
    with pytest.raises(ValidationError, match="cannot coexist"):
        _client(
            access=[
                AccessBinding(access_type="global"),
                AccessBinding(access_type="project", target_id=UID),
            ]
        )


def test_global_binding_alone_ok():
    c = _client(access=[AccessBinding(access_type="global")])
    assert c.access[0].access_type == "global"


def test_global_binding_rejects_target():
    with pytest.raises(ValidationError, match="must not have a target"):
        AccessBinding(access_type="global", target_id=UID)


def test_narrow_binding_requires_target():
    with pytest.raises(ValidationError, match="requires a target_id"):
        AccessBinding(access_type="project")


def test_duplicate_bindings_rejected():
    with pytest.raises(ValidationError, match="Duplicate access binding"):
        _client(
            access=[
                AccessBinding(access_type="project", target_id=UID),
                AccessBinding(access_type="project", target_id=UID),
            ]
        )


def test_user_bound_client_requires_bound_user():
    with pytest.raises(ValidationError, match="requires bound_user_id"):
        _client(client_type="user")


def test_service_client_rejects_bound_user():
    with pytest.raises(ValidationError, match="only valid for user-bound"):
        _client(client_type="service", bound_user_id=UID)


def test_user_bound_client_rejects_global_binding():
    with pytest.raises(ValidationError, match="cannot have a global"):
        _client(
            client_type="user",
            bound_user_id=UID,
            access=[AccessBinding(access_type="global")],
        )


def test_user_bound_client_rejects_other_user_binding():
    with pytest.raises(ValidationError, match="cannot bind other users"):
        _client(
            client_type="user",
            bound_user_id=UID,
            access=[
                AccessBinding(access_type="user", target_id=uuid.uuid4())
            ],
        )


def test_user_bound_client_can_bind_itself():
    c = _client(
        client_type="user",
        bound_user_id=UID,
        access=[AccessBinding(access_type="user", target_id=UID)],
    )
    assert c.access[0].target_id == UID
