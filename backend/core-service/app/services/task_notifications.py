# =============================================================================
# HERMES - Task assignment e-mail notifications
# =============================================================================
# When a task is created (single or group fan-out) the assignee is e-mailed
# "you were assigned a task", and — when enabled — the assigner is e-mailed
# "you assigned a task to X". Delivery uses the existing Microsoft Graph
# app client (graph_service); no separate mailbox password is needed.
#
# Design rules:
#   - NEVER raise into the caller. These run inside FastAPI BackgroundTasks
#     after the response is sent; any failure (Graph down, e-mail typo,
#     notifications disabled) is logged and swallowed. Task creation has
#     already succeeded by the time we run.
#   - All user-supplied strings (titles, names, customer/project) are
#     HTML-escaped before they touch the template.
#   - Recipient e-mails are resolved from auth-service /users/lookup using
#     the assigner's bearer token, captured at request time.
# =============================================================================

import base64
import html
import logging
import os
from typing import Dict, List, Optional, Sequence
from urllib.parse import quote, urlparse

import httpx

from ..config import get_settings
from .auth_upstream import auth_service_base_url
from .graph_service import (
    GraphConfigError,
    GraphRequestError,
    get_graph_client,
)

logger = logging.getLogger(__name__)

_PRIORITY_LABELS = {
    "low": "Low",
    "medium": "Medium",
    "high": "High",
    "urgent": "Urgent",
}
_PRIORITY_COLORS = {
    "low": "#6b7280",
    "medium": "#3b82f6",
    "high": "#d97706",
    "urgent": "#dc2626",
}

# --------------------------------------------------------------
# Branding — Hermes dark-mode e-mail palette + inline logo
# --------------------------------------------------------------
# Mirrors the app's dark theme tokens so the e-mail reads as a first-class
# Hermes surface rather than a generic notification.
_BG = "#15181b"            # outer e-mail background
_CARD = "#1a1d21"          # main container surface
_HEADER = "#1e2227"        # header band (holds the logo)
_SURFACE = "#202327"       # inner work-item card
_SURFACE_DEEP = "#16191c"  # description block / footer
_BORDER = "#2c3137"        # card borders
_BORDER_SOFT = "#262b30"   # container hairline
_TEXT = "#e6e8ea"          # body text
_TEXT_STRONG = "#ffffff"   # headings
_TEXT_MUTED = "#9498a0"    # labels / muted
_TEXT_FAINT = "#6b7280"    # footer
_BLUE = "#388bff"          # brand accent
_BLUE_LT = "#579dff"       # brand accent (lighter, for the code chip)

# The logo is a white wordmark on transparent — embedded once per message as
# an inline (cid) attachment so it survives every mail client. Loaded once at
# import; a missing file degrades to a text wordmark, never an error.
_LOGO_CID = "hermes-logo"
_LOGO_PATH = os.path.join(os.path.dirname(__file__), "..", "assets", "hermes-logo.png")


def _load_logo_b64() -> Optional[str]:
    try:
        with open(_LOGO_PATH, "rb") as fh:
            return base64.b64encode(fh.read()).decode("ascii")
    except Exception as exc:  # noqa: BLE001 — branding is best-effort
        logger.warning("hermes e-mail logo not loaded: %s", exc)
        return None


_LOGO_B64 = _load_logo_b64()


def _logo_inline_images() -> Optional[List[dict]]:
    """Inline-attachment payload for the logo, or None when unavailable."""
    if not _LOGO_B64:
        return None
    return [
        {
            "content_id": _LOGO_CID,
            "content_b64": _LOGO_B64,
            "content_type": "image/png",
            "name": "hermes-logo.png",
        }
    ]


