/**
 * =============================================================================
 * HERMES - Ticket sozlugu (UI etiketleri)
 * =============================================================================
 * Backend enum degerleri sozlesmedir ve SABITTIR; kullaniciya gosterilen
 * etiketler burada yasar. Bilinmeyen bir deger gelirse (sozlesme v1
 * icinde YENI deger ekleyebilir) ham kod gosterilir — ekran KIRILMAZ,
 * "unknown" fallback'i budur.
 *
 * Arayuz dili Ingilizce'dir (repo kurali: urun kaynagindaki kullaniciya
 * donuk dizgeler Ingilizce; yorumlar Turkce kalir).
 */

export const STATUS_LABELS = {
    open: 'Open',
    in_progress: 'In progress',
    waiting_customer: 'Waiting for your reply',
    resolved: 'Resolved',
    closed: 'Closed',
    reopened: 'Reopened',
    cancelled: 'Cancelled',
}

/** Agent tarafinda ayni durumun ifadesi farklidir: "sizden" degil
 *  "musteriden" bilgi bekleniyor. */
export const AGENT_STATUS_LABELS = {
    ...STATUS_LABELS,
    waiting_customer: 'Waiting on customer',
}

/** Durum YALNIZCA renkle anlatilmaz (erisilebilirlik): ikon + metin +
 *  rozet birlikte kullanilir. */
export const STATUS_TONES = {
    open: 'info',
    in_progress: 'brand',
    waiting_customer: 'warning',
    resolved: 'success',
    closed: 'neutral',
    reopened: 'warning',
    cancelled: 'neutral',
}

export const STATUS_ICONS = {
    open: '○',
    in_progress: '◐',
    waiting_customer: '!',
    resolved: '✓',
    closed: '■',
    reopened: '↻',
    cancelled: '×',
}

export const CATEGORY_LABELS = {
    bug: 'Bug',
    incident: 'Incident',
    improvement: 'Improvement',
    question: 'Question',
    data_correction: 'Data correction',
}

export const IMPACT_LABELS = {
    single_user: 'Single user',
    multiple_users: 'Multiple users',
    tenant_blocked: 'We cannot work',
    security_or_data_risk: 'Security or data risk',
}

export const IMPACT_HINTS = {
    single_user: 'Only you are affected and you can keep working.',
    multiple_users: 'More than one person on your team is affected.',
    tenant_blocked: 'Your main workflow has stopped completely.',
    security_or_data_risk:
        'You see a possible security issue or risk of data loss.',
}

export const PRIORITY_LABELS = {
    low: 'Low',
    normal: 'Normal',
    high: 'High',
    urgent: 'Urgent',
}

export const PRIORITY_TONES = {
    low: 'neutral',
    normal: 'info',
    high: 'warning',
    urgent: 'danger',
}

export const RESOLUTION_LABELS = {
    fixed: 'Fixed',
    workaround: 'Workaround applied',
    configuration: 'Solved by configuration',
    not_reproducible: 'Could not reproduce',
    duplicate: 'Duplicate of an existing ticket',
    wont_fix: 'Will not be changed',
    answered: 'Answered',
}

export const QUEUE_LABELS = {
    my_group_open: "My group's open tickets",
    assigned_to_me: 'Assigned to me',
    unassigned: 'Unassigned',
    awaiting_first_response: 'Awaiting first response',
    customer_replied: 'Customer replied',
    waiting_customer: 'Waiting on customer',
    recently_resolved: 'Recently resolved',
    all: 'All tickets',
}

/** Sozlesme kodu → kullaniciya gosterilecek aciklama. Ham kodu
 *  gostermek ("route_missing") kullaniciya hicbir sey anlatmaz. */
export const ERROR_MESSAGES = {
    route_missing:
        'Support routing has not been configured yet. Please contact '
        + 'your administrator.',
    route_stale:
        'Support routing has changed. Refresh the page and try again.',
    group_inactive:
        'The target support team is not active right now. Please '
        + 'contact your administrator.',
    ticket_version_conflict:
        'This ticket changed while you were looking at it. The latest '
        + 'version was loaded and your text was kept.',
    idempotency_conflict:
        'The same request was sent again with different content. '
        + 'Refresh the page and try again.',
    attachment_not_ready:
        'One of the attachments has not finished scanning or was '
        + 'rejected.',
    rate_limited:
        'Too many requests. Please wait a moment and try again.',
    support_not_configured:
        'The support module is not configured on this environment.',
    forbidden: 'You do not have permission to do this.',
}

export const labelOf = (dictionary, value) =>
    dictionary[value] ?? value ?? '—'

/** Cozulmus/kapali ticket satirinin gorsel dili: yesil sol kenar +
 *  check rozeti. Baslik STRIKETHROUGH YAPILMAZ — okunabilirlik ve
 *  erisilebilirlik karari (07_RESEARCH: bilincli tercih). */
export const isResolvedLike = (status) =>
    status === 'resolved' || status === 'closed'
