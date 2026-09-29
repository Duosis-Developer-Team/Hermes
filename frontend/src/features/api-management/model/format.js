/**
 * =============================================================================
 * HERMES - API Management: sabitler ve bicimlendirme (Sprint 6A/6C)
 * =============================================================================
 * Saf veri ve saf fonksiyonlar; hicbir component'e bagli degil. Hem sayfa
 * hem modallar ayni etiket sozlugunu ve ayni tarih bicimini kullanir.
 *
 * i18n (29.09): etiketler METIN degil sozluk ANAHTARI tasir; ceviri
 * render'da `t()` ile yapilir (modul duzeyinde hook cagrilamaz).
 * =============================================================================
 */
import dayjs from 'dayjs'

/** Ortam: etiket anahtari + durum hapi tonu (lq-tag--*). */
export const ENV_META = {
    dev: { labelKey: 'api.development', tone: 'warn' },
    live: { labelKey: 'api.live', tone: 'ok' },
}
export const TYPE_LABEL = { service: 'api.service', user: 'api.userBound' }
export const BINDING_LABEL = {
    global: 'api.bindingGlobal',
    user: 'entity.user',
    group: 'api.group',
    customer: 'entity.customer',
    project: 'entity.project',
}

export function fmtDate(v) {
    return v ? dayjs(v).format('DD MMM YYYY') : '—'
}
export function fmtDateTime(v) {
    return v ? dayjs(v).format('DD MMM YYYY HH:mm') : '—'
}

/**
 * Scope → kisa aciklama ANAHTARI. Katalogun KENDISI backend'den gelir
 * (`capabilities.scopes`); bu sozluk yalnizca UI aciklamasidir ve
 * katalogda olup burada bulunmayan bir scope ham koduyla gosterilir.
 */
export const SCOPE_HELP = {
    'tasks:read': 'api.scopeHelp.tasksRead',
    'tasks:write': 'api.scopeHelp.tasksWrite',
    'tasks:comment': 'api.scopeHelp.tasksComment',
    'tasks:complete': 'api.scopeHelp.tasksComplete',
    'customers:read': 'api.scopeHelp.customersRead',
    'projects:read': 'api.scopeHelp.projectsRead',
    'work-logs:read': 'api.scopeHelp.workLogsRead',
    'work-logs:write': 'api.scopeHelp.workLogsWrite',
    'meetings:read': 'api.scopeHelp.meetingsRead',
    'users:read': 'api.scopeHelp.usersRead',
    'groups:read': 'api.scopeHelp.groupsRead',
}