def _logo_img_html() -> str:
    if _LOGO_B64:
        return (
            '<img src="cid:' + _LOGO_CID + '" alt="HERMES" width="158" '
            'style="display:block;border:0;outline:none;text-decoration:none;'
            'height:auto;max-width:158px;">'
        )
    # Fallback wordmark if the asset is missing at runtime.
    return (
        '<div style="color:#ffffff;font-size:18px;font-weight:800;'
        'letter-spacing:0.16em;">HERMES</div>'
    )


# --------------------------------------------------------------
# E-mail resolution (auth-service)
# --------------------------------------------------------------

async def _resolve_users(
    token: str, ids: Sequence[str],
    *,
    tenant_id,
) -> Dict[str, dict]:
    """Return {user_id: {email, full_name}} for the given ids via
    auth-service /users/lookup. Returns {} on any failure — callers
    treat a missing e-mail as "skip that recipient"."""
    unique = [str(i) for i in {str(x) for x in ids} if i]
    if not unique:
        return {}

    # Stage 5B-2: S2S directory credential'i varsa alici cozumu ARTIK
    # cagiran JWT'sine bagli degildir — API-token kaynakli olaylar da
    # e-posta alicilarini cozebilir (parity). Basarisizlik fail-safe:
    # {} doner, bildirim domain kayitlari ASLA geri alinmaz.
    from ..config import get_settings as _gs

    s2s = _gs().HERMES_S2S_TOKEN_CURRENT
    if s2s:
        url = f"{auth_service_base_url()}/internal/directory/users/resolve"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    url,
                    # WS7: alici cozumu TENANT ile sinirlidir. Bu filtre
                    # olmasaydi, bir hata sonucu baska bir organizasyonun
                    # calisanina e-posta gidebilirdi.
                    json={"tenant_id": str(tenant_id),
                          "user_ids": unique},
                    headers={"Authorization": f"Bearer {s2s}"},
                )
            if resp.status_code == 200:
                out: Dict[str, dict] = {}
                for u in resp.json().get("users") or []:
                    out[str(u["id"])] = {
                        "email": u.get("work_email"),
                        "full_name": u.get("display_name")
                        or u.get("work_email")
                        or "",
                    }
                return out
            logger.warning(
                "notif s2s lookup failed status=%s", resp.status_code
            )
            return {}
        except Exception as exc:  # noqa: BLE001 — asla cagirani bozma
            logger.warning(
                "notif s2s lookup error class=%s", type(exc).__name__
            )
            return {}

    # Geriye donuk yol: S2S yapilandirilmamissa cagiran JWT'siyle eski
    # lookup (API-token akislarinda token bos → e-posta no-op, bilinen
    # eski sinirlama).
    if not token:
        print(
            f"[notif] lookup skipped ids={len(unique)} token=no",
            flush=True,
        )
        return {}
    url = f"{auth_service_base_url()}/api/v1/auth/users/lookup"
    # token is the RAW JWT (no prefix); auth-service reads a bearer header.
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                url, params={"ids": unique}, headers=headers
            )
        if resp.status_code != 200:
            print(
                f"[notif] lookup HTTP {resp.status_code} url={url}",
                flush=True,
            )
            logger.warning(
                "notif user lookup failed status=%s", resp.status_code
            )
            return {}
        out: Dict[str, dict] = {}
        for u in resp.json() or []:
            uid = str(u.get("id", ""))
            if uid:
                out[uid] = {
                    "email": u.get("email"),
                    "full_name": u.get("full_name") or u.get("email") or "",
                }
        return out
    except Exception as exc:  # noqa: BLE001 — never break the caller
        print(f"[notif] lookup ERROR: {exc!r}", flush=True)
        logger.warning("notif user lookup error: %s", exc)
        return {}


# --------------------------------------------------------------
# HTML template
# --------------------------------------------------------------

def _esc(value: Optional[str]) -> str:
    return html.escape(str(value)) if value not in (None, "") else ""


