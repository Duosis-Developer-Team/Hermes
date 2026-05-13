# =============================================================================
# HERMES - Microsoft Graph client
# =============================================================================
# Thin app-only client for the Meetings module. Just enough surface to
# pull calendar events for a date range via the `calendarView` endpoint
# (which pre-expands recurring instances — no client-side rrule parsing
# required).
#
# Design rules:
#   - Initialisation is lazy. Importing this module must never raise.
#     If Azure tenant/client/secret aren't all set, the client refuses
#     to authenticate and surfaces a structured "not configured"
#     GraphConfigError instead of crashing app startup.
#   - Bearer tokens are cached in-process with a small safety margin
#     so a single sync run doesn't hammer the token endpoint.
#   - Logs name the operation + result counts only. We never log
#     bearer tokens, the raw client secret, or full HTTP responses.
# =============================================================================

import asyncio
import logging
import time
from typing import AsyncIterator, Optional

import httpx

from ..config import get_settings

logger = logging.getLogger(__name__)

# Refresh ~60s before actual expiry — leaves room for clock skew and a
# long-running sync run that started near the boundary.
_TOKEN_REFRESH_LEEWAY_SECONDS = 60


class GraphConfigError(RuntimeError):
    """Raised by the Graph client when required configuration is
    missing or admin consent has not been granted. The Meetings sync
    endpoint converts this into a clean 400-class API response."""


class GraphRequestError(RuntimeError):
    """Wraps non-2xx responses from Microsoft Graph with the upstream
    HTTP status + a short message. Bearer tokens never appear in
    these errors."""

    def __init__(self, status_code: int, message: str):
        super().__init__(f"Graph {status_code}: {message}")
        self.status_code = status_code
        self.message = message


