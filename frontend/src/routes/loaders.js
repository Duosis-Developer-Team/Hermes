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
    timeEntry: () => import('../pages/TimeEntryPage'),
    tasks: () => import('../pages/TasksPage'),
    meetings: () => import('../pages/MeetingsPage'),
    dashboard: () => import('../pages/DashboardPage'),
    billableHours: () => import('../pages/BillableHoursPage'),
    reports: () => import('../pages/ReportsPage'),
    contracts: () => import('../pages/admin/ContractStatusPage'),
    users: () => import('../pages/admin/UsersPage'),
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
    '/time-entry': routeLoaders.timeEntry,
    '/project-management': routeLoaders.tasks,
    '/meetings': routeLoaders.meetings,
    '/developer': routeLoaders.developerPortal,
    '/tickets': routeLoaders.ticketHub,
    '/support': routeLoaders.supportPortal,
    '/ticket-integrations': routeLoaders.ticketIntegrations,
    '/dashboard': routeLoaders.dashboard,
    '/management/billable-hours': routeLoaders.billableHours,
    '/management/reports': routeLoaders.reports,
    '/management/contracts': routeLoaders.contracts,
    '/pm-configurations': routeLoaders.taskManagement,
    '/api-management': routeLoaders.apiManagement,
    '/customers': routeLoaders.customers,
    '/projects': routeLoaders.projects,
    '/work-types': routeLoaders.workTypes,
    '/activity-types': routeLoaders.activityTypes,
    '/platforms': routeLoaders.platforms,
    '/work-lines': routeLoaders.workLines,
    '/users': routeLoaders.users,
}