def _detail_row(label: str, value: Optional[str]) -> str:
    if not value:
        return ""
    return (
        '<tr>'
        '<td style="padding:5px 0;color:' + _TEXT_MUTED + ';font-size:13px;'
        'width:120px;vertical-align:top;">' + _esc(label) + '</td>'
        '<td style="padding:5px 0;color:' + _TEXT + ';font-size:13px;'
        'font-weight:600;">' + _esc(value) + '</td>'
        '</tr>'
    )


def _task_card_html(task: dict) -> str:
    code = _esc(task.get("task_code") or "")
    title = _esc(task.get("title") or "Task")
    priority = (task.get("priority") or "medium").lower()
    p_label = _PRIORITY_LABELS.get(priority, priority)
    p_color = _PRIORITY_COLORS.get(priority, _BLUE)

    customer = task.get("customer_name")
    project = task.get("project_name")
    sub_project = task.get("sub_project_name")
    scope = " · ".join([s for s in [customer, project, sub_project] if s])

    description = task.get("description")
    desc_block = ""
    if description:
        desc_block = (
            '<div style="margin-top:14px;padding:12px 14px;background:'
            + _SURFACE_DEEP + ';border:1px solid ' + _BORDER + ';'
            'border-radius:8px;color:' + _TEXT + ';font-size:13px;'
            'line-height:1.6;white-space:pre-wrap;">'
            + _esc(description)
            + '</div>'
        )

    rows = "".join(
        [
            _detail_row("Scope", scope or None),
            _detail_row("Scheduled", task.get("scheduled_date")),
            _detail_row("Due date", task.get("due_date")),
        ]
    )

    code_html = (
        '<span style="font-size:12px;font-weight:700;color:' + _BLUE_LT + ';'
        'letter-spacing:0.04em;">' + code + '</span>'
        if code
        else "&nbsp;"
    )
    badge_html = (
        '<span style="display:inline-block;font-size:11px;font-weight:700;'
        'color:#ffffff;background:' + p_color + ';padding:3px 11px;'
        'border-radius:999px;">' + _esc(p_label) + '</span>'
    )

    # Table-based header (code left / priority right) so it aligns in Outlook
    # too — flexbox + margin-left:auto don't render there.
    header = (
        '<table width="100%" cellpadding="0" cellspacing="0" role="presentation" '
        'style="margin-bottom:10px;"><tr>'
        '<td align="left" style="vertical-align:middle;">' + code_html + '</td>'
        '<td align="right" style="vertical-align:middle;">' + badge_html + '</td>'
        '</tr></table>'
    )

    return (
        '<table width="100%" cellpadding="0" cellspacing="0" role="presentation" '
        'style="background:' + _SURFACE + ';border:1px solid ' + _BORDER + ';'
        'border-radius:12px;"><tr><td style="padding:18px 20px;">'
        + header
        + '<div style="font-size:17px;font-weight:700;color:' + _TEXT_STRONG + ';'
        'line-height:1.35;margin-bottom:12px;">' + title + '</div>'
        '<table width="100%" cellpadding="0" cellspacing="0" role="presentation" '
        'style="border-collapse:collapse;">' + rows + '</table>'
        + desc_block
        + '</td></tr></table>'
    )


def _cta_button(task: dict, app_base_url: str) -> str:
    base = (app_base_url or "").rstrip("/")
    if not base:
        return ""
    # Defense-in-depth: APP_BASE_URL is admin-controlled, but only allow a
    # real http(s) URL into the e-mail link (reject javascript:/data: etc.).
    try:
        parsed = urlparse(base)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            return ""
    except Exception:  # noqa: BLE001
        return ""
    ttype = _ttype(task)
    plural = _TYPE_PLURAL.get(ttype, "tasks")
    item_id = task.get("id")
    # Deep link straight to the item; the Project Management page opens it on
    # arrival. The type lives in the path (/project-management/issues).
    if item_id:
        link = (
            f"{base}/project-management/{plural}"
            f"?item={quote(str(item_id))}"
        )
    else:
        link = f"{base}/project-management/{plural}"
    label = "View " + _TYPE_NOUN[ttype]
    return (
        '<table width="100%" cellpadding="0" cellspacing="0" role="presentation" '
        'style="margin:24px 0 4px;"><tr><td align="center">'
        '<a href="' + _esc(link) + '" '
        'style="display:inline-block;background:' + _BLUE + ';color:#ffffff;'
        'text-decoration:none;font-weight:600;font-size:14px;'
        'padding:12px 30px;border-radius:10px;">' + _esc(label) + '</a>'
        '</td></tr></table>'
    )


