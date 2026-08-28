# =============================================================================
# HERMES — Ortak urun ticket platformu SOZLESMESI (v1, TEK KAYNAK)
# =============================================================================
# Kaynak: hermes-logislot-ticketing-cto-pack-v1.0/00_SHARED_PLATFORM/
#         04_API_AND_EVENT_CONTRACT.md (+ 02_DOMAIN_LIFECYCLE_AND_RULES.md)
#
# Hermes bu sozlesmenin PROVIDER tarafidir; LogiSlot ve gelecekteki
# uygulamalar CONSUMER'dir. Bu yuzden buradaki her sabit iki repoyu
# birden baglar:
#
#   - Bir enum degerini degistirmek = consumer'i kirmak.
#   - Bir event adini degistirmek = webhook inbox'ini kirmak.
#   - Bir error kodunu degistirmek = retry siniflandirmasini kirmak.
#
# Bu yuzden degerler BURADA, tek bir modulde yasar ve
# `docs/contracts/support-ticketing-v1/` altindaki DONMUS fixture'larla
# parite testine baglanir (tests/test_ticket_contract.py). Fixture ile
# kod ayrisirsa CI kirmizi olur — sessiz sozlesme kaymasi imkansizdir.
#
# Enum genisletme kurali (contract §13): v1 icinde YENI DEGER eklenebilir;
# consumer bilinmeyen degeri `unknown` UI fallback'iyle gosterir. Deger
# CIKARMAK veya YENIDEN ADLANDIRMAK breaking'dir ve v2 gerektirir.
# =============================================================================

from __future__ import annotations

CONTRACT_VERSION = "1.0"
API_VERSION = "v1"


# =============================================================================
# 1) Ticket alanlari
# =============================================================================

CATEGORIES = (
    "bug",
    "incident",
    "improvement",
    "question",
    "data_correction",
)

IMPACTS = (
    "single_user",
    "multiple_users",
    "tenant_blocked",
    "security_or_data_risk",
)

PRIORITIES = ("low", "normal", "high", "urgent")

# Requester yalnizca `impact` secer; internal priority triage kararidir.
# Tek KURAL: guvenlik/veri riski en az `high` baslar (02 §4).
IMPACT_MINIMUM_PRIORITY = {
    "single_user": "low",
    "multiple_users": "normal",
    "tenant_blocked": "high",
    "security_or_data_risk": "high",
}

# Requester secimi → varsayilan baslangic priority'si.
IMPACT_DEFAULT_PRIORITY = {
    "single_user": "low",
    "multiple_users": "normal",
    "tenant_blocked": "high",
    "security_or_data_risk": "high",
}

STATUSES = (
    "open",
    "in_progress",
    "waiting_customer",
    "resolved",
    "closed",
    "reopened",
    "cancelled",
)

# Musterinin "acik" saydigi durumlar (portal varsayilan sekmesi ve
# "acik ticket" sayaclari bunlari kullanir).
OPEN_STATUSES = ("open", "in_progress", "waiting_customer", "reopened")
TERMINAL_STATUSES = ("closed", "cancelled")

RESOLUTION_CODES = (
    "fixed",
    "workaround",
    "configuration",
    "not_reproducible",
    "duplicate",
    "wont_fix",
    "answered",
)

MESSAGE_VISIBILITY = ("public", "internal")
MESSAGE_FORMATS = ("plain", "markdown")

AUTHOR_TYPES = ("requester", "agent", "system", "integration")

# Audit aktor tipleri (01_HERMES/02 §8).
ACTOR_TYPES = (
    "tenant_user",
    "support_agent",
    "platform_admin",
    "integration_client",
    "system_job",
)

APPLICATION_STATUSES = ("active", "disabled")
SOURCE_TENANT_STATUSES = ("active", "suspended", "archived")
ENVIRONMENTS = ("dev", "live")


# =============================================================================
# 2) Alan uzunluklari / limitleri
# =============================================================================

