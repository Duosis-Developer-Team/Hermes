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
    /** Time Entry'nin donem durumu ailesi — Tasks'tan Log Time sonrasi
     *  da tazelenir (ayni core_db kaydi yazilir). */
    periodStatus: { all: ['periodStatus'] },
    tasks: {
        all: ['tasks'],
        list: (filters) => ['tasks', 'list', stableFilters(filters)],
        detail: (id) => ['tasks', 'detail', id],
    },
    /** Gorev aktivite akisi (Review modal + yorum thread'i ayni aileyi
     *  tuketir; kok anahtar DEGISTIRILEMEZ). */
    taskActivity: {
        all: ['task-activity'],
        byTask: (taskId) => ['task-activity', taskId],
    },
    /** Alt projeler — Create modal ile Tasks filtre cubugu AYNI cache'i
     *  paylasir, bu yuzden anahtar birebir aynidir. */
    taskSubProjects: {
        all: ['task-sub-projects'],
        list: (customerId, projectId) =>
            ['task-sub-projects', customerId, projectId],
    },
    /** auth-service /users/lookup — iki ayri cagri sekli var. */
    authUsersLookup: {
        all: ['auth-users-lookup'],
        byIds: (ids) => ['auth-users-lookup', { ids }],
        activeUsers: () => ['auth-users-lookup', { include_inactive: false }],
    },
    /** DIKKAT: gercek anahtar 'task-permissions' (tire ile). Onceki
     *  ['taskPermissions'] degeri hicbir yerde kullanilmiyordu ve
     *  invalidation'i sessizce iskalardi. */
    taskPermissions: { all: ['task-permissions'] },
    // `all` = admin kullanici YONETIMI (zarfli, users.manage ister).
    // `lookup` = yalniz ad gostermek icin en az ayricalikli dizin
    // (duz dizi). Ayri anahtar SART: ayni anahtar altinda iki farkli
    // sekil birbirini ezer.
    users: { all: ['users'], lookup: ['users-lookup'] },
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
    dashboard: {
        all: ['dashboard'],
        /** Tarih araligi cache anahtarinin PARCASIDIR: aralik degisince
         *  ayri bir sorgu olur, geri donuste onceki sonuc hazir gelir. */
        range: (from, to) => ['dashboard', 'range', stableFilters({ from, to })],
    },
    reports: { all: ['reports'] },
    apiClients: { all: ['apiClients'] },
}