def _shell(
    title_line: str,
    intro_html: str,
    body_html: str,
    app_base_url: str,
    task: Optional[dict] = None,
) -> str:
    """Wrap content in the branded Hermes dark-mode e-mail shell.

    Table-based + fully inline-styled so it renders consistently across mail
    clients (Outlook included). The logo is referenced as a cid: inline image
    embedded by the sender (see _logo_inline_images). `task` drives the CTA's
    type-aware label + deep link."""
    return (
        '<div style="margin:0;padding:0;background:' + _BG + ';">'
        '<table width="100%" cellpadding="0" cellspacing="0" role="presentation" '
        'style="background:' + _BG + ';font-family:-apple-system,Segoe UI,'
        'Roboto,Helvetica,Arial,sans-serif;"><tr>'
        '<td align="center" style="padding:28px 16px;">'
        '<table width="600" cellpadding="0" cellspacing="0" role="presentation" '
        'style="width:600px;max-width:600px;background:' + _CARD + ';'
        'border:1px solid ' + _BORDER_SOFT + ';border-radius:16px;'
        'overflow:hidden;">'
        # Top accent bar — brand gradient (solid blue fallback for Outlook)
        '<tr><td style="height:4px;line-height:4px;font-size:0;'
        'background:#388bff;'
        'background:linear-gradient(90deg,#388bff 0%,#6366f1 55%,#7c5cff 100%);'
        '">&nbsp;</td></tr>'
        # Header band — logo top-left + the headline beneath it
        '<tr><td style="background:' + _HEADER + ';padding:24px 28px 22px;'
        'border-bottom:1px solid ' + _BORDER_SOFT + ';">'
        + _logo_img_html()
        + '<div style="color:' + _TEXT_STRONG + ';font-size:19px;'
        'font-weight:700;margin-top:18px;line-height:1.3;">'
        + _esc(title_line) + '</div>'
        '</td></tr>'
        # Body
        '<tr><td style="background:' + _CARD + ';padding:26px 28px 28px;">'
        + intro_html
        + body_html
        + _cta_button(task or {}, app_base_url)
        + '</td></tr>'
        # Footer
        '<tr><td style="padding:18px 28px;background:' + _SURFACE_DEEP + ';'
        'border-top:1px solid ' + _BORDER_SOFT + ';color:' + _TEXT_FAINT + ';'
        'font-size:12px;text-align:center;">'
        'This is an automated notification · Hermes Project Management'
        '</td></tr>'
        '</table></td></tr></table></div>'
    )


def _intro(text_html: str) -> str:
    return (
        '<p style="margin:0 0 18px;color:' + _TEXT + ';font-size:15px;'
        'line-height:1.6;">' + text_html + '</p>'
    )


# Type-aware nouns so issues and suggestions get their own copy. English
# needs a single form (Sprint 8: all system texts are English; the old
# Turkish accusative/possessive variants are gone).
_TYPE_NOUN = {"task": "task", "issue": "issue", "suggestion": "suggestion"}
# Plural slug for the deep-link path (/project-management/<plural>).
_TYPE_PLURAL = {"task": "tasks", "issue": "issues", "suggestion": "suggestions"}


def _ttype(task: dict) -> str:
    t = task.get("task_type") or "task"
    return t if t in _TYPE_NOUN else "task"


