# =============================================================================
# HERMES core — Talep e-posta sablonlari (Dalga D4)
# =============================================================================
# Saf fonksiyonlar: (tur, dil, talep, mesaj, cozum) → konu + HTML.
# Gorev e-postalariyla ayni marka kabugu (logo, koyu palet). Kullanicidan
# gelen HER metin HTML-escape edilir; baglanti yalniz APP_BASE_URL http(s)
# ise konur. Konu satirindaki `[TKT-000123]` gelen yanitlari talebe baglar.
# =============================================================================

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional
from urllib.parse import quote, urlparse

from ..ticket_contract import format_ticket_number
from . import task_notifications as brand

_esc = brand._esc

TEXT = {
    "tr": {
        "subject.reply": "Talebinize yanıt var",
        "subject.waiting": "Sizden bilgi bekliyoruz",
        "subject.resolved": "Talebiniz çözüldü",
        "subject.received": "Talebiniz alındı",
        "subject.inbound_rejected": "E-postanız talebe dönüştürülemedi",
        "subject.agent_assigned": "Size atandı",
        "subject.agent_customer_replied": "Müşteri yanıtladı",
        "subject.agent_reopened": "Talep yeniden açıldı",
        "intro.reply": "{team} talebinize yanıt verdi.",
        "intro.waiting": "{team} talebinizle ilgili sizden bilgi bekliyor. Yanıtınız gelene kadar talep beklemede kalır.",
        "intro.resolved": "{team} talebinizi çözüldü olarak işaretledi.",
        "intro.received": "Talebiniz alındı ve {team} ekibine iletildi.",
        "intro.agent_assigned": "{actor} bu talebi size atadı.",
        "intro.agent_assigned_anon": "Bu talep size atandı.",
        "intro.agent_customer_replied": "{actor} talebe yanıt yazdı.",
        "intro.agent_reopened": "{actor} talebi yeniden açtı.",
        "label.summary": "Çözüm",
        "label.workaround": "Geçici çözüm",
        "label.ticket": "Talep",
        "label.status": "Durum",
        "label.priority": "Öncelik",
        "resolved.next": "Sorun devam ediyorsa talebi portaldan yeniden açabilirsiniz. Deneyiminizi puanlamanız bize yardımcı olur.",
        "cta.customer": "Talebi görüntüle",
        "cta.resolved": "Talebi görüntüle ve puanla",
        "cta.agent": "Talebi aç",
        "foot.reply_email": "Bu e-postayı yanıtlayarak talebinize ekleme yapabilirsiniz. Konu satırındaki talep numarasını silmeyin.",
        "foot.reply_portal": "Bu adres yanıtları izlemez; yanıt vermek için portalı kullanın.",
        "foot.agent": "Talep bildirimleri · Hermes",
        "reject.unknown_sender": "Bu adresten gelen e-postalar, Hermes hesabı tanımlı ve talep açma yetkisi olan kullanıcılardan kabul edilir. Talebinizi Hermes portalından açabilir ya da kayıtlı iş e-posta adresinizden yeniden gönderebilirsiniz.",
        "reject.not_requester": "Bu talebe e-postayla yalnızca talebi açan kişi yanıt verebilir. Talebe katkıda bulunmak için Hermes portalını kullanın.",
        "reject.subject": "Gönderdiğiniz e-posta: {subject}",
        "status": {"open": "Açık", "in_progress": "İşlemde", "waiting_customer": "Sizde bekliyor",
                   "resolved": "Çözüldü", "closed": "Kapandı", "reopened": "Yeniden açıldı", "cancelled": "İptal"},
        "priority": {"low": "Düşük", "normal": "Normal", "high": "Yüksek", "urgent": "Acil"},
        "team_fallback": "Destek ekibi",
    },
    "en": {
        "subject.reply": "New reply on your request",
        "subject.waiting": "We need more information",
        "subject.resolved": "Your request was resolved",
        "subject.received": "We received your request",
        "subject.inbound_rejected": "Your e-mail could not become a request",
        "subject.agent_assigned": "Assigned to you",
        "subject.agent_customer_replied": "Customer replied",
        "subject.agent_reopened": "Request reopened",
        "intro.reply": "{team} replied to your request.",
        "intro.waiting": "{team} needs more information from you. The request stays on hold until you reply.",
        "intro.resolved": "{team} marked your request as resolved.",
        "intro.received": "Your request was received and routed to {team}.",
        "intro.agent_assigned": "{actor} assigned this request to you.",
        "intro.agent_assigned_anon": "This request was assigned to you.",
        "intro.agent_customer_replied": "{actor} replied to the request.",
        "intro.agent_reopened": "{actor} reopened the request.",
        "label.summary": "Resolution",
        "label.workaround": "Workaround",
        "label.ticket": "Request",
        "label.status": "Status",
        "label.priority": "Priority",
        "resolved.next": "If the problem persists you can reopen the request from the portal. Rating your experience helps us improve.",
        "cta.customer": "View request",
        "cta.resolved": "View and rate",
        "cta.agent": "Open request",
        "foot.reply_email": "Reply to this e-mail to add to your request. Please keep the request number in the subject line.",
        "foot.reply_portal": "This address does not monitor replies; please use the portal to respond.",
        "foot.agent": "Request notifications · Hermes",
        "reject.unknown_sender": "E-mails to this address are accepted from users who have a Hermes account with permission to open requests. Please open your request from the Hermes portal, or resend it from your registered work address.",
        "reject.not_requester": "Only the person who opened this request can reply to it by e-mail. Please use the Hermes portal to contribute.",
        "reject.subject": "Your e-mail: {subject}",
        "status": {"open": "Open", "in_progress": "In progress", "waiting_customer": "Waiting on you",
                   "resolved": "Resolved", "closed": "Closed", "reopened": "Reopened", "cancelled": "Cancelled"},
        "priority": {"low": "Low", "normal": "Normal", "high": "High", "urgent": "Urgent"},
        "team_fallback": "Support team",
    },
}

