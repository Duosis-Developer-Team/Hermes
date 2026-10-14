/**
 * =============================================================================
 * HERMES - Tenant modul katalogu (frontend aynasi)
 * =============================================================================
 * Tek kaynak: backend/shared/modules.py (parite testi bu dosyayi okur).
 * Modul = "bu tenant'ta bu bolum var mi". Kapali modul arayuzde HIC
 * gorunmez (menu, rota, dock eylemi, ana sayfa blogu, ayar bolumu, kabuk
 * acilis cagrilari); sunucu da ayni uclari 404/izinsiz dondurur.
 *
 * Tenant `modules` alanini tasimiyorsa (eski oturum yaniti) TUM moduller
 * acik sayilir — guvenlik karari sunucudadir, arayuz yalniz gizler.
 * =============================================================================
 */

export const MODULES = {
    time_entry: { labelKey: 'modules.time_entry', path: '/time-entry' },
    work: { labelKey: 'modules.work', path: '/project-management' },
    meetings: { labelKey: 'modules.meetings', path: '/meetings' },
    tickets: { labelKey: 'modules.tickets', path: '/tickets' },
    reports: { labelKey: 'modules.reports', path: '/dashboard' },
    developer: { labelKey: 'modules.developer', path: '/developer' },
}

export const MODULE_CODES = Object.keys(MODULES)

/** Bir modul ancak bunlar da aciksa acilabilir (sunucuyla ayni kural). */
export const MODULE_REQUIRES = {
    reports: ['time_entry'],
}

/** Izin → modul (listede olmayan izin cekirdektir). */
export const PERMISSION_MODULE = {
    'worklogs.admin': 'time_entry',
    'reference.manage': 'time_entry',
    'tasks.access': 'work',
    'tasks.assign': 'work',
    'issues.access': 'work',
    'issues.assign': 'work',
    'tasks.admin': 'work',
    'tasks.permissions.manage': 'work',
    'meetings.admin': 'meetings',
    'tickets.access': 'tickets',
    'tickets.create': 'tickets',
    'tickets.respond': 'tickets',
    'tickets.resolve': 'tickets',
    'tickets.assign': 'tickets',
    'tickets.view_all': 'tickets',
    'tickets.admin': 'tickets',
    'tickets.config.manage': 'tickets',
    'reports.view': 'reports',
    'api.manage': 'developer',
}

/** Tenant'in acik modulleri (dizi yoksa: hepsi). */
export function enabledModules(tenant) {
    const mods = tenant?.modules
    return Array.isArray(mods) ? mods : MODULE_CODES
}

export function tenantHasModule(tenant, code) {
    return enabledModules(tenant).includes(code)
}

/**
 * Kullaniciya acik mi? Tenant modulleri TAVAN; erisim profili (auth 0007)
 * yuklendiyse onun etkin modulleriyle kesisir. Sirket hesabinda profil
 * yoksa hicbir modul acik sayilmaz (fail-closed).
 */
export function userHasModule(tenant, access, code) {
    if (!tenantHasModule(tenant, code)) return false
    if (Array.isArray(access?.modules)) return access.modules.includes(code)
    return access?.account_kind !== 'company'
}

/**
 * Oturum acilinca / izinsiz bir rotadan donuste nereye gidilir?
 * Eskiden sabit `/time-entry` idi; artik tenant'in ACIK ilk modulu.
 * Hic modul yoksa ana sayfa (cekirdek).
 */
export function landingPath(tenant, access = null) {
    // Sirket hesabi yalniz talep portalini kullanir.
    if (access?.account_kind === 'company') return '/support'
    const first = MODULE_CODES.find((c) => userHasModule(tenant, access, c))
    if (first === 'tickets') return '/tickets'
    return first ? MODULES[first].path : '/'
}