def _assignment_scope_html(
    *,
    assignee_entries: List[tuple],
    direct_ids: set,
    group_names: List[str],
    list_title: str,
) -> str:
    """Team-context block: who this assignment actually targets.

    `assignee_entries` is the deterministic (user_id, display_name) list
    derived from the SAME fan-out snapshot the recipients come from — no
    second query, no race with later membership changes. Display names
    only; e-mail addresses are never shown to other recipients.
    """
    items = "".join(
        '<li style="margin:2px 0;color:' + _TEXT + ';">'
        + _esc(name) + '</li>'
        for _uid, name in assignee_entries
    )
    groups_line = ""
    if group_names:
        groups_line = (
            '<div style="margin:0 0 6px;color:' + _TEXT_MUTED + ';'
            'font-size:13px;">Assigned groups: <strong style="color:'
            + _TEXT + ';">'
            + _esc(", ".join(group_names))
            + '</strong></div>'
        )
    return (
        '<div style="margin:16px 0 0;padding:14px 16px;background:'
        + _SURFACE_DEEP + ';border:1px solid ' + _BORDER + ';'
        'border-radius:8px;">'
        + groups_line
        + '<div style="color:' + _TEXT_MUTED + ';font-size:13px;'
        'margin-bottom:6px;">' + _esc(list_title) + ' ('
        + str(len(assignee_entries)) + '):</div>'
        '<ul style="margin:0;padding-left:18px;font-size:13px;'
        'line-height:1.7;">' + items + '</ul>'
        '</div>'
    )


def _assignee_email_html(
    task: dict,
    assigner_name: str,
    app_base_url: str,
    *,
    assignee_entries: List[tuple],
    direct_ids: set,
    group_names: List[str],
) -> str:
    """Per-recipient assignment e-mail.

    Sprint 8: every recipient still gets an INDIVIDUAL e-mail (addresses
    are never pooled into one To/CC), but the body now shows the real
    scope of the assignment — a lone assignee no longer reads a 4-person
    team task as if it were theirs alone.
    """
    noun = _TYPE_NOUN[_ttype(task)]
    n = len(assignee_entries)

    if n <= 1 and not group_names:
        # Genuinely personal assignment — keep the personal wording.
        intro = _intro(
            '<strong>' + _esc(assigner_name) + '</strong> assigned you the '
            + noun + ' below.'
        )
        reason = ""
    elif group_names:
        gtxt = '”, “'.join(group_names)
        gword = 'groups' if len(group_names) > 1 else 'group'
        intro = _intro(
            '<strong>' + _esc(assigner_name) + '</strong> assigned the '
            + noun + ' below to the <strong>“' + _esc(gtxt)
            + '”</strong> ' + gword
            + (' and individually selected people' if direct_ids else '')
            + '.'
        )
        reason = (
            'You are receiving this email as a member of the “'
            + _esc(group_names[0]) + '” group.'
            if len(group_names) == 1 and not direct_ids
            else 'You are receiving this email because you are one of the '
                 'assignees.'
        )
    else:
        intro = _intro(
            '<strong>' + _esc(assigner_name) + '</strong> assigned the '
            + noun + ' below to <strong>' + str(n) + ' people</strong>.'
        )
        reason = (
            'You are receiving this email because you are one of the '
            'assignees.'
        )

    scope_block = ""
    if n > 1 or group_names:
        scope_block = _assignment_scope_html(
            assignee_entries=assignee_entries,
            direct_ids=direct_ids,
            group_names=group_names,
            list_title="Group assignees" if group_names else "Assignees",
        )
    reason_block = (
        '<p style="margin:14px 0 0;color:' + _TEXT_MUTED + ';'
        'font-size:12px;line-height:1.6;">' + reason + '</p>'
        if reason
        else ""
    )
    return _shell(
        "You have a new " + noun,
        intro,
        _task_card_html(task) + scope_block + reason_block,
        app_base_url,
        task,
    )