# Gonderdigimiz her e-postayi isaretler: gelen kutusu kendi e-postamizi ve
# otomatik yanitlari tanir; Exchange alicilarinda otomatik yanit (OOF) bastirilir.
MAIL_HEADERS = {"X-Hermes-Mail": "ticket", "X-Auto-Response-Suppress": "All"}


@dataclass
class RenderedMail:
    subject: str
    html: str
    headers: Dict[str, str] = field(default_factory=lambda: dict(MAIL_HEADERS))
    inline_images: Optional[List[dict]] = None


def _safe_base(app_base_url: str) -> str:
    base = (app_base_url or "").rstrip("/")
    try:
        parsed = urlparse(base)
    except Exception:  # noqa: BLE001
        return ""
    return base if parsed.scheme in ("http", "https") and parsed.netloc else ""


def ticket_link(ticket, *, audience: str, app_base_url: str, provider_tenant_id: str) -> str:
    base = _safe_base(app_base_url)
    if not base or ticket is None:
        return ""
    if audience == "agent":
        return f"{base}/tickets?ticket={quote(str(ticket.id))}"
    return f"{base}/support?ticket={quote(str(ticket.id))}&provider={quote(provider_tenant_id)}"


def _paragraphs(text: Optional[str]) -> str:
    if not text:
        return ""
    return "<br>".join(_esc(line) or "&nbsp;" for line in str(text).strip().split("\n"))


def _quote_block(text: Optional[str], label: Optional[str] = None) -> str:
    if not text:
        return ""
    head = (
        '<div style="color:' + brand._TEXT_MUTED + ';font-size:12px;font-weight:600;'
        'letter-spacing:0.04em;text-transform:uppercase;margin-bottom:6px;">' + _esc(label) + '</div>'
    ) if label else ""
    return (
        '<div style="background:' + brand._SURFACE_DEEP + ';border:1px solid ' + brand._BORDER + ';'
        'border-left:3px solid ' + brand._BLUE + ';border-radius:10px;padding:14px 16px;margin:0 0 14px;'
        'color:' + brand._TEXT + ';font-size:14px;line-height:1.6;">' + head + _paragraphs(text) + '</div>'
    )


def _facts(ticket, t: dict, *, agent: bool) -> str:
    if ticket is None:
        return ""
    rows = [
        brand._detail_row(t["label.ticket"], f"{format_ticket_number(ticket.number)} · {ticket.title}"),
        brand._detail_row(t["label.status"], t["status"].get(ticket.status, ticket.status)),
    ]
    if agent:
        # Oncelik ic triyaj kararidir; musteri yuzeyinde gosterilmez.
        rows.append(brand._detail_row(t["label.priority"], t["priority"].get(ticket.priority, ticket.priority)))
    return ('<table width="100%" cellpadding="0" cellspacing="0" role="presentation" '
            'style="margin:4px 0 6px;">' + "".join(rows) + '</table>')


def _button(link: str, label: str) -> str:
    if not link:
        return ""
    return (
        '<table width="100%" cellpadding="0" cellspacing="0" role="presentation" '
        'style="margin:22px 0 4px;"><tr><td align="center">'
        '<a href="' + _esc(link) + '" style="display:inline-block;background:' + brand._BLUE + ';'
        'color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 30px;'
        'border-radius:10px;">' + _esc(label) + '</a></td></tr></table>'
    )


