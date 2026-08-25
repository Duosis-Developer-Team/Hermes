# =============================================================================
# HERMES core — Attachment icerik dogrulama + malware tarama
# =============================================================================
# 05 §5 pipeline'i: magic-byte sniff → MIME allowlist → malware scan.
# UZANTI TEK BASINA YETMEZ: `.png` uzantili bir HTML dosyasi, uygun bir
# tuketicide calistirilabilir icerige donusebilir.
#
# FAIL-CLOSED: tarayici yoksa/erisilemiyorsa dosya `scan_failed` olur ve
# EKLENEMEZ. "Tarayamadim, gecir" davranisi YOKTUR — pack acikca
# "fail-open yapilmaz" der.
#
# Gelistirme kolayligi bilincli ve DAR: `TICKET_SCANNER_MODE=
# disabled_dev_only` yalnizca `PUBLIC_API_ENV='dev'` deployment'inda
# gecerlidir; 'live' ortamda attachment ozelligi bu modda ACILMAZ
# (bkz. `production_posture_error`).
# =============================================================================

from __future__ import annotations

import logging
import socket
import struct
import time
from dataclasses import dataclass
from typing import Optional, Tuple

from ..config import get_settings
from ..ticket_contract import ATTACHMENT_ALLOWED_MIME

logger = logging.getLogger("hermes.ticket.scanner")

MODE_CLAMAV = "clamav"
MODE_DISABLED_DEV = "disabled_dev_only"


# =============================================================================
# 1) Icerik tipi tespiti (magic bytes)
# =============================================================================

_MAGIC = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"%PDF-", "application/pdf"),
)

# Kesin olarak REDDEDILEN imzalar: calistirilabilirler ve arsivler.
# Allowlist zaten bunlari disarida birakir; burada ayrica adlandirmak,
# reddin GEREKCESINI (audit/metrik) netlestirir.
_FORBIDDEN_MAGIC = (
    (b"MZ", "executable"),
    (b"\x7fELF", "executable"),
    (b"\xca\xfe\xba\xbe", "executable"),
    (b"PK\x03\x04", "archive"),
    (b"Rar!", "archive"),
    (b"\x1f\x8b", "archive"),
    (b"<?xml", "markup"),
    (b"<svg", "markup"),
    (b"<!DOCTYPE", "markup"),
    (b"<html", "markup"),
)


def detect_mime(data: bytes, declared: Optional[str]) -> Optional[str]:
    """Icerikten MIME tespiti. Bilinmiyorsa `None`.

    Metin tipleri (TXT/LOG) magic tasimaz; bu yuzden "binary DEGIL"
    testiyle dogrulanir: NUL bayti yok ve UTF-8 cozulebiliyor.
    """
    head = data[:512]
    for prefix, mime in _MAGIC:
        if data.startswith(prefix):
            return mime
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"

    lowered = head.lstrip()[:64].lower()
    for prefix, _kind in _FORBIDDEN_MAGIC:
        if data.startswith(prefix) or lowered.startswith(prefix.lower()):
            return None

    if b"\x00" in head:
        return None
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        return None
    if declared == "text/plain" or declared is None:
        return "text/plain"
    return "text/plain"


def forbidden_kind(data: bytes) -> Optional[str]:
    lowered = data[:512].lstrip()[:64].lower()
    for prefix, kind in _FORBIDDEN_MAGIC:
        if data.startswith(prefix) or lowered.startswith(prefix.lower()):
            return kind
    return None


@dataclass(frozen=True)
class ContentVerdict:
    ok: bool
    detected_mime: Optional[str]
    reason: Optional[str] = None


def verify_content(
    data: bytes, *, declared_mime: Optional[str], file_name: str
) -> ContentVerdict:
    """Allowlist + sniff + uzanti tutarliligi.

    Uzanti/MIME uyusmazligi REDDEDILIR: `screenshot.png` adiyla yuklenen
    bir PDF, indirildiginde beklenmedik bir uygulamada acilir — MIME
    spoofing'in klasik bicimi.
    """
    if not data:
        return ContentVerdict(False, None, "empty_file")

    kind = forbidden_kind(data)
    if kind:
        return ContentVerdict(False, None, f"forbidden_{kind}")

    detected = detect_mime(data, declared_mime)
    if detected is None or detected not in ATTACHMENT_ALLOWED_MIME:
        return ContentVerdict(False, detected, "mime_not_allowed")

    if declared_mime and declared_mime != detected:
        # text/plain istisnasi: .log/.txt icin tarayicilar farkli
        # degerler beyan edebilir (text/x-log gibi). Icerik metin
        # oldugu surece sorun yok.
        if not (detected == "text/plain"
                and str(declared_mime).startswith("text/")):
            return ContentVerdict(False, detected, "mime_mismatch")

    suffix = ("." + file_name.rsplit(".", 1)[-1].lower()
              if "." in file_name else "")
    allowed_suffixes = ATTACHMENT_ALLOWED_MIME[detected]
    if suffix and suffix not in allowed_suffixes:
        return ContentVerdict(False, detected, "extension_mismatch")

    return ContentVerdict(True, detected, None)


# =============================================================================
# 2) Malware tarama
# =============================================================================

@dataclass(frozen=True)
class ScanResult:
    status: str          # clean | rejected | scan_failed
    engine: str
    error_code: Optional[str] = None
    duration_seconds: float = 0.0