def _assigner_single_email_html(
    task: dict, assignee_name: str, app_base_url: str
) -> str:
    noun = _TYPE_NOUN[_ttype(task)]
    intro = _intro(
        'You assigned the ' + noun + ' below to <strong>'
        + _esc(assignee_name) + '</strong>.'
    )
    return _shell(
        "You assigned a " + noun,
        intro,
        _task_card_html(task),
        app_base_url,
        task,
    )


def _status_assignee_email_html(task: dict, event: str, app_base_url: str) -> str:
    """E-mail to the assignee (the actor) when they accept/complete."""
    noun = _TYPE_NOUN[_ttype(task)]
    if event == "accept":
        title_line = "You accepted the " + noun
        intro = _intro(
            "You accepted the " + noun + " below and started working on it:"
        )
    else:  # complete
        title_line = "You completed the " + noun
        intro = _intro(
            "You <strong>successfully completed</strong> the " + noun
            + " below:"
        )
    return _shell(title_line, intro, _task_card_html(task), app_base_url, task)


def _status_assigner_email_html(
    task: dict, assignee_name: str, event: str, app_base_url: str
) -> str:
    """E-mail to the assigner when their assigned item is accepted/done."""
    noun = _TYPE_NOUN[_ttype(task)]
    who = "<strong>" + _esc(assignee_name) + "</strong>"
    if event == "accept":
        title_line = "Your " + noun + " was accepted"
        intro = _intro(
            who + " <strong>accepted</strong> the " + noun
            + " you assigned and started working on it:"
        )
    else:  # complete
        title_line = "Your " + noun + " was completed"
        intro = _intro(
            who + " <strong>successfully completed</strong> the " + noun
            + " you assigned:"
        )
    return _shell(title_line, intro, _task_card_html(task), app_base_url, task)


def _assigner_group_email_html(
    sample_task: dict,
    assignee_names: List[str],
    app_base_url: str,
    group_names: Optional[List[str]] = None,
) -> str:
    """Single summary to the assigner for a multi-target assignment."""
    noun = _TYPE_NOUN[_ttype(sample_task)]
    names = [n for n in assignee_names if n]
    count = len(names)
    gtxt = (
        ' to the <strong>“' + _esc("”, “".join(group_names)) + '”</strong> group'
        if group_names
        else ''
    )
    intro = _intro(
        'You assigned the same ' + noun + gtxt + ' — <strong>'
        + str(count) + ' people</strong> in total: '
        + ", ".join(_esc(n) for n in names)
    )
    return _shell(
        "You assigned a " + noun + " to " + str(count) + " people",
        intro,
        _task_card_html(sample_task),
        app_base_url,
        sample_task,
    )


# --------------------------------------------------------------
# Orchestration (called from a BackgroundTask)
# --------------------------------------------------------------

async def _send(sender: str, to_email: Optional[str], subject: str, html_body: str) -> None:
    if not to_email:
        return
    try:
        await get_graph_client().send_mail(
            sender=sender,
            to_email=to_email,
            subject=subject,
            html_body=html_body,
            inline_images=_logo_inline_images(),
        )
        print(f"[notif] sendMail OK -> {to_email}", flush=True)
    except (GraphConfigError, GraphRequestError) as exc:
        print(f"[notif] sendMail FAILED -> {to_email}: {exc}", flush=True)
        logger.warning("task notification not sent: %s", exc)
    except Exception as exc:  # noqa: BLE001 — never break the BackgroundTask
        print(f"[notif] sendMail ERROR -> {to_email}: {exc!r}", flush=True)
        logger.warning("task notification unexpected error: %s", exc)