class MicrosoftGraphClient:
    """App-only Microsoft Graph client.

    Single instance per process — the bearer token cache is on the
    instance so repeated calls during one sync reuse it.
    """

    def __init__(self) -> None:
        settings = get_settings()
        self._tenant_id = (settings.AZURE_TENANT_ID or "").strip()
        self._client_id = (settings.AZURE_CLIENT_ID or "").strip()
        self._client_secret = (settings.AZURE_CLIENT_SECRET or "").strip()
        self._authority = settings.GRAPH_AUTHORITY.rstrip("/")
        self._scope = settings.GRAPH_SCOPE
        self._base_url = settings.GRAPH_BASE_URL.rstrip("/")
        self._token: Optional[str] = None
        self._token_expires_at: float = 0.0
        self._lock = asyncio.Lock()

    # --------------------------------------------------------------
    # Configuration
    # --------------------------------------------------------------

    @property
    def is_configured(self) -> bool:
        return bool(self._tenant_id and self._client_id and self._client_secret)

    def _ensure_configured(self) -> None:
        if not self.is_configured:
            raise GraphConfigError(
                "Microsoft Graph is not configured. "
                "AZURE_TENANT_ID, AZURE_CLIENT_ID and AZURE_CLIENT_SECRET "
                "must all be set on the core-service deployment."
            )

    # --------------------------------------------------------------
    # Auth — app-only client credentials
    # --------------------------------------------------------------

    async def _get_token(self) -> str:
        self._ensure_configured()
        now = time.time()
        if self._token and now < self._token_expires_at:
            return self._token

        async with self._lock:
            # Double-check after acquiring the lock so concurrent
            # callers don't all stampede the token endpoint.
            now = time.time()
            if self._token and now < self._token_expires_at:
                return self._token

            url = f"{self._authority}/{self._tenant_id}/oauth2/v2.0/token"
            data = {
                "grant_type": "client_credentials",
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "scope": self._scope,
            }
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(url, data=data)
            if resp.status_code != 200:
                # Common cases:
                #   - 401 invalid_client → secret rotated / typo
                #   - 400 unauthorized_client → app not granted
                #     admin consent for the required application
                #     permission
                # Bubble up a clean message; never include the secret.
                detail = _short_text(resp.text)
                logger.warning(
                    "Graph token request failed status=%s detail=%s",
                    resp.status_code,
                    detail,
                )
                raise GraphRequestError(resp.status_code, detail)

            payload = resp.json()
            self._token = payload["access_token"]
            expires_in = int(payload.get("expires_in", 3600))
            self._token_expires_at = (
                time.time() + max(60, expires_in - _TOKEN_REFRESH_LEEWAY_SECONDS)
            )
            logger.info(
                "Graph token acquired, valid for %ss", expires_in
            )
            return self._token

    # --------------------------------------------------------------
    # Calendar view
    # --------------------------------------------------------------

    async def iter_calendar_view(
        self,
        *,
        user_email: str,
        start_iso: str,
        end_iso: str,
        page_size: int = 100,
    ) -> AsyncIterator[dict]:
        """Yield expanded calendar events for `user_email` between
        start_iso and end_iso (ISO 8601 strings, UTC). Recurring
        series are expanded server-side — every yielded dict is a
        concrete instance with its own id.

        Follows @odata.nextLink pagination silently.
        """
        self._ensure_configured()
        token = await self._get_token()

        # Carefully selected fields — keep the payload small, never
        # ask for body content. bodyPreview is short and safe.
        select = ",".join(
            [
                "id",
                "subject",
                "bodyPreview",
                "sensitivity",
                "start",
                "end",
                "originalStartTimeZone",
                "isOnlineMeeting",
                "onlineMeetingUrl",
                "onlineMeeting",
                "isCancelled",
                "organizer",
                "attendees",
                "lastModifiedDateTime",
            ]
        )
        params = {
            "startDateTime": start_iso,
            "endDateTime": end_iso,
            "$select": select,
            "$top": str(page_size),
            "$orderby": "start/dateTime",
        }
        url = f"{self._base_url}/users/{user_email}/calendarView"

        headers = {
            "Authorization": f"Bearer {token}",
            # Force UTC so we never have to parse a per-user
            # timezone string on the wire — DB still stores
            # timestamptz, frontend renders local.
            "Prefer": 'outlook.timezone="UTC"',
        }
        timeout = httpx.Timeout(60.0, connect=15.0)

        async with httpx.AsyncClient(timeout=timeout) as client:
            while url:
                resp = await client.get(url, params=params, headers=headers)
                if resp.status_code == 401:
                    # Token expired mid-iteration; refresh once and
                    # retry. Avoids a stale-token failure tanking a
                    # long sync run.
                    self._token = None
                    self._token_expires_at = 0.0
                    token = await self._get_token()
                    headers["Authorization"] = f"Bearer {token}"
                    resp = await client.get(url, params=params, headers=headers)

                if resp.status_code != 200:
                    detail = _short_text(resp.text)
                    logger.warning(
                        "Graph calendarView failed user=%s status=%s detail=%s",
                        _mask_email(user_email),
                        resp.status_code,
                        detail,
                    )
                    raise GraphRequestError(resp.status_code, detail)

                data = resp.json()
                for event in data.get("value", []):
                    yield event

                # Page through @odata.nextLink. The next URL is
                # absolute and already includes all params; clear
                # the local `params` so httpx doesn't double-append.
                url = data.get("@odata.nextLink")
                params = None


# --------------------------------------------------------------
# Module singleton
# --------------------------------------------------------------

_singleton: Optional[MicrosoftGraphClient] = None


def get_graph_client() -> MicrosoftGraphClient:
    """Returns the process-wide Graph client. Always succeeds —
    the actual config check is deferred until a network call is
    attempted, so importing this module never raises."""
    global _singleton
    if _singleton is None:
        _singleton = MicrosoftGraphClient()
    return _singleton


# --------------------------------------------------------------
# Helpers
# --------------------------------------------------------------

def _short_text(text: str, limit: int = 240) -> str:
    """Trim upstream error bodies so logs stay readable and bearer
    tokens / secrets are unlikely to leak."""
    if not text:
        return ""
    cleaned = " ".join(text.split())
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[:limit] + "…"


def _mask_email(email: str) -> str:
    """Redact the local part of an email in logs so a tail of /var/log
    doesn't leak personally identifiable information."""
    if not email or "@" not in email:
        return "***"
    local, domain = email.split("@", 1)
    if len(local) <= 2:
        masked = local[:1] + "*"
    else:
        masked = local[0] + "***" + local[-1]
    return f"{masked}@{domain}"
