# =============================================================================
# HERMES — Metin, attachment ve teslimat politikalari (saf birim testleri)
# =============================================================================
# 05 §5/§6 ve 06 §2'nin makine-dogrulanabilir kismi. DB/ag gerektirmez;
# bu yuzden hizli kosar ve her degisiklikte calistirilabilir.
# =============================================================================

import pytest

from app.services import ticket_scanner as scanner
from app.services import ticket_storage as storage
from app.services.ticket_delivery_service import (
    DeliveryConfigError,
    secret_env_names,
    sign_payload,
    validate_callback_url,
)
from app.services.ticket_storage import canonical_request
from app.services.ticket_text import (
    sanitize_body,
    sanitize_filename,
    sanitize_single_line,
)

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"0" * 64
PDF = b"%PDF-1.7\n" + b"0" * 64
WEBP = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"0" * 64
TXT = "islem kaydi: 200 OK\nsatir 2\n".encode("utf-8")
EXE = b"MZ\x90\x00" + b"0" * 64
SVG = b"<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>"
ZIP = b"PK\x03\x04" + b"0" * 64


# =============================================================================
# Metin sanitizasyonu
# =============================================================================

def test_raw_html_is_stripped():
    out = sanitize_body("<script>steal()</script>merhaba", max_length=100)
    assert "<script>" not in out and "</script>" not in out
    assert "merhaba" in out


def test_dangerous_markdown_link_targets_are_neutralised():
    out = sanitize_body("[tikla](javascript:alert(1))", max_length=200)
    assert "javascript:" not in out.lower()
    out = sanitize_body("[x](DATA:text/html;base64,PHNjcmlwdD4=)",
                        max_length=200)
    assert "data:" not in out.lower()


def test_control_and_invisible_characters_are_removed():
    out = sanitize_body("a\x00b\u200bc\u202ed", max_length=100)
    assert out == "abcd"


def test_body_is_truncated_after_cleaning_not_before():
    raw = "<b>" + "x" * 50
    out = sanitize_body(raw, max_length=10)
    assert len(out) == 10 and "<" not in out


def test_single_line_collapses_whitespace():
    assert sanitize_single_line("  a\n\n b ", max_length=50) == "a b"


@pytest.mark.parametrize("raw,expected_suffix", [
    ("../../etc/passwd", "passwd"),
    ("C:\\Windows\\system32\\cmd.exe", "cmd.exe"),
    ("....//evil.png", "evil.png"),
])
def test_filename_path_traversal_is_normalised(raw, expected_suffix):
    assert sanitize_filename(raw).endswith(expected_suffix)


def test_filename_keeps_readable_unicode():
    assert sanitize_filename("ekran görüntüsü.png") == "ekran görüntüsü.png"


# =============================================================================
# Attachment icerik politikasi
# =============================================================================

@pytest.mark.parametrize("data,name,mime", [
    (PNG, "shot.png", "image/png"),
    (JPEG, "shot.jpg", "image/jpeg"),
    (PDF, "rapor.pdf", "application/pdf"),
    (WEBP, "shot.webp", "image/webp"),
    (TXT, "app.log", "text/plain"),
])
def test_allowed_types_pass_content_verification(data, name, mime):
    verdict = scanner.verify_content(
        data, declared_mime=mime, file_name=name
    )
    assert verdict.ok, verdict.reason
    assert verdict.detected_mime == mime


@pytest.mark.parametrize("data,name,reason_prefix", [
    (EXE, "setup.png", "forbidden"),
    (SVG, "logo.png", "forbidden"),
    (ZIP, "logs.png", "forbidden"),
])
def test_executables_archives_and_markup_are_rejected(
    data, name, reason_prefix
):
    verdict = scanner.verify_content(
        data, declared_mime="image/png", file_name=name
    )
    assert not verdict.ok
    assert verdict.reason.startswith(reason_prefix)


def test_mime_spoofing_is_rejected():
    """Uzantisi .png olan bir PDF kabul EDILMEZ."""
    verdict = scanner.verify_content(
        PDF, declared_mime="image/png", file_name="screenshot.png"
    )
    assert not verdict.ok
    assert verdict.reason in ("mime_mismatch", "extension_mismatch")


def test_extension_mismatch_is_rejected():
    verdict = scanner.verify_content(
        PNG, declared_mime="image/png", file_name="screenshot.pdf"
    )
    assert not verdict.ok
    assert verdict.reason == "extension_mismatch"


def test_empty_file_is_rejected():
    verdict = scanner.verify_content(
        b"", declared_mime="image/png", file_name="x.png"
    )
    assert not verdict.ok and verdict.reason == "empty_file"


def test_scanner_failure_is_fail_closed(monkeypatch):
    """Tarayiciya ulasilamazsa sonuc `scan_failed`; ASLA `clean`."""
    engine = scanner.ClamAVScanner("127.0.0.1", 1, 0.05)
    result = engine.scan(PNG)
    assert result.status == "scan_failed"
    assert result.error_code == "scanner_unavailable"