async def send_assignment_notifications(
    *,
    token: str,
    tenant_id: str,
    tasks: List[dict],
    assigner_user_id: str,
    assignment_context: Optional[dict] = None,
) -> None:
    """Send assignment notifications for one create action.

    `tasks` is the serialized task(s): a single-item list for a normal
    create, or one item per member for a group fan-out. All items share
    the same assigner. Safe to call unconditionally — it no-ops when
    notifications are disabled or Graph isn't configured.

    The entire body is wrapped so that NOTHING (not even an unexpected
    error in get_settings()/get_graph_client()) can escape into the
    BackgroundTask executor — task creation already succeeded.
    """
    try:
        settings = get_settings()
        print(
            f"[notif] start enabled={settings.NOTIFICATIONS_ENABLED} "
            f"tasks={len(tasks)} token={'yes' if token else 'no'}",
            flush=True,
        )
        if not settings.NOTIFICATIONS_ENABLED:
            return
        if not tasks:
            return
        client = get_graph_client()
        print(f"[notif] graph_configured={client.is_configured}", flush=True)
        if not client.is_configured:
            logger.info(
                "notifications enabled but Graph not configured — skipping"
            )
            return

        sender = settings.NOTIF_MAIL_SENDER
        app_url = settings.APP_BASE_URL

        # Resolve every referenced user's e-mail in one lookup.
        assignee_ids = [
            str(t.get("assignee_user_id"))
            for t in tasks
            if t.get("assignee_user_id")
        ]
        wanted = set(assignee_ids)
        wanted.add(str(assigner_user_id))
        users = await _resolve_users(
            token, list(wanted), tenant_id=tenant_id
        )
        print(
            f"[notif] wanted={len(wanted)} resolved={len(users)} "
            f"with_email={sum(1 for u in users.values() if u.get('email'))}",
            flush=True,
        )

        assigner = users.get(str(assigner_user_id), {})
        assigner_name = assigner.get("full_name") or "A user"

        # ── Ekip baglami (Sprint 8) ──────────────────────────────────
        # Isim listesi, alicilarla AYNI kaynaktan turetilir: olusturma
        # aninda fan-out edilmis `tasks` satirlari. Ayri bir uyelik
        # sorgusu YAPILMAZ — sonradan degisen grup uyeligi e-postayi
        # etkileyemez (snapshot kurali) ve yaris olusmaz.
        ctx = assignment_context or {}
        group_names = [g for g in (ctx.get("group_names") or []) if g]
        direct_ids = {str(u) for u in (ctx.get("direct_user_ids") or [])}

        seen_ids: set = set()
        assignee_entries: List[tuple] = []
        for aid in assignee_ids:
            if aid in seen_ids:
                continue  # ayni kullaniciya cift satir → tek giris
            seen_ids.add(aid)
            info = users.get(aid) or {}
            assignee_entries.append(
                (aid, info.get("full_name") or info.get("email") or "Unknown user")
            )
        # Deterministik sira: gorunen ada gore (esitlikte stabil id).
        assignee_entries.sort(key=lambda e: (e[1].casefold(), e[0]))

        # 1) Notify each assignee — one INDIVIDUAL e-mail per recipient
        #    (addresses are never pooled), each carrying the same team
        #    context. `sent_to` guards against duplicate rows producing
        #    duplicate mail.
        sent_to: set = set()
        for t in tasks:
            aid = str(t.get("assignee_user_id") or "")
            if aid in sent_to:
                continue
            info = users.get(aid)
            if not info or not info.get("email"):
                continue
            sent_to.add(aid)
            title = t.get("title") or "Task"
            noun = _TYPE_NOUN[_ttype(t)]
            await _send(
                sender,
                info["email"],
                f"[Hermes] {noun.capitalize()} assigned: {title}",
                _assignee_email_html(
                    t,
                    assigner_name,
                    app_url,
                    assignee_entries=assignee_entries,
                    direct_ids=direct_ids,
                    group_names=group_names,
                ),
            )

        # 2) Notify the assigner (single summary).
        if settings.NOTIF_NOTIFY_ASSIGNER and assigner.get("email"):
            if len(tasks) == 1:
                t = tasks[0]
                aid = str(t.get("assignee_user_id") or "")
                assignee_name = (
                    (users.get(aid, {}) or {}).get("full_name")
                    or "a user"
                )
                noun = _TYPE_NOUN[_ttype(t)]
                await _send(
                    sender,
                    assigner["email"],
                    f"[Hermes] You assigned a {noun}: "
                    f"{t.get('title') or 'Task'}",
                    _assigner_single_email_html(t, assignee_name, app_url),
                )
            else:
                # Ayni deterministik isim listesi (ekip baglami ile bire bir).
                assignee_names = [name for _uid, name in assignee_entries]
                noun = _TYPE_NOUN[_ttype(tasks[0])]
                await _send(
                    sender,
                    assigner["email"],
                    f"[Hermes] You assigned a {noun} to "
                    f"{len(assignee_entries)} people: "
                    f"{tasks[0].get('title') or 'Task'}",
                    _assigner_group_email_html(
                        tasks[0], assignee_names, app_url,
                        group_names=group_names,
                    ),
                )
    except Exception as exc:  # noqa: BLE001 — must never escape the BackgroundTask
        print(f"[notif] EXCEPTION: {exc!r}", flush=True)
        logger.warning("send_assignment_notifications failed: %s", exc)


