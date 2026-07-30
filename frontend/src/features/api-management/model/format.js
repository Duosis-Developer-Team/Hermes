/**
 * =============================================================================
 * HERMES - API Management: sabitler ve bicimlendirme (Sprint 6A/6C)
 * =============================================================================
 * Saf veri ve saf fonksiyonlar; hicbir component'e bagli degil. Hem sayfa
 * hem modallar ayni etiket sozlugunu ve ayni tarih bicimini kullanir.
 * =============================================================================
 */
import dayjs from 'dayjs'

export const ENV_META = {
    dev: { label: 'Development', color: '#f59e0b' },
    live: { label: 'Live', color: '#22a06b' },
}
export const TYPE_LABEL = { service: 'Service', user: 'User-bound' }
export const BINDING_LABEL = {
    global: 'Global (everything)',
    user: 'User',
    group: 'Group',
    customer: 'Customer',
    project: 'Project',
}

export function fmtDate(v) {
    return v ? dayjs(v).format('DD MMM YYYY') : '—'
}
export function fmtDateTime(v) {
    return v ? dayjs(v).format('DD MMM YYYY HH:mm') : '—'
}

/**
 * Scope → kisa aciklama. Katalogun KENDISI backend'den gelir
 * (`capabilities.scopes`); bu sozluk yalnizca UI aciklamasidir ve
 * katalogda olup burada bulunmayan bir scope ham koduyla gosterilir.
 */
export const SCOPE_HELP = {
    'tasks:read': 'Read work items',
    'tasks:write': 'Create & update work items',
    'tasks:comment': 'Comment on work items',
    'tasks:complete': 'Change work item status',
    'customers:read': 'Read customers',
    'projects:read': 'Read projects',
    'work-logs:read': 'Read work logs',
    'work-logs:write': 'Create work logs',
    'meetings:read': 'Read meetings',
    'users:read': 'Read user directory',
    'groups:read': 'Read groups',
}