def _shell(title_line: str, body_html: str, footer: str) -> str:
    return (
        '<div style="margin:0;padding:0;background:' + brand._BG + ';">'
        '<table width="100%" cellpadding="0" cellspacing="0" role="presentation" '
        'style="background:' + brand._BG + ';font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">'
        '<tr><td align="center" style="padding:28px 16px;">'
        '<table width="600" cellpadding="0" cellspacing="0" role="presentation" '
        'style="width:600px;max-width:600px;background:' + brand._CARD + ';border:1px solid ' + brand._BORDER_SOFT + ';'
        'border-radius:16px;overflow:hidden;">'
        '<tr><td style="height:4px;line-height:4px;font-size:0;background:#388bff;'
        'background:linear-gradient(90deg,#388bff 0%,#6366f1 55%,#7c5cff 100%);">&nbsp;</td></tr>'
        '<tr><td style="background:' + brand._HEADER + ';padding:24px 28px 22px;border-bottom:1px solid ' + brand._BORDER_SOFT + ';">'
        + brand._logo_img_html()
        + '<div style="color:' + brand._TEXT_STRONG + ';font-size:19px;font-weight:700;margin-top:18px;line-height:1.3;">'
        + _esc(title_line) + '</div></td></tr>'
        '<tr><td style="background:' + brand._CARD + ';padding:26px 28px 28px;">' + body_html + '</td></tr>'
        '<tr><td style="padding:18px 28px;background:' + brand._SURFACE_DEEP + ';border-top:1px solid ' + brand._BORDER_SOFT + ';'
        'color:' + brand._TEXT_FAINT + ';font-size:12px;line-height:1.5;text-align:center;">' + _esc(footer) + '</td></tr>'
        '</table></td></tr></table></div>'
    )


def subject_for(kind: str, *, lang: str, ticket=None, subject_hint: Optional[str] = None) -> str:
    t = TEXT.get(lang, TEXT["tr"])
    base = t[f"subject.{kind}"]
    if ticket is None:
        return f"{base}: {subject_hint}" if subject_hint else base
    return f"[{format_ticket_number(ticket.number)}] {base}: {ticket.title}"


def render(
    kind: str,
    *,
    lang: str,
    ticket=None,
    message=None,
    resolution=None,
    actor_display_name: Optional[str] = None,
    reason: Optional[str] = None,
    subject_hint: Optional[str] = None,
    app_base_url: str = "",
    provider_tenant_id: str = "",
    replies_by_email: bool = False,
) -> RenderedMail:
    t = TEXT.get(lang, TEXT["tr"])
    agent = kind.startswith("agent_")
    team = (getattr(ticket, "assigned_group_name_snapshot", None) or t["team_fallback"])
    actor = actor_display_name or (getattr(ticket, "requester_display_name", None) if ticket else None) or t["team_fallback"]
    subject = subject_for(kind, lang=lang, ticket=ticket, subject_hint=subject_hint)
    link = ticket_link(ticket, audience="agent" if agent else "requester",
                       app_base_url=app_base_url, provider_tenant_id=provider_tenant_id)

    parts: List[str] = []
    if kind == "inbound_rejected":
        parts.append(brand._intro(_esc(t.get(f"reject.{reason}", t["reject.unknown_sender"]))))
        if subject_hint:
            parts.append(_quote_block(t["reject.subject"].format(subject=subject_hint)))
        footer = t["foot.reply_portal"]
        return RenderedMail(subject=subject, html=_shell(t[f"subject.{kind}"], "".join(parts), footer),
                            inline_images=brand._logo_inline_images())

    if kind == "agent_assigned" and not actor_display_name:
        intro = t["intro.agent_assigned_anon"]
    else:
        intro = t[f"intro.{kind}"].format(team=team, actor=actor)
    parts.append(brand._intro(_esc(intro)))
    if kind in ("reply", "waiting", "agent_customer_replied") and message is not None:
        parts.append(_quote_block(message.body))
    if kind == "resolved" and resolution is not None:
        parts.append(_quote_block(resolution.public_summary, t["label.summary"]))
        if resolution.public_workaround:
            parts.append(_quote_block(resolution.public_workaround, t["label.workaround"]))
        parts.append(brand._intro(_esc(t["resolved.next"])))
    parts.append(_facts(ticket, t, agent=agent))
    cta = t["cta.agent"] if agent else (t["cta.resolved"] if kind == "resolved" else t["cta.customer"])
    parts.append(_button(link, cta))
    if agent:
        footer = t["foot.agent"]
    else:
        footer = t["foot.reply_email"] if replies_by_email else t["foot.reply_portal"]
    return RenderedMail(subject=subject, html=_shell(t[f"subject.{kind}"], "".join(parts), footer),
                        inline_images=brand._logo_inline_images())