def test_production_posture_requires_storage_and_scanner(monkeypatch):
    from app.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "TICKET_ATTACHMENTS_ENABLED", True)
    monkeypatch.setattr(settings, "PUBLIC_API_ENV", "live")
    monkeypatch.setattr(settings, "TICKET_STORAGE_BACKEND", "local")
    assert scanner.production_posture_error() == "object_storage_required"

    monkeypatch.setattr(settings, "TICKET_STORAGE_BACKEND", "s3")
    monkeypatch.setattr(settings, "TICKET_S3_ENDPOINT_URL", "https://s3")
    monkeypatch.setattr(settings, "TICKET_S3_BUCKET", "b")
    monkeypatch.setattr(settings, "TICKET_S3_ACCESS_KEY_ID", "a")
    monkeypatch.setattr(settings, "TICKET_S3_SECRET_ACCESS_KEY", "s")
    monkeypatch.setattr(
        settings, "TICKET_SCANNER_MODE", "disabled_dev_only"
    )
    # 'live' ortamda tarayicisiz mod ozelligi ACMAZ.
    assert scanner.production_posture_error() == "malware_scanner_required"

    monkeypatch.setattr(settings, "TICKET_SCANNER_MODE", "clamav")
    monkeypatch.setattr(settings, "TICKET_SCANNER_HOST", "clamav")
    assert scanner.production_posture_error() is None
    ready, reason = scanner.attachments_production_ready()
    assert ready and reason is None


def test_dev_mode_is_never_production_ready(monkeypatch):
    from app.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "TICKET_ATTACHMENTS_ENABLED", True)
    monkeypatch.setattr(settings, "PUBLIC_API_ENV", "dev")
    monkeypatch.setattr(settings, "TICKET_STORAGE_BACKEND", "local")
    monkeypatch.setattr(
        settings, "TICKET_SCANNER_MODE", "disabled_dev_only"
    )
    # Dev'de CALISIR (posture hatasi yok) ama production-ready DEGIL.
    assert scanner.production_posture_error() is None
    ready, reason = scanner.attachments_production_ready()
    assert not ready
    assert reason == "local_storage_not_production"


# =============================================================================
# Object storage
# =============================================================================

def test_local_storage_rejects_keys_that_escape_the_root(tmp_path):
    store = storage.LocalObjectStorage(str(tmp_path))
    with pytest.raises(storage.StorageError):
        store.put("../escape", b"x", content_type="text/plain")


def test_local_storage_round_trip_and_move(tmp_path):
    store = storage.LocalObjectStorage(str(tmp_path))
    store.put("quarantine/a", b"hello", content_type="text/plain")
    assert store.get("quarantine/a") == b"hello"
    store.move("quarantine/a", "attachments/a")
    assert store.get("attachments/a") == b"hello"
    with pytest.raises(storage.StorageError):
        store.get("quarantine/a")
    store.delete("attachments/a")


def test_object_keys_are_random_and_prefixed():
    a = storage.new_object_key("quarantine/")
    b = storage.new_object_key("quarantine/")
    assert a != b
    assert a.startswith("quarantine/")
    # Dosya adi anahtara GIRMEZ.
    assert "." not in a.rsplit("/", 1)[-1]


def test_sigv4_canonical_request_is_deterministic():
    headers = {"Host": "s3.example.com", "X-Amz-Date": "20260825T000000Z"}
    first = canonical_request("PUT", "/b/k", "", headers, "abc")
    second = canonical_request(
        "put", "/b/k", "", {"x-amz-date": "20260825T000000Z",
                            "host": "s3.example.com"}, "abc",
    )
    assert first == second
    # Basliklar kucuk harf ve SIRALI olmali.
    assert "host:s3.example.com\nx-amz-date:" in first


def test_sigv4_signing_key_matches_aws_reference_vector():
    """AWS dokumanindaki turetme vektoru (SigV4 test suite)."""
    key = storage.signing_key(
        "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
        "20150830", "us-east-1", "iam",
    )
    assert key.hex() == (
        "c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9"
    )


# =============================================================================
# Webhook teslimati
# =============================================================================

def test_signature_is_lowercase_hex_over_timestamp_dot_body():
    signature = sign_payload("secret", "1700000000", '{"a":1}')
    assert signature == signature.lower()
    assert len(signature) == 64
    # Farkli timestamp → farkli imza (replay penceresini anlamli kilar).
    assert signature != sign_payload("secret", "1700000001", '{"a":1}')


def test_secret_env_names_follow_the_documented_pattern():
    current, nxt = secret_env_names("logi-slot")
    assert current.endswith("LOGI_SLOT")
    assert nxt == current + "_NEXT"


@pytest.mark.parametrize("url", [
    "http://example.com/hook",          # HTTPS zorunlu
    "ftp://example.com/hook",
    "https://localhost/hook",           # loopback
    "https://127.0.0.1/hook",
    "https://169.254.169.254/latest",   # cloud metadata
    "https://10.0.0.5/hook",            # private
])
def test_ssrf_and_scheme_guards_reject_unsafe_callbacks(url, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(
        get_settings(), "TICKET_WEBHOOK_ALLOW_INSECURE_HTTP", False
    )
    with pytest.raises(DeliveryConfigError):
        validate_callback_url(url)


def test_missing_callback_url_is_rejected():
    with pytest.raises(DeliveryConfigError):
        validate_callback_url("")
