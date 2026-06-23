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

import html
import logging
from typing import Dict, List, Optional, Sequence
from urllib.parse import urlparse

import httpx

from ..config import get_settings
from .graph_service import (
    GraphConfigError,
    GraphRequestError,
    get_graph_client,
)

logger = logging.getLogger(__name__)

_PRIORITY_LABELS = {
    "low": "Düşük",
    "medium": "Orta",
    "high": "Yüksek",
    "urgent": "Acil",
}
_PRIORITY_COLORS = {
    "low": "#6b7280",
    "medium": "#2563eb",
    "high": "#d97706",
    "urgent": "#dc2626",
}


# --------------------------------------------------------------
# E-mail resolution (auth-service)
# --------------------------------------------------------------

def _auth_base_url() -> str:
    """Normalise AUTH_SERVICE_URL so we can append our own path. The
    configmap value may already end in /api/v1 (mirrors reports.py)."""
    base = (get_settings().AUTH_SERVICE_URL or "").rstrip("/")
    if base.endswith("/api/v1"):
        base = base[: -len("/api/v1")]
    return base


async def _resolve_users(
    token: str, ids: Sequence[str]
) -> Dict[str, dict]:
    """Return {user_id: {email, full_name}} for the given ids via
    auth-service /users/lookup. Returns {} on any failure — callers
    treat a missing e-mail as "skip that recipient"."""
    unique = [str(i) for i in {str(x) for x in ids} if i]
    if not unique or not token:
        print(
            f"[notif] lookup skipped ids={len(unique)} token={'yes' if token else 'no'}",
            flush=True,
        )
        return {}
    url = f"{_auth_base_url()}/api/v1/auth/users/lookup"
    headers = {"Authorization": token}
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
        '<td style="padding:4px 0;color:#6b7280;font-size:13px;'
        'width:140px;vertical-align:top;">' + _esc(label) + '</td>'
        '<td style="padding:4px 0;color:#111827;font-size:13px;'
        'font-weight:600;">' + _esc(value) + '</td>'
        '</tr>'
    )


def _task_card_html(task: dict) -> str:
    code = _esc(task.get("task_code") or "")
    title = _esc(task.get("title") or "Görev")
    priority = (task.get("priority") or "medium").lower()
    p_label = _PRIORITY_LABELS.get(priority, priority)
    p_color = _PRIORITY_COLORS.get(priority, "#2563eb")

    customer = task.get("customer_name")
    project = task.get("project_name")
    sub_project = task.get("sub_project_name")
    scope = " · ".join([s for s in [customer, project, sub_project] if s])

    description = task.get("description")
    desc_block = ""
    if description:
        desc_block = (
            '<div style="margin-top:12px;padding:12px 14px;background:#f9fafb;'
            'border:1px solid #eef0f3;border-radius:8px;color:#374151;'
            'font-size:13px;line-height:1.6;white-space:pre-wrap;">'
            + _esc(description)
            + '</div>'
        )

    rows = "".join(
        [
            _detail_row("Kapsam", scope or None),
            _detail_row("Planlanan", task.get("scheduled_date")),
            _detail_row("Termin", task.get("due_date")),
        ]
    )

    return (
        '<div style="border:1px solid #e5e7eb;border-radius:12px;'
        'padding:18px 20px;background:#ffffff;">'
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">'
        + (
            '<span style="font-size:12px;font-weight:700;color:#4f46e5;'
            'letter-spacing:0.03em;">' + code + '</span>'
            if code
            else ""
        )
        + '<span style="display:inline-block;margin-left:auto;font-size:11px;'
        'font-weight:700;color:#ffffff;background:' + p_color + ';'
        'padding:2px 10px;border-radius:999px;">' + _esc(p_label) + '</span>'
        '</div>'
        '<div style="font-size:17px;font-weight:700;color:#111827;'
        'line-height:1.35;margin-bottom:10px;">' + title + '</div>'
        '<table style="width:100%;border-collapse:collapse;">' + rows + '</table>'
        + desc_block
        + '</div>'
    )


def _cta_button(app_base_url: str) -> str:
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
    link = f"{base}/tasks"
    return (
        '<div style="text-align:center;margin:24px 0 4px;">'
        '<a href="' + _esc(link) + '" '
        'style="display:inline-block;background:#4f46e5;color:#ffffff;'
        'text-decoration:none;font-weight:600;font-size:14px;'
        'padding:11px 28px;border-radius:10px;">Görevi Görüntüle</a>'
        '</div>'
    )


