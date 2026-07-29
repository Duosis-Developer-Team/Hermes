/**
 * =============================================================================
 * HERMES - Query key factory (Sprint 1, CTO paketi §8)
 * =============================================================================
 * TanStack Query anahtarlarinin TEK kaynagi. Ham string array'ler feature
 * koduna dagilmaz; invalidation HEP v5 object syntax ile yapilir:
 *
 *   queryClient.invalidateQueries({ queryKey: queryKeys.workLogs.all })
 *
 * NOT (Sprint 1 bulgusu): v5'te eski dizi-bicim `invalidateQueries(['x'])`
 * ilk argumani FILTRE sanir ve queryKey filtresi olmadigi icin TUM
 * cache'i invalid ederdi — "geniş invalidation" probleminin kokeni buydu.
 * Bu factory'ye gecis ayni zamanda o davranis hatasinin duzeltmesidir.
 */

/** Filtre objelerini deterministik hale getirir: undefined/'' atilir,
 *  anahtarlar siralanir, Date -> ISO. Ayni mantiksal filtre her zaman
 *  ayni cache anahtarini uretir. */
export const stableFilters = (value) =>
    Object.fromEntries(
        Object.entries(value ?? {})
            .filter(([, v]) => v !== undefined && v !== '')
            .map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])
            .sort(([a], [b]) => a.localeCompare(b)),
    )

export const queryKeys = {
    workLogs: {
        all: ['workLogs'],
        list: (filters) => ['workLogs', 'list', stableFilters(filters)],
    },
    planTimes: {
        all: ['planTimes'],
        list: (filters) => ['planTimes', 'list', stableFilters(filters)],
    },
    periods: { all: ['periods'] },
    tasks: {
        all: ['tasks'],
        list: (filters) => ['tasks', 'list', stableFilters(filters)],
        detail: (id) => ['tasks', 'detail', id],
    },
    taskPermissions: { all: ['taskPermissions'] },
    users: { all: ['users'] },
    userGroups: { all: ['userGroups'] },
    rbacRoles: {
        all: ['rbac-roles'],
        active: ['rbac-roles-active'],
        catalog: ['rbac-catalog'],
    },
    customers: { all: ['customers'] },
    projects: { all: ['projects'] },
    workTypes: { all: ['workTypes'] },
    workLines: { all: ['workLines'] },
    platforms: { all: ['platforms'] },
    activityTypes: { all: ['activityTypes'] },
    meetings: { all: ['meetings'] },
    dashboard: { all: ['dashboard'] },
    reports: { all: ['reports'] },
    apiClients: { all: ['apiClients'] },
}
