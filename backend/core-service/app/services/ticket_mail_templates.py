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
        # --- talep eden ---------------------------------------------------
        "subject.received": "Talebiniz alındı",
        "subject.assigned": "Talebiniz işleme alındı",
        "subject.reply": "Talebinize yanıt var",
        "subject.waiting": "Sizden bilgi bekliyoruz",
        "subject.own_reply": "Yanıtınız alındı",
        "subject.resolved": "Talebiniz çözüldü",
        "subject.inbound_rejected": "E-postanız talebe dönüştürülemedi",
        "intro.received": "Talebiniz bize ulaştı ve {team} ile paylaşıldı. Ekibimiz talebinizi inceleyip en kısa sürede size dönüş yapacak.",
        "intro.assigned": "Talebiniz {team} tarafından kabul edildi ve işleme alındı. {assignee} talebinizle ilgileniyor; gelişmeleri bu adrese bildireceğiz.",
        "intro.assigned_anon": "Talebiniz {team} tarafından kabul edildi ve işleme alındı. Gelişmeleri bu adrese bildireceğiz.",
        "intro.reply": "{actor} talebinize yanıt verdi.",
        "intro.waiting": "{team} talebinizle ilgili sizden bilgi bekliyor. Yanıtınız gelene kadar talep beklemede kalır.",
        "intro.own_reply": "Yanıtınız talebinize eklendi ve {team} ile paylaşıldı. Yazdığınız mesajın bir kopyası aşağıdadır.",
        "intro.resolved": "{team} talebinizi çözdü. Çözüm özeti aşağıda yer alıyor.",
        # --- ekip ---------------------------------------------------------
        "subject.agent_new_ticket": "Yeni talep",
        "subject.agent_assigned": "Talep atandı",
        "subject.agent_assigned_me": "Talep size atandı",
        "subject.agent_replied": "Müşteriye yanıt verildi",
        "subject.agent_customer_replied": "Müşteri yanıtladı",
        "subject.agent_resolved": "Talep çözüldü",
        "subject.agent_reopened": "Talep yeniden açıldı",
        "intro.agent_new_ticket": "{actor} ({customer}) yeni bir talep açtı. Talep {team} kuyruğunda.",
        "intro.agent_new_ticket_same": "{customer} yeni bir talep açtı. Talep {team} kuyruğunda.",
        "intro.agent_assigned": "Talebin sorumlusu {assignee} olarak belirlendi.",
        "intro.agent_assigned_me": "{actor} bu talebi size atadı.",
        "intro.agent_assigned_me_anon": "Bu talep size atandı.",
        "intro.agent_replied": "{actor} müşteriye yanıt verdi.",
        "intro.agent_customer_replied": "{actor} talebe yanıt yazdı.",
        "intro.agent_resolved": "{actor} talebi çözdü.",
        "intro.agent_reopened": "{actor} talebi yeniden açtı.",
        # --- ortak --------------------------------------------------------
        "label.summary": "Çözüm",
        "label.workaround": "Geçici çözüm",
        "label.ticket": "Talep",
        "label.reference": "Referans",
        "label.status": "Durum",
        "label.assignee": "Sorumlu",
        "label.assigned_by": "Atayan",
        "label.priority": "Öncelik",
        "label.customer": "Müşteri",
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
        "customer_fallback": "Müşteri",
    },
    "en": {
        "subject.received": "We received your request",
        "subject.assigned": "Your request is being handled",
        "subject.reply": "New reply on your request",
        "subject.waiting": "We need more information",
        "subject.own_reply": "We received your reply",
        "subject.resolved": "Your request was resolved",
        "subject.inbound_rejected": "Your e-mail could not become a request",
        "intro.received": "Your request has reached us and was routed to {team}. Our team will review it and get back to you as soon as possible.",
        "intro.assigned": "Your request was accepted by {team} and is now being handled. {assignee} is working on it; we will keep you posted at this address.",
        "intro.assigned_anon": "Your request was accepted by {team} and is now being handled. We will keep you posted at this address.",
        "intro.reply": "{actor} replied to your request.",
        "intro.waiting": "{team} needs more information from you. The request stays on hold until you reply.",
        "intro.own_reply": "Your reply was added to the request and forwarded to {team}. A copy of your message is below.",
        "intro.resolved": "{team} resolved your request. The resolution summary is below.",
        "subject.agent_new_ticket": "New request",
        "subject.agent_assigned": "Request assigned",
        "subject.agent_assigned_me": "Request assigned to you",
        "subject.agent_replied": "Customer was answered",
        "subject.agent_customer_replied": "Customer replied",
        "subject.agent_resolved": "Request resolved",
        "subject.agent_reopened": "Request reopened",
        "intro.agent_new_ticket": "{actor} ({customer}) opened a new request. It is in the {team} queue.",
        "intro.agent_new_ticket_same": "{customer} opened a new request. It is in the {team} queue.",
        "intro.agent_assigned": "{assignee} is now responsible for this request.",
        "intro.agent_assigned_me": "{actor} assigned this request to you.",
        "intro.agent_assigned_me_anon": "This request was assigned to you.",
        "intro.agent_replied": "{actor} replied to the customer.",
        "intro.agent_customer_replied": "{actor} replied to the request.",
        "intro.agent_resolved": "{actor} resolved the request.",
        "intro.agent_reopened": "{actor} reopened the request.",
        "label.summary": "Resolution",
        "label.workaround": "Workaround",
        "label.ticket": "Request",
        "label.reference": "Reference",
        "label.status": "Status",
        "label.assignee": "Assignee",
        "label.assigned_by": "Assigned by",
        "label.priority": "Priority",
        "label.customer": "Customer",
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
        "customer_fallback": "Customer",
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


def _facts(ticket, t: dict, *, agent: bool, ref: Optional[str] = None,
           assignee_name: Optional[str] = None, assigned_by: Optional[str] = None,
           customer_name: Optional[str] = None) -> str:
    if ticket is None:
        return ""
    number = format_ticket_number(ticket.number)
    rows = [brand._detail_row(t["label.ticket"], f"{ref or number} · {ticket.title}")]
    if ref:
        # Kanonik numara konu satirinda ve burada kalir: gelen yanit ve
        # entegrasyonlar onunla eslesir.
        rows.append(brand._detail_row(t["label.reference"], number))
    if agent and customer_name:
        rows.append(brand._detail_row(t["label.customer"], customer_name))
    rows.append(brand._detail_row(t["label.status"], t["status"].get(ticket.status, ticket.status)))
    if assignee_name:
        rows.append(brand._detail_row(t["label.assignee"], assignee_name))
    if assigned_by:
        rows.append(brand._detail_row(t["label.assigned_by"], assigned_by))
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


def subject_for(kind: str, *, lang: str, ticket=None, subject_hint: Optional[str] = None,
                personal: bool = False) -> str:
    t = TEXT.get(lang, TEXT["tr"])
    key = "subject.agent_assigned_me" if (kind == "agent_assigned" and personal) else f"subject.{kind}"
    base = t[key]
    if ticket is None:
        return f"{base}: {subject_hint}" if subject_hint else base
    return f"[{format_ticket_number(ticket.number)}] {base}: {ticket.title}"


def _intro_for(kind: str, t: dict, *, team: str, actor: str, actor_given: bool, assignee: Optional[str],
               customer: str, personal: bool) -> str:
    if kind == "assigned":
        return (t["intro.assigned"] if assignee else t["intro.assigned_anon"]).format(team=team, assignee=assignee)
    if kind == "agent_assigned":
        if personal:
            return t["intro.agent_assigned_me"].format(actor=actor) if actor_given else t["intro.agent_assigned_me_anon"]
        return t["intro.agent_assigned"].format(assignee=assignee or t["team_fallback"])
    if kind == "agent_new_ticket" and actor.strip().casefold() == customer.strip().casefold():
        # Sirket hesabinda talep eden adi = musteri adi ("Defacto").
        return t["intro.agent_new_ticket_same"].format(team=team, customer=customer)
    return t[f"intro.{kind}"].format(team=team, actor=actor, customer=customer)


# Mesaj alintisi tasiyan turler (ic not ASLA: satirlar yalniz genel mesajla yazilir).
_QUOTES = ("reply", "waiting", "own_reply", "agent_replied", "agent_customer_replied", "agent_new_ticket")


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
    ref: Optional[str] = None,
    customer_name: Optional[str] = None,
    assignee_name: Optional[str] = None,
    personal: bool = False,
) -> RenderedMail:
    t = TEXT.get(lang, TEXT["tr"])
    agent = kind.startswith("agent_")
    team = (getattr(ticket, "assigned_group_name_snapshot", None) or t["team_fallback"])
    actor = (actor_display_name or (getattr(message, "author_display_name", None) if message else None)
             or (getattr(ticket, "requester_display_name", None) if ticket else None) or t["team_fallback"])
    subject = subject_for(kind, lang=lang, ticket=ticket, subject_hint=subject_hint, personal=personal)
    title = subject_for(kind, lang=lang, personal=personal)
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

    intro = _intro_for(kind, t, team=team, actor=actor, actor_given=bool(actor_display_name),
                       assignee=assignee_name, customer=customer_name or t["customer_fallback"],
                       personal=personal)
    parts.append(brand._intro(_esc(intro)))
    if kind in _QUOTES and message is not None:
        parts.append(_quote_block(message.body))
    if kind in ("resolved", "agent_resolved") and resolution is not None:
        parts.append(_quote_block(resolution.public_summary, t["label.summary"]))
        if resolution.public_workaround:
            parts.append(_quote_block(resolution.public_workaround, t["label.workaround"]))
        if kind == "resolved":
            parts.append(brand._intro(_esc(t["resolved.next"])))
    show_assignee = assignee_name if kind not in ("received", "agent_new_ticket") else None
    parts.append(_facts(ticket, t, agent=agent, ref=ref, assignee_name=show_assignee,
                        assigned_by=actor_display_name if kind == "agent_assigned" and not personal else None,
                        customer_name=customer_name))
    cta = t["cta.agent"] if agent else (t["cta.resolved"] if kind == "resolved" else t["cta.customer"])
    parts.append(_button(link, cta))
    if agent:
        footer = t["foot.agent"]
    else:
        footer = t["foot.reply_email"] if replies_by_email else t["foot.reply_portal"]
    return RenderedMail(subject=subject, html=_shell(title, "".join(parts), footer),
                        inline_images=brand._logo_inline_images())