class ClamAVScanner:
    """clamd INSTREAM istemcisi (saf stdlib socket).

    Protokol: `zINSTREAM\\0` → [4 bayt uzunluk + veri]* → 4 bayt sifir →
    yanit. Yanitta ` FOUND` gecerse dosya reddedilir.
    """

    CHUNK = 64 * 1024

    def __init__(self, host: str, port: int, timeout: float):
        self.host, self.port, self.timeout = host, port, timeout

    def scan(self, data: bytes) -> ScanResult:
        started = time.perf_counter()
        try:
            with socket.create_connection(
                (self.host, self.port), timeout=self.timeout
            ) as sock:
                sock.settimeout(self.timeout)
                sock.sendall(b"zINSTREAM\0")
                for offset in range(0, len(data), self.CHUNK):
                    chunk = data[offset:offset + self.CHUNK]
                    sock.sendall(struct.pack("!I", len(chunk)) + chunk)
                sock.sendall(struct.pack("!I", 0))
                response = b""
                while b"\0" not in response and len(response) < 4096:
                    part = sock.recv(4096)
                    if not part:
                        break
                    response += part
        except (OSError, socket.timeout) as exc:
            logger.error(
                "attachment scan failed class=%s", type(exc).__name__
            )
            return ScanResult(
                "scan_failed", "clamav", "scanner_unavailable",
                time.perf_counter() - started,
            )

        text = response.decode("utf-8", "replace").strip("\0 \n")
        duration = time.perf_counter() - started
        if text.endswith("OK"):
            return ScanResult("clean", "clamav", None, duration)
        if "FOUND" in text:
            # Imza ADI loglanmaz/donmez: dosya icerigine dair bilgi
            # sizdirmayan sabit bir kod yeterlidir.
            return ScanResult(
                "rejected", "clamav", "malware_detected", duration
            )
        return ScanResult(
            "scan_failed", "clamav", "scanner_error", duration
        )

    def healthy(self) -> bool:
        try:
            with socket.create_connection(
                (self.host, self.port), timeout=min(self.timeout, 5)
            ) as sock:
                sock.sendall(b"zPING\0")
                return b"PONG" in sock.recv(64)
        except OSError:
            return False


class DevNullScanner:
    """Tarama YAPMAZ — yalnizca dev deployment'i icin.

    Sonucu `clean` doner ama motor adi `none`dur: attachment kayitlarinda
    ve saglik ekraninda bunun taranmamis oldugu ACIKCA gorunur ve
    production readiness bu modda ASLA saglanmaz.
    """

    def scan(self, data: bytes) -> ScanResult:
        return ScanResult("clean", "none", "scan_skipped_dev", 0.0)

    def healthy(self) -> bool:
        return True


def get_scanner():
    settings = get_settings()
    mode = (settings.TICKET_SCANNER_MODE or MODE_CLAMAV).lower()
    if mode == MODE_DISABLED_DEV:
        return DevNullScanner()
    return ClamAVScanner(
        settings.TICKET_SCANNER_HOST,
        int(settings.TICKET_SCANNER_PORT),
        float(settings.TICKET_SCANNER_TIMEOUT_SECONDS),
    )


# =============================================================================
# 3) Uretim durusu kapisi
# =============================================================================

def production_posture_error() -> Optional[str]:
    """Attachment ozelligi UYGUN bicimde yapilandirilmis mi?

    `None` = uygun. Aksi halde donen kod, /ready ve saglik ekraninda
    gosterilir. Bu, "attachment acik gorunuyor ama aslinda taranmiyor"
    sinifindan sessiz bir yalani imkansiz kilar.
    """
    settings = get_settings()
    if not settings.TICKET_ATTACHMENTS_ENABLED:
        return None  # ozellik kapali; iddia da yok
    live = (settings.PUBLIC_API_ENV or "dev").lower() == "live"
    backend = (settings.TICKET_STORAGE_BACKEND or "local").lower()
    mode = (settings.TICKET_SCANNER_MODE or MODE_CLAMAV).lower()

    if live and backend != "s3":
        return "object_storage_required"
    if backend == "s3" and not (
        settings.TICKET_S3_ENDPOINT_URL
        and settings.TICKET_S3_BUCKET
        and settings.TICKET_S3_ACCESS_KEY_ID
        and settings.TICKET_S3_SECRET_ACCESS_KEY
    ):
        return "object_storage_incomplete"
    if live and mode != MODE_CLAMAV:
        return "malware_scanner_required"
    if mode == MODE_CLAMAV and not settings.TICKET_SCANNER_HOST:
        return "malware_scanner_incomplete"
    return None


def attachments_production_ready() -> Tuple[bool, Optional[str]]:
    """(hazir mi, neden degil). Dev'de yerel depo + tarayicisiz mod
    CALISIR ama `ready=False` doner — durustluk kurali."""
    settings = get_settings()
    if not settings.TICKET_ATTACHMENTS_ENABLED:
        return False, "feature_disabled"
    problem = production_posture_error()
    if problem:
        return False, problem
    if (settings.TICKET_STORAGE_BACKEND or "local").lower() != "s3":
        return False, "local_storage_not_production"
    if (settings.TICKET_SCANNER_MODE or "").lower() != MODE_CLAMAV:
        return False, "scanner_disabled"
    return True, None