def _shell(title_line: str, intro_html: str, body_html: str, app_base_url: str) -> str:
    """Wrap content in the branded e-mail shell (light theme — safe in
    every mail client)."""
    return (
        '<div style="margin:0;padding:24px;background:#f3f4f6;'
        'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">'
        '<div style="max-width:560px;margin:0 auto;background:#ffffff;'
        'border-radius:16px;overflow:hidden;'
        'box-shadow:0 6px 24px rgba(17,24,39,0.08);">'
        # Header band — brand gradient
        '<div style="background:linear-gradient(135deg,#388bff 0%,#6366f1 55%,'
        '#7c5cff 100%);padding:22px 28px;">'
        '<div style="color:#ffffff;font-size:13px;font-weight:700;'
        'letter-spacing:0.14em;opacity:0.9;">HERMES</div>'
        '<div style="color:#ffffff;font-size:20px;font-weight:700;'
        'margin-top:2px;">' + _esc(title_line) + '</div>'
        '</div>'
        # Body
        '<div style="padding:26px 28px 30px;">'
        + intro_html
        + body_html
        + _cta_button(app_base_url)
        + '</div>'
        # Footer
        '<div style="padding:16px 28px;background:#f9fafb;border-top:'
        '1px solid #eef0f3;color:#9ca3af;font-size:12px;text-align:center;">'
        'Bu otomatik bir bildirimdir · Hermes Görev Yönetimi'
        '</div>'
        '</div></div>'
    )


def _intro(text_html: str) -> str:
    return (
        '<p style="margin:0 0 18px;color:#374151;font-size:15px;'
        'line-height:1.6;">' + text_html + '</p>'
    )


def _assignee_email_html(task: dict, assigner_name: str, app_base_url: str) -> str:
    intro = _intro(
        '<strong>' + _esc(assigner_name) + '</strong> size yeni bir görev '
        'atadı. Detaylar aşağıda:'
    )
    return _shell(
        "Size yeni bir görev atandı",
        intro,
        _task_card_html(task),
        app_base_url,
    )


def _assigner_single_email_html(
    task: dict, assignee_name: str, app_base_url: str
) -> str:
    intro = _intro(
        '<strong>' + _esc(assignee_name) + '</strong> kişisine yeni bir görev '
        'atadınız. Atadığınız görevin özeti:'
    )
    return _shell(
        "Bir görev atadınız",
        intro,
        _task_card_html(task),
        app_base_url,
    )


def _assigner_group_email_html(
    sample_task: dict, assignee_names: List[str], app_base_url: str
) -> str:
    names = ", ".join(_esc(n) for n in assignee_names if n)
    count = len([n for n in assignee_names if n])
    intro = _intro(
        '<strong>' + str(count) + ' kişiye</strong> aynı görevi atadınız: '
        + names
    )
    return _shell(
        "Bir gruba görev atadınız",
        intro,
        _task_card_html(sample_task),
        app_base_url,
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
    tasks: List[dict],
    assigner_user_id: str,
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
        users = await _resolve_users(token, list(wanted))
        print(
            f"[notif] wanted={len(wanted)} resolved={len(users)} "
            f"with_email={sum(1 for u in users.values() if u.get('email'))}",
            flush=True,
        )

        assigner = users.get(str(assigner_user_id), {})
        assigner_name = assigner.get("full_name") or "Bir kullanıcı"

        # 1) Notify each assignee.
        for t in tasks:
            aid = str(t.get("assignee_user_id") or "")
            info = users.get(aid)
            if not info or not info.get("email"):
                continue
            title = t.get("title") or "Görev"
            await _send(
                sender,
                info["email"],
                f"Yeni görev: {title}",
                _assignee_email_html(t, assigner_name, app_url),
            )

        # 2) Notify the assigner (single summary).
        if settings.NOTIF_NOTIFY_ASSIGNER and assigner.get("email"):
            if len(tasks) == 1:
                t = tasks[0]
                aid = str(t.get("assignee_user_id") or "")
                assignee_name = (
                    (users.get(aid, {}) or {}).get("full_name")
                    or "bir kullanıcı"
                )
                await _send(
                    sender,
                    assigner["email"],
                    f"Görev atadınız: {t.get('title') or 'Görev'}",
                    _assigner_single_email_html(t, assignee_name, app_url),
                )
            else:
                assignee_names = [
                    (users.get(str(t.get("assignee_user_id")), {}) or {}).get(
                        "full_name"
                    )
                    or ""
                    for t in tasks
                ]
                await _send(
                    sender,
                    assigner["email"],
                    f"Gruba görev atadınız: {tasks[0].get('title') or 'Görev'}",
                    _assigner_group_email_html(tasks[0], assignee_names, app_url),
                )
    except Exception as exc:  # noqa: BLE001 — must never escape the BackgroundTask
        print(f"[notif] EXCEPTION: {exc!r}", flush=True)
        logger.warning("send_assignment_notifications failed: %s", exc)
