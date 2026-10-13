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

// Musteri/proje ayarlari is ya da zaman girisi icin vardir (talep-yalniz
// tenant'ta gereksiz). Dizi = herhangi biri acik olmali.
const WORK_OR_TIME = ['work', 'time_entry']

export const SETTINGS_SECTIONS = [
    {
        key: 'organization',
        labelKey: 'settings.organization',
        items: [
            { key: 'users', path: '/settings/organization/users', labelKey: 'nav.users', perm: 'users.manage' },
            { key: 'capacity', path: '/settings/organization/capacity', labelKey: 'nav.capacity', perm: 'users.manage', module: 'time_entry' },
        ],
    },
    {
        key: 'work',
        labelKey: 'settings.work',
        items: [
            { key: 'pm', path: '/settings/work/pm', labelKey: 'nav.pmConfigurations', perm: 'tasks.permissions.manage', module: 'work' },
        ],
    },
    {
        key: 'reference',
        labelKey: 'settings.reference',
        items: [
            { key: 'work-types', path: '/settings/reference/work-types', labelKey: 'nav.workTypes', perm: 'reference.manage', module: 'time_entry' },
            { key: 'activity-types', path: '/settings/reference/activity-types', labelKey: 'nav.activityTypes', perm: 'reference.manage', module: 'time_entry' },
            { key: 'platforms', path: '/settings/reference/platforms', labelKey: 'nav.platforms', perm: 'reference.manage', module: 'time_entry' },
            { key: 'work-lines', path: '/settings/reference/work-lines', labelKey: 'nav.workLines', perm: 'reference.manage', module: 'time_entry' },
        ],
    },
    {
        key: 'customers',
        labelKey: 'settings.customers',
        items: [
            { key: 'customers', path: '/settings/customers/customers', labelKey: 'nav.customers', perm: 'customers.manage', module: WORK_OR_TIME },
            { key: 'projects', path: '/settings/customers/projects', labelKey: 'nav.projects', perm: 'projects.manage', module: WORK_OR_TIME },
            // Proje turleri (05.10): tur rengi = jenerik proje logosunun rengi.
            { key: 'project-types', path: '/settings/customers/project-types', labelKey: 'nav.projectTypes', perm: 'projects.manage', module: WORK_OR_TIME },
        ],
    },
    {
        key: 'support',
        labelKey: 'settings.support',
        items: [
            // Dalga B: SLA, etiket, hazir yanit — yalniz saglayici (hub) tenant'ta.
            { key: 'helpdesk', path: '/settings/tickets/helpdesk', labelKey: 'nav.ticketHelpdesk', perm: ['tickets.config.manage', 'tickets.admin'], module: 'tickets', requires: 'ticketHub' },
        ],
    },
    {
        key: 'integrations',
        labelKey: 'settings.integrations',
        items: [
            { key: 'api', path: '/settings/integrations/api', labelKey: 'nav.apiManagement', perm: 'api.manage', module: 'developer' },
            // Ticket entegrasyonu: mevcut rota iki izinden birini kabul ediyordu.
            // Dis entegrasyonlar (LogiSlot vb.) YALNIZ ana destek tenant'inda
            // anlamli; talep agindaki diger saglayicilarda gizlenir.
            { key: 'tickets', path: '/settings/integrations/tickets', labelKey: 'nav.ticketIntegrations', perm: ['tickets.config.manage', 'tickets.admin'], module: 'tickets', requires: 'ticketIntegrations' },
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

const ALL_ON = () => true
// Yetenek haritasi verilmezse kisit yok (geriye uyumlu cagiranlar).
const capOk = (item, caps) => !item.requires || !caps || caps[item.requires] !== false
const moduleOk = (item, hasModule) => {
    if (!item.module) return true
    const mods = Array.isArray(item.module) ? item.module : [item.module]
    return mods.some((m) => hasModule(m))
}

/** Verilen `canAny(...perms)` + tenant modulleri (+ istege bagli yetenek
 *  haritasi `caps`, orn. `{ ticketIntegrations: false }`) ile GORUNUR
 *  bolumler (bos bolum dusurulur). `hasModule` verilmezse modul filtresi
 *  yok; `caps` verilmezse yetenek filtresi yok. */
export const visibleSections = (canAny, hasModule = ALL_ON, caps = null) =>
    SETTINGS_SECTIONS
        .map((s) => ({
            ...s,
            items: s.items.filter((i) => moduleOk(i, hasModule) && capOk(i, caps)
                && canAny(...permsOf(i))),
        }))
        .filter((s) => s.items.length > 0)

/** Kullanicinin ilk gorebilecegi ayar sayfasi; hicbiri yoksa null. */
export const firstSettingsPath = (canAny, hasModule = ALL_ON, caps = null) =>
    visibleSections(canAny, hasModule, caps)[0]?.items[0]?.path ?? null

/** Kenar cubugundaki tek "Ayarlar" ogesi icin: en az bir bolum var mi? */
export const hasAnySettings = (canAny, hasModule = ALL_ON, caps = null) =>
    firstSettingsPath(canAny, hasModule, caps) !== null
