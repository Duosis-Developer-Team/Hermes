# =============================================================================
# HERMES — Ortak sozlesme parite kapisi
# =============================================================================
# Cross-repo bir paket yayinlama altyapisi yok; WS0 karari "kontrollu
# duplicate fixture + parite testi"dir. Bu dosya o kapidir:
#
#   kod (app/ticket_contract.py)
#        ==  docs/contracts/support-ticketing-v1/contract.json
#
# LogiSlot ayni JSON'u kendi reposuna kopyalar ve kendi consumer
# testinde ayni karsilastirmayi yapar. Kodda sessizce bir enum
# degistirmek burada KIRILIR; degisiklik istenerek yapiliyorsa fixture
# da bilincli olarak guncellenir (ve karar gunlugune yazilir).
# =============================================================================

import hashlib
import hmac
import json
from pathlib import Path

import pytest

from app.ticket_contract import (
    ERROR_CATALOG,
    ERROR_MESSAGES,
    OUTBOUND_EVENT_TYPES,
    RETRY_BACKOFF_SECONDS,
    contract_snapshot,
    format_ticket_number,
    is_retryable_status,
    next_backoff_seconds,
)

_CONTRACT_DIR = (
    Path(__file__).resolve().parents[4]
    / "docs" / "contracts" / "support-ticketing-v1"
)


def _load(name: str):
    path = _CONTRACT_DIR / name
    if not path.exists():  # pragma: no cover
        pytest.fail(f"contract fixture missing: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def test_contract_snapshot_matches_frozen_fixture():
    assert contract_snapshot() == _load("contract.json"), (
        "Kod ile donmus sozlesme fixture'i ayristi. Degisiklik "
        "bilincliyse docs/contracts/support-ticketing-v1/contract.json "
        "guncellenmeli ve LogiSlot tarafina bildirilmelidir."
    )


def test_webhook_signature_golden_vector():
    """Iki repo AYNI baytlari AYNI sekilde imzalamali.

    Bu vektor olmasaydi, "HMAC-SHA256" demek yetmezdi: ayirici,
    kodlama (hex/base64) ve prefix konusunda sessizce ayrisilirdi ve
    hata ancak canli entegrasyonda gorunurdu.
    """
    vector = _load("webhook-signature-vector.json")
    expected = hmac.new(
        vector["secret"].encode("utf-8"),
        f"{vector['timestamp']}.{vector['raw_body']}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    assert expected == vector["expected_signature"]

    from app.services.ticket_delivery_service import sign_payload

    assert sign_payload(
        vector["secret"], vector["timestamp"], vector["raw_body"]
    ) == vector["expected_signature"]


def test_sample_payloads_are_valid_against_schemas():
    from app.support_api.schemas import TicketCreateIn

    payload = _load("samples/ticket-create-request.json")
    parsed = TicketCreateIn(**payload)
    assert parsed.source_tenant.id == "bta"
    assert parsed.category == "bug"


def test_sample_webhook_events_cover_every_outbound_type():
    events = _load("samples/webhook-events.json")
    assert set(events) == set(OUTBOUND_EVENT_TYPES)
    for name, envelope in events.items():
        assert envelope["event_type"] == name
        # Zarf alanlari sozlesmede sabittir.
        for field in (
            "event_id", "event_type", "occurred_at", "application_code",
            "source_tenant_id", "source_ticket_id", "ticket_id",
            "ticket_number", "aggregate_version", "sequence", "data",
        ):
            assert field in envelope, f"{name}: {field} eksik"


def test_error_catalog_is_complete_and_documented():
    assert set(ERROR_CATALOG) == set(ERROR_MESSAGES)
    # Sozlesmede ADI GECEN kodlarin hepsi katalogda olmali.
    for code in (
        "route_missing", "route_stale", "group_inactive",
        "source_tenant_unknown", "idempotency_conflict",
        "attachment_not_ready", "ticket_version_conflict", "forbidden",
        "rate_limited", "integration_unavailable",
    ):
        assert code in ERROR_CATALOG


def test_retry_classification_matches_contract():
    # Ag/timeout ve 5xx retryable; 4xx (429 haric) degil.
    assert is_retryable_status(None) is True
    assert is_retryable_status(500) is True
    assert is_retryable_status(502) is True
    assert is_retryable_status(429) is True
    assert is_retryable_status(408) is True
    for code in (400, 401, 403, 404, 409, 422):
        assert is_retryable_status(code) is False


def test_backoff_ladder_is_monotonic_and_capped():
    assert RETRY_BACKOFF_SECONDS == (10, 30, 120, 600, 1800, 7200)
    ladder = [next_backoff_seconds(n) for n in range(1, 10)]
    assert ladder[:6] == list(RETRY_BACKOFF_SECONDS)
    # Basamaklar bittikten sonra son degerde KALIR (sonsuz buyume yok).
    assert ladder[6:] == [7200, 7200, 7200]
    assert next_backoff_seconds(0) == 10


def test_ticket_number_format():
    assert format_ticket_number(1) == "TKT-000001"
    assert format_ticket_number(123) == "TKT-000123"
    # 6 haneyi asan numara KIRPILMAZ.
    assert format_ticket_number(12345678) == "TKT-12345678"
