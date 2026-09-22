/**
 * =============================================================================
 * HERMES - Ayarlar katalogu (PM rework P0 / B1)
 * =============================================================================
 * Ayar yuzeyinin TEK kaynagi: hangi bolumde hangi sayfa, hangi yolda, hangi
 * izinle. Kenar cubugu ("Ayarlar" ogesi gorunur mu?), /settings kabugunun
 * sol menusu, rota koruyuculari ve eski adres yonlendirmeleri hep buradan
 * okur. Bir sayfa yalnizca burada eklenir; iki listeyi senkron tutmak yok.
 *
 * Bolumler 03-yetenekler §6'daki tabloyla birebir. Izni olmayan bolum
 * GORUNMEZ (menu zaten `can(perm)` ile boyle calisiyordu; ayni desen
 * bolum seviyesine indi). Yeni izin kodu EKLENMEDI (B1 kapsam disi).
 *
 * Yolu SABIT tutuyoruz: mevcut baglantilar, favoriler ve e-postalar eski
 * adresleri tasir — `LEGACY_SETTINGS_PATHS` onlari yeni yola yonlendirir.
 * =============================================================================
 */

export const SETTINGS_SECTIONS = [
    {
        key: 'organization',
        labelKey: 'settings.organization',
        items: [
            { key: 'users', path: '/settings/organization/users', labelKey: 'nav.users', perm: 'users.manage' },
            { key: 'capacity', path: '/settings/organization/capacity', labelKey: 'nav.capacity', perm: 'users.manage' },
        ],
    },
    {
        key: 'work',
        labelKey: 'settings.work',
        items: [
            { key: 'pm', path: '/settings/work/pm', labelKey: 'nav.pmConfigurations', perm: 'tasks.permissions.manage' },
        ],
    },
    {
        key: 'reference',
        labelKey: 'settings.reference',
        items: [
            { key: 'work-types', path: '/settings/reference/work-types', labelKey: 'nav.workTypes', perm: 'reference.manage' },
            { key: 'activity-types', path: '/settings/reference/activity-types', labelKey: 'nav.activityTypes', perm: 'reference.manage' },
            { key: 'platforms', path: '/settings/reference/platforms', labelKey: 'nav.platforms', perm: 'reference.manage' },
            { key: 'work-lines', path: '/settings/reference/work-lines', labelKey: 'nav.workLines', perm: 'reference.manage' },
        ],
    },
    {
        key: 'customers',
        labelKey: 'settings.customers',
        items: [
            { key: 'customers', path: '/settings/customers/customers', labelKey: 'nav.customers', perm: 'customers.manage' },
            { key: 'projects', path: '/settings/customers/projects', labelKey: 'nav.projects', perm: 'projects.manage' },
        ],
    },
    {
        key: 'integrations',
        labelKey: 'settings.integrations',
        items: [
            { key: 'api', path: '/settings/integrations/api', labelKey: 'nav.apiManagement', perm: 'api.manage' },
            // Ticket entegrasyonu: mevcut rota iki izinden birini kabul ediyordu.
            { key: 'tickets', path: '/settings/integrations/tickets', labelKey: 'nav.ticketIntegrations', perm: ['tickets.config.manage', 'tickets.admin'] },
        ],
    },
]

/** Eski adres → yeni adres. Rota agacinda Navigate olarak kurulur. */
export const LEGACY_SETTINGS_PATHS = {
    '/users': '/settings/organization/users',
    '/capacity': '/settings/organization/capacity',
    '/pm-configurations': '/settings/work/pm',
    '/task-management': '/settings/work/pm',
    '/work-types': '/settings/reference/work-types',
    '/activity-types': '/settings/reference/activity-types',
    '/platforms': '/settings/reference/platforms',
    '/work-lines': '/settings/reference/work-lines',
    '/customers': '/settings/customers/customers',
    '/projects': '/settings/customers/projects',
    '/api-management': '/settings/integrations/api',
    '/ticket-integrations': '/settings/integrations/tickets',
}

const permsOf = (item) => (Array.isArray(item.perm) ? item.perm : [item.perm])

/** Verilen `canAny(...perms)` ile GORUNUR bolumler (bos bolum dusurulur). */
export const visibleSections = (canAny) =>
    SETTINGS_SECTIONS
        .map((s) => ({ ...s, items: s.items.filter((i) => canAny(...permsOf(i))) }))
        .filter((s) => s.items.length > 0)

/** Kullanicinin ilk gorebilecegi ayar sayfasi; hicbiri yoksa null. */
export const firstSettingsPath = (canAny) =>
    visibleSections(canAny)[0]?.items[0]?.path ?? null

/** Kenar cubugundaki tek "Ayarlar" ogesi icin: en az bir bolum var mi? */
export const hasAnySettings = (canAny) => firstSettingsPath(canAny) !== null