async def send_status_notifications(
    *,
    token: str,
    tenant_id: str,
    task: dict,
    assigner_user_id: str,
    event: str,
) -> None:
    """One-time accept/complete notification. `event` is "accept" or
    "complete". E-mails the assignee (the actor) and — when enabled — the
    assigner. Fired by the router only on the FIRST transition, so it never
    repeats on re-accept/re-complete. Never raises into the BackgroundTask.
    """
    try:
        settings = get_settings()
        print(
            f"[notif-status] start event={event} "
            f"enabled={settings.NOTIFICATIONS_ENABLED} "
            f"token={'yes' if token else 'no'}",
            flush=True,
        )
        if not settings.NOTIFICATIONS_ENABLED:
            return
        if event not in ("accept", "complete"):
            return
        client = get_graph_client()
        if not client.is_configured:
            return

        sender = settings.NOTIF_MAIL_SENDER
        app_url = settings.APP_BASE_URL
        title = task.get("title") or "Task"

        assignee_id = str(task.get("assignee_user_id") or "")
        wanted = {assignee_id, str(assigner_user_id)}
        users = await _resolve_users(
            token, list(wanted), tenant_id=tenant_id
        )
        print(f"[notif-status] resolved={len(users)}", flush=True)

        assignee = users.get(assignee_id, {})
        assigner = users.get(str(assigner_user_id), {})
        assignee_name = assignee.get("full_name") or "A user"
        ttype = _ttype(task)
        noun = _TYPE_NOUN[ttype]

        # 1) The assignee (actor) — "you accepted/completed this item".
        if assignee.get("email"):
            subject = (
                f"[Hermes] You accepted the {noun}: {title}"
                if event == "accept"
                else f"[Hermes] You completed the {noun}: {title}"
            )
            await _send(
                sender,
                assignee["email"],
                subject,
                _status_assignee_email_html(task, event, app_url),
            )

        # 2) The assigner — "your assigned item was accepted/completed".
        if settings.NOTIF_NOTIFY_ASSIGNER and assigner.get("email"):
            subject = (
                f"[Hermes] Your {noun} was accepted: {title}"
                if event == "accept"
                else f"[Hermes] Your {noun} was completed: {title}"
            )
            await _send(
                sender,
                assigner["email"],
                subject,
                _status_assigner_email_html(
                    task, assignee_name, event, app_url
                ),
            )
    except Exception as exc:  # noqa: BLE001 — must never escape the BackgroundTask
        print(f"[notif-status] EXCEPTION: {exc!r}", flush=True)
        logger.warning("send_status_notifications failed: %s", exc)