# Minimumlar BILEREK 1'dir: bos gonderim reddedilir ama kullaniciya
# uzunluk dayatilmaz. "En az 8 karakter" gibi esikler gercek bir talebi
# (ornegin baslik "404") engelliyordu; kaliteyi form dogrulamasi degil
# destek ekibinin geri sorusu saglar.
TITLE_MIN_LENGTH = 1
TITLE_MAX_LENGTH = 160
DESCRIPTION_MIN_LENGTH = 1
DESCRIPTION_MAX_LENGTH = 10_000
MESSAGE_MIN_LENGTH = 1
MESSAGE_MAX_LENGTH = 10_000
RESOLUTION_SUMMARY_MIN_LENGTH = 1
RESOLUTION_SUMMARY_MAX_LENGTH = 10_000
REASON_MIN_LENGTH = 1
REASON_MAX_LENGTH = 1_000
SOURCE_ID_MAX_LENGTH = 128

# Attachment politikasi (01 §3 / 05 §5).
ATTACHMENT_MAX_FILES_PER_TICKET = 5
ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024
ATTACHMENT_TOTAL_MAX_BYTES = 50 * 1024 * 1024

# MIME allowlist — SVG/HTML/script/executable/archive BILEREK yok
# (stored XSS ve calistirilabilir icerik riski).
ATTACHMENT_ALLOWED_MIME = {
    "image/png": (".png",),
    "image/jpeg": (".jpg", ".jpeg"),
    "image/webp": (".webp",),
    "application/pdf": (".pdf",),
    "text/plain": (".txt", ".log"),
}

ATTACHMENT_SCAN_STATUSES = (
    "pending_scan",
    "clean",
    "rejected",
    "scan_failed",
)

ATTACHMENT_VISIBILITY = ("public", "internal")


# =============================================================================
# 3) Client context allowlist (veri minimizasyonu — 05 §4)
# =============================================================================
# Bu ANAHTARLAR DISINDA hicbir sey saklanmaz. Cookie, Authorization,
# JWT, form degeri, query string, localStorage ASLA. Liste bir
# ALLOWLIST'tir: bilinmeyen anahtar sessizce DUSURULUR (reddetmek yerine
# dusurmek, ileri uyumlulugu korur — yeni bir client fazladan alan
# gonderirse ticket yine acilir).
CLIENT_CONTEXT_ALLOWED_KEYS = (
    "app_version",
    "environment",
    "page_path",
    "browser",
    "os",
    "device_class",
    "locale",
    "timezone",
    "client_timestamp",
)
CLIENT_CONTEXT_MAX_VALUE_LENGTH = 200

# Diagnostics icinde ASLA bulunmamasi gereken desenler — deger yine de
# gelirse redaksiyon uygulanir (savunma derinligi; asil onlem allowlist).
CLIENT_CONTEXT_FORBIDDEN_SUBSTRINGS = (
    "authorization",
    "cookie",
    "bearer ",
    "password",
    "secret",
    "token",
)


# =============================================================================
# 4) Event sozlesmesi
# =============================================================================

EVENT_TICKET_CREATED = "ticket.created.v1"
EVENT_TICKET_STATUS_CHANGED = "ticket.status_changed.v1"
EVENT_TICKET_PUBLIC_MESSAGE_ADDED = "ticket.public_message_added.v1"
EVENT_TICKET_ASSIGNMENT_CHANGED = "ticket.assignment_changed.v1"
EVENT_TICKET_RESOLVED = "ticket.resolved.v1"
EVENT_TICKET_REOPENED = "ticket.reopened.v1"
EVENT_TICKET_CLOSED = "ticket.closed.v1"
EVENT_TICKET_ATTACHMENT_READY = "ticket.attachment_ready.v1"

# Source uygulamaya GIDEN eventler. Bu demet KAPALIDIR: burada olmayan
# hicbir domain olayi webhook'a cikamaz (internal note dahil — bkz.
# INTERNAL_ONLY_EVENTS).
OUTBOUND_EVENT_TYPES = (
    EVENT_TICKET_CREATED,
    EVENT_TICKET_STATUS_CHANGED,
    EVENT_TICKET_PUBLIC_MESSAGE_ADDED,
    EVENT_TICKET_ASSIGNMENT_CHANGED,
    EVENT_TICKET_RESOLVED,
    EVENT_TICKET_REOPENED,
    EVENT_TICKET_CLOSED,
    EVENT_TICKET_ATTACHMENT_READY,
)

