/**
 * =============================================================================
 * HERMES - Route module loader'lari (Sprint 1, CTO paketi §5)
 * =============================================================================
 * Her route/feature siniri icin TEK loader fonksiyonu. Ayni loader hem
 * React.lazy'ye verilir hem de (Sprint 3'te) hover/focus prefetch icin
 * yeniden kullanilir — iki ayri import yolu olusmaz, chunk teklesir.
 * Kucuk bilesenler ayri chunk YAPILMAZ; sinirlar route/feature duzeyinde.
 */

export const routeLoaders = {
    login: () => import('../pages/LoginPage'),
    // WS9: Platform konsolu AYRI bir chunk. Normal tenant
    // kullanicisi bu kodu HIC indirmez.
    platformConsole: () => import('../pages/platform/PlatformConsole'),
    authCallback: () => import('../pages/AuthCallbackPage'),
    // PM rework P3: ana sayfa (`/`) ve `/work/:key` derin baglantisi.
    home: () => import('../pages/HomePage'),
    workLink: () => import('../pages/WorkLinkPage'),
    timeEntry: () => import('../pages/TimeEntryPage'),
    tasks: () => import('../pages/TasksPage'),
    meetings: () => import('../pages/MeetingsPage'),
    dashboard: () => import('../pages/DashboardPage'),
    billableHours: () => import('../pages/BillableHoursPage'),
    reports: () => import('../pages/ReportsPage'),
    contracts: () => import('../pages/admin/ContractStatusPage'),
    users: () => import('../pages/admin/UsersPage'),
    // PM rework P0 / D1: kapasite ayarlari (Ayarlar > Organizasyon).
    capacitySettings: () => import('../pages/admin/CapacitySettingsPage'),
    // B1: tek /settings kabugu; ayar sayfalari onun altinda acilir.
    settings: () => import('../pages/settings/SettingsPage'),
    customers: () => import('../pages/admin/CustomersPage'),
    projects: () => import('../pages/admin/ProjectsPage'),
    workTypes: () => import('../pages/admin/WorkTypesPage'),
    activityTypes: () => import('../pages/ActivityTypesPage'),
    platforms: () => import('../pages/PlatformsPage'),
    workLines: () => import('../pages/WorkLinesPage'),
    taskManagement: () => import('../pages/admin/TaskManagementPage'),
    apiManagement: () => import('../pages/admin/ApiManagementPage'),
    developerPortal: () => import('../pages/developer/DeveloperPortalPage'),
    // Ticket Hub: iki AYRI chunk. Musteri portali kullanicisi
    // agent hub kodunu HIC indirmez (ve tersi).
    ticketHub: () => import('../pages/tickets/TicketHubPage'),
    supportPortal: () => import('../pages/tickets/SupportPortalPage'),
    ticketIntegrations: () =>
        import('../pages/tickets/TicketIntegrationsPage'),
}

/** Nav path'i → loader (Sprint 3 hover/focus prefetch). YALNIZCA kodu
 *  indirir — API verisi cekmez; menu zaten izin-filtreli oldugu icin
 *  izinsiz route prefetch'i yapisal olarak imkansiz. */
export const loaderByPath = {
    '/': routeLoaders.home,
    '/time-entry': routeLoaders.timeEntry,
    '/project-management': routeLoaders.tasks,
    '/meetings': routeLoaders.meetings,
    '/developer': routeLoaders.developerPortal,
    '/tickets': routeLoaders.ticketHub,
    '/support': routeLoaders.supportPortal,
    '/dashboard': routeLoaders.dashboard,
    '/management/billable-hours': routeLoaders.billableHours,
    '/management/reports': routeLoaders.reports,
    '/management/contracts': routeLoaders.contracts,
    // B1: ayar sayfalari /settings altinda; eski adresler Navigate ile
    // yeni yola gider, prefetch yalnizca YENI yollari isitir.
    '/settings': routeLoaders.settings,
    '/settings/organization/users': routeLoaders.users,
    '/settings/organization/capacity': routeLoaders.capacitySettings,
    '/settings/work/pm': routeLoaders.taskManagement,
    '/settings/reference/work-types': routeLoaders.workTypes,
    '/settings/reference/activity-types': routeLoaders.activityTypes,
    '/settings/reference/platforms': routeLoaders.platforms,
    '/settings/reference/work-lines': routeLoaders.workLines,
    '/settings/customers/customers': routeLoaders.customers,
    '/settings/customers/projects': routeLoaders.projects,
    '/settings/integrations/api': routeLoaders.apiManagement,
    '/settings/integrations/tickets': routeLoaders.ticketIntegrations,
}
