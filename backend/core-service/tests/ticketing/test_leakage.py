# =============================================================================
# HERMES — Internal icerik sizinti kapilari (YAPISAL)
# =============================================================================
# Veri testleri "bu ornekte sizmadi" der; yapisal testler "sizmasi
# MUMKUN DEGIL" der. Ikisi de gerekli:
#
#   - musteri semalari internal alan ADI TANIMLAYAMAZ;
#   - outbound builder'lar internal anahtar URETEMEZ;
#   - outbox'a yalnizca KAPALI KUMEDEKI olay tipleri girebilir;
#   - musteri serializer'i internal kayitlari SORGUYA BILE almaz.
# =============================================================================

import inspect

import pytest

from app.schemas import ticketing as schemas
from app.services import ticket_event_service as events
from app.ticket_contract import INTERNAL_ONLY_EVENTS, OUTBOUND_EVENT_TYPES

# Musteri yuzeyinde ASLA gorulmemesi gereken alan adlari.
FORBIDDEN_CUSTOMER_FIELDS = {
    "internal_root_cause",
    "resolved_by_display_name",
    "resolved_by_user_id",
    "client_context",
    "assigned_user_id",
    "priority",
    "route_version",
    "requester_source_user_id",
    "superseded_at",
}

CUSTOMER_MODELS = (
    schemas.TicketCustomerOut,
    schemas.TicketCustomerListItem,
    schemas.MessagePublicOut,
    schemas.ResolutionPublicOut,
)


@pytest.mark.parametrize("model", CUSTOMER_MODELS)
def test_customer_schemas_declare_no_internal_fields(model):
    fields = set(model.model_fields)
    leaked = fields & FORBIDDEN_CUSTOMER_FIELDS
    assert not leaked, f"{model.__name__} internal alan tasiyor: {leaked}"


def test_public_message_schema_has_no_visibility_switch():
    """Musteri gorunumunde `visibility` alani BULUNMAZ.

    Alanin varligi "internal de olabilirdi" izlenimi verirdi; musteri
    yuzeyinde yalnizca public mesaj vardir.
    """
    assert "visibility" not in schemas.MessagePublicOut.model_fields
    # Agent gorunumunde ise ZORUNLU.
    assert "visibility" in schemas.MessageAgentOut.model_fields


def test_customer_message_request_cannot_select_visibility():
    assert "visibility" not in (
        schemas.CustomerMessageCreateRequest.model_fields
    )
    assert "visibility" in schemas.MessageCreateRequest.model_fields


def test_agent_schema_is_a_superset_of_the_customer_schema():
    """Agent yuzeyi musteri alanlarini KAYBETMEZ; yalnizca ekler."""
    customer = set(schemas.TicketCustomerListItem.model_fields)
    agent = set(schemas.TicketAgentListItem.model_fields)
    # `assigned_group` gibi ortak alanlar iki tarafta da bulunmali.
    for shared in ("id", "ticket_number", "title", "status", "category",
                   "impact", "assigned_group", "created_at", "version"):
        assert shared in customer and shared in agent


def test_outbound_builders_never_emit_internal_keys():
    """Builder ciktilarinin ANAHTAR uzayi allowlist'tir."""
    source = inspect.getsource(events)
    # Internal alanlar builder kaynaginda GECMEMELI (yorum disinda).
    code = "\n".join(
        line for line in source.splitlines()
        if not line.strip().startswith("#")
    )
    assert "internal_root_cause" not in code
    assert "author_user_id" not in code


def test_enqueue_refuses_non_outbound_event_types():
    """Internal bir olay tipi outbox'a GIREMEZ — programlama hatasi
    olarak erken patlar."""
    for event_type in INTERNAL_ONLY_EVENTS:
        assert event_type not in OUTBOUND_EVENT_TYPES

    with pytest.raises(ValueError):
        events.record_event(
            db=None, ticket=None,
            event_type=INTERNAL_ONLY_EVENTS[0],
            actor_type="support_agent",
            outbound_data={"leak": True},
        )


def test_customer_serializer_filters_internal_rows_in_sql():
    """Filtreleme SORGUDA yapilir, sonradan degil.

    Sonradan filtrelemek, bir gun unutulabilecek bir adimdir; sorguya
    gomulu kosul unutulamaz.
    """
    from app.services import ticket_serializers as ser

    source = inspect.getsource(ser.load_messages)
    assert 'visibility == "public"' in source
    source = inspect.getsource(ser.load_attachments)
    assert 'visibility == "public"' in source


def test_resolution_serializers_split_public_and_internal():
    from app.services import ticket_serializers as ser

    public_src = inspect.getsource(ser.resolution_public_out)
    assert "internal_root_cause" not in public_src.replace(
        "# `internal_root_cause` ve `resolved_by_display_name` BILEREK YOK.",
        "",
    )
    agent_src = inspect.getsource(ser.resolution_agent_out)
    assert "internal_root_cause" in agent_src


def test_delivery_serializer_never_carries_the_payload():
    """Teslimat ekraninda ticket ICERIGI gosterilmez (06 §8)."""
    assert "payload_json" not in schemas.DeliveryEventOut.model_fields


def test_integration_token_output_never_exposes_the_hash():
    assert "token_hash" not in schemas.IntegrationTokenOut.model_fields
    assert "token" not in schemas.IntegrationTokenOut.model_fields
    # Plaintext YALNIZCA olusturma yanitinda.
    assert "token" in schemas.IntegrationTokenCreatedOut.model_fields


def test_mcp_service_does_not_import_the_ticketing_module():
    """MCP bir ticket entegrasyon protokolu DEGILDIR (README kritik
    sinirlar). Yapisal kanit: MCP kaynaklarinda ticket modulu importu
    bulunmaz."""
    from pathlib import Path

    mcp_root = (
        Path(__file__).resolve().parents[4] / "backend" / "mcp-service"
    )
    if not mcp_root.exists():  # pragma: no cover
        pytest.skip("mcp-service not present")
    offenders = []
    for path in mcp_root.rglob("*.py"):
        if "__pycache__" in str(path):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for needle in ("ticket_service", "models.ticketing",
                       "support_api", "ticket_contract"):
            if needle in text:
                offenders.append(f"{path.name}: {needle}")
    assert not offenders, offenders