# Yalnizca Hermes icinde yasayan audit olaylari. Bunlar `ticket_events`
# tablosuna yazilir ama outbox'a ASLA girmez (04 §10: "Internal note
# olayi source app webhookuna cikmaz").
EVENT_INTERNAL_NOTE_ADDED = "ticket.internal_note_added.v1"
EVENT_TICKET_ADMIN_ACCESSED = "ticket.admin_accessed.v1"
EVENT_TICKET_PRIORITY_CHANGED = "ticket.priority_changed.v1"
EVENT_TICKET_ATTACHMENT_SCANNED = "ticket.attachment_scanned.v1"
EVENT_TICKET_ATTACHMENT_DOWNLOADED = "ticket.attachment_downloaded.v1"
EVENT_TICKET_DELIVERY_REPLAYED = "ticket.delivery_replayed.v1"

INTERNAL_ONLY_EVENTS = (
    EVENT_INTERNAL_NOTE_ADDED,
    EVENT_TICKET_ADMIN_ACCESSED,
    EVENT_TICKET_PRIORITY_CHANGED,
    EVENT_TICKET_ATTACHMENT_SCANNED,
    EVENT_TICKET_ATTACHMENT_DOWNLOADED,
    EVENT_TICKET_DELIVERY_REPLAYED,
)

ALL_EVENT_TYPES = OUTBOUND_EVENT_TYPES + INTERNAL_ONLY_EVENTS

# Webhook basliklari (04 §2/§11).
HEADER_EVENT_ID = "X-Hermes-Event-Id"
HEADER_TIMESTAMP = "X-Hermes-Timestamp"
HEADER_SIGNATURE = "X-Hermes-Signature"
HEADER_KEY_ID = "X-Hermes-Key-Id"
HEADER_CORRELATION_ID = "X-Correlation-Id"
HEADER_IDEMPOTENCY_KEY = "Idempotency-Key"

# Imza: HMAC-SHA256, kanonik imzalanan baytlar `<timestamp>.<raw_body>`,
# cikti KUCUK HARF HEX (prefixsiz), 5 dakikalik pencere.
SIGNATURE_ALGORITHM = "HMAC-SHA256"
SIGNATURE_TEMPLATE = "{timestamp}.{body}"
SIGNATURE_MAX_SKEW_SECONDS = 300


# =============================================================================
# 5) Hata kodu katalogu
# =============================================================================
# Contract §12'nin "onemli kodlar" listesi TAMAMEN burada; yani ile
# istemcinin ayirt etmesi gereken genel kodlar. `retryable` alani
# consumer'in retry siniflandirmasini BELIRLER (06 §2) — bu yuzden
# HTTP statusuyla birlikte sozlesmenin parcasidir.
#
# (code, http_status, retryable)
ERROR_CATALOG = {
    # --- sozlesmede acikca adi gecenler ---
    "route_missing": (409, False),
    "route_stale": (409, False),
    "group_inactive": (409, False),
    "source_tenant_unknown": (404, False),
    "idempotency_conflict": (409, False),
    "attachment_not_ready": (409, False),
    "ticket_version_conflict": (409, False),
    "forbidden": (403, False),
    "rate_limited": (429, True),
    "integration_unavailable": (503, True),
    # --- genel yuzey kodlari ---
    "invalid_request": (400, False),
    "validation_error": (422, False),
    "unauthorized": (401, False),
    "insufficient_scope": (403, False),
    "not_found": (404, False),
    "conflict": (409, False),
    "idempotency_request_in_progress": (409, True),
    "invalid_state_transition": (409, False),
    "support_not_configured": (503, True),
    "internal_error": (500, True),
}

ERROR_MESSAGES = {
    "route_missing": "Ticket routing has not been configured for this "
                     "workspace.",
    "route_stale": "Ticket routing configuration must be refreshed.",
    "group_inactive": "The target support group is no longer active.",
    "source_tenant_unknown": "This source workspace is not mapped for "
                             "the application.",
    "idempotency_conflict": "This Idempotency-Key was already used with "
                            "a different payload.",
    "attachment_not_ready": "One or more attachments are not ready to "
                            "be attached.",
    "ticket_version_conflict": "The ticket changed since it was loaded.",
    "forbidden": "This operation is not allowed.",
    "rate_limited": "Too many requests; honour Retry-After.",
    "integration_unavailable": "The support integration is temporarily "
                               "unavailable.",
    "invalid_request": "Malformed request.",
    "validation_error": "Request failed validation.",
    "unauthorized": "Missing, malformed or unknown credential.",
    "insufficient_scope": "The credential lacks a required scope.",
    "not_found": "Resource does not exist or is out of scope.",
    "conflict": "Request conflicts with existing state.",
    "idempotency_request_in_progress": "Another request with the same "
                                       "Idempotency-Key is still being "
                                       "processed; safe to retry.",
    "invalid_state_transition": "This status change is not allowed from "
                                "the ticket's current state.",
    "support_not_configured": "The support module is not configured on "
                              "this deployment.",
    "internal_error": "An internal error occurred.",
}


def error_status(code: str) -> int:
    return ERROR_CATALOG.get(code, ERROR_CATALOG["internal_error"])[0]


def error_retryable(code: str) -> bool:
    return ERROR_CATALOG.get(code, ERROR_CATALOG["internal_error"])[1]


def error_message(code: str) -> str:
    return ERROR_MESSAGES.get(code, ERROR_MESSAGES["internal_error"])


# =============================================================================
# 6) Integration scope'lari
# =============================================================================
# Public API scope uzayindan (tasks:read vb.) AYRI tutulur: bir Hermes
# admini API Management ekranindan yanlislikla `support:tickets:write`
# veremesin. Bu scope'lar YALNIZCA support integration client'larinda
# yasar (support_integration_clients).
SUPPORT_SCOPES = {
    "support:groups:read": (
        "Read the Duosis support routing group catalog (names and "
        "active member counts only — never member identities)."
    ),
    "support:tickets:read": (
        "Read customer-visible snapshots of tickets that belong to the "
        "application's own source tenants."
    ),
    "support:tickets:write": (
        "Create tickets and submit customer commands (reply, reopen, "
        "confirm-close, cancel) for the application's own source "
        "tenants."
    ),
    "support:attachments:write": (
        "Open attachment upload sessions and upload attachment content."
    ),
}


# =============================================================================
# 7) Teslimat / retry politikasi (06 §2)
# =============================================================================
# Backoff basamaklari SANIYE cinsindendir; son basamaktan sonrasi son
# basamakta kalir. Jitter dispatcher'da uygulanir (thundering herd).
RETRY_BACKOFF_SECONDS = (10, 30, 120, 600, 1800, 7200)
MAX_DELIVERY_ATTEMPTS = 10
DEAD_LETTER_AFTER_SECONDS = 24 * 3600

# HTTP siniflarina gore retry karari.
RETRYABLE_HTTP_STATUSES = frozenset({408, 425, 429, 500, 502, 503, 504})

DELIVERY_STATUSES = ("pending", "in_flight", "delivered", "dead")


def next_backoff_seconds(attempts: int) -> int:
    """`attempts` = simdiye kadar YAPILMIS deneme sayisi."""
    if attempts <= 0:
        return RETRY_BACKOFF_SECONDS[0]
    index = min(attempts - 1, len(RETRY_BACKOFF_SECONDS) - 1)
    return RETRY_BACKOFF_SECONDS[index]


def is_retryable_status(status_code: int | None) -> bool:
    if status_code is None:      # ag hatasi / timeout
        return True
    if status_code in RETRYABLE_HTTP_STATUSES:
        return True
    return status_code >= 500


# =============================================================================
# 8) Ticket numarasi
# =============================================================================
TICKET_NUMBER_PREFIX = "TKT-"
TICKET_NUMBER_PAD = 6
TICKET_COUNTER_KEY = "support_ticket"


def format_ticket_number(number: int) -> str:
    """`TKT-000123`. 6 haneyi asan numaralar KIRPILMAZ, uzar."""
    return f"{TICKET_NUMBER_PREFIX}{int(number):0{TICKET_NUMBER_PAD}d}"


# =============================================================================
# 9) Sozlesme anlik goruntusu (fixture parite testi icin)
# =============================================================================

def contract_snapshot() -> dict:
    """Iki repoda karsilastirilabilir DETERMINISTIK sozlesme anligi.

    `docs/contracts/support-ticketing-v1/contract.json` bunun donmus
    kopyasidir; test ikisini karsilastirir. LogiSlot ayni dosyayi kendi
    reposuna kopyalar ve kendi consumer testinde ayni karsilastirmayi
    yapar (cross-repo package altyapisi olmadigi icin: kontrollu
    duplicate fixture + parite testi — WS0 karari).
    """
    return {
        "contract_version": CONTRACT_VERSION,
        "api_version": API_VERSION,
        "enums": {
            "category": list(CATEGORIES),
            "impact": list(IMPACTS),
            "priority": list(PRIORITIES),
            "status": list(STATUSES),
            "resolution_code": list(RESOLUTION_CODES),
            "message_visibility": list(MESSAGE_VISIBILITY),
            "author_type": list(AUTHOR_TYPES),
            "actor_type": list(ACTOR_TYPES),
            "attachment_scan_status": list(ATTACHMENT_SCAN_STATUSES),
            "application_status": list(APPLICATION_STATUSES),
            "source_tenant_status": list(SOURCE_TENANT_STATUSES),
            "environment": list(ENVIRONMENTS),
            "delivery_status": list(DELIVERY_STATUSES),
        },
        "events": {
            "outbound": list(OUTBOUND_EVENT_TYPES),
            "internal_only": list(INTERNAL_ONLY_EVENTS),
        },
        "errors": {
            code: {"http_status": status, "retryable": retryable}
            for code, (status, retryable) in sorted(ERROR_CATALOG.items())
        },
        "scopes": dict(sorted(SUPPORT_SCOPES.items())),
        "limits": {
            "title_min": TITLE_MIN_LENGTH,
            "title_max": TITLE_MAX_LENGTH,
            "description_min": DESCRIPTION_MIN_LENGTH,
            "description_max": DESCRIPTION_MAX_LENGTH,
            "message_max": MESSAGE_MAX_LENGTH,
            "resolution_summary_min": RESOLUTION_SUMMARY_MIN_LENGTH,
            "resolution_summary_max": RESOLUTION_SUMMARY_MAX_LENGTH,
            "attachment_max_files": ATTACHMENT_MAX_FILES_PER_TICKET,
            "attachment_max_bytes": ATTACHMENT_MAX_BYTES,
            "attachment_total_max_bytes": ATTACHMENT_TOTAL_MAX_BYTES,
            "attachment_allowed_mime": sorted(ATTACHMENT_ALLOWED_MIME),
        },
        "signature": {
            "algorithm": SIGNATURE_ALGORITHM,
            "signed_bytes_template": SIGNATURE_TEMPLATE,
            "encoding": "lowercase-hex",
            "max_skew_seconds": SIGNATURE_MAX_SKEW_SECONDS,
            "headers": {
                "event_id": HEADER_EVENT_ID,
                "timestamp": HEADER_TIMESTAMP,
                "signature": HEADER_SIGNATURE,
                "key_id": HEADER_KEY_ID,
            },
        },
        "delivery": {
            "backoff_seconds": list(RETRY_BACKOFF_SECONDS),
            "max_attempts": MAX_DELIVERY_ATTEMPTS,
            "dead_letter_after_seconds": DEAD_LETTER_AFTER_SECONDS,
        },
        "client_context_allowed_keys": list(CLIENT_CONTEXT_ALLOWED_KEYS),
        "ticket_number": {
            "prefix": TICKET_NUMBER_PREFIX,
            "pad": TICKET_NUMBER_PAD,
        },
    }
