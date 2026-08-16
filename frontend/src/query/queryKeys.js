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


/**
 * -----------------------------------------------------------------------
 * WS8 — Tenant kapsami
 * -----------------------------------------------------------------------
 * Her anahtarin BASINA aktif tenant girer. Neden: cok-tenantli bir
 * oturumda organizasyon degistirmek, onceki tenant'in cache'lenmis
 * yanitlarini yeni tenant'in ekraninda gosterme riski tasir. Anahtar
 * uzayini tenant'a gore bolmek, o riski YAPISAL olarak ortadan
 * kaldirir: A'nin `['t', A, 'tasks', ...]` girisi B baglaminda
 * OKUNAMAZ, cunku B'nin anahtari farklidir.
 *
 * Tenant degisiminde cache ayrica temizlenir (bkz. stores/authStore.js
 * `switchTenant`); ikisi birbirinin yedegidir — biri kacirsa digeri
 * tutar.
 *
 * Anahtarlar GETTER olarak tanimlidir: cagri yerleri
 * `queryKeys.customers.all` yazmaya devam eder, ama deger her
 * erisimde GUNCEL tenant ile uretilir. Boylece 200'den fazla cagri
 * noktasini degistirmeye gerek kalmaz.
 */
let _tenantScope = 'anon'

/** Aktif tenant kapsamini ayarlar (login / tenant switch / logout). */
export const setTenantScope = (tenantId) => {
    _tenantScope = tenantId ? String(tenantId) : 'anon'
}

export const getTenantScope = () => _tenantScope

/** Anahtarin basina tenant kapsamini ekler. */
const k = (...parts) => ['t', _tenantScope, ...parts]

export const queryKeys = {
    workLogs: {
        get all() { return k('workLogs') },
        list: (filters) => k('workLogs', 'list', stableFilters(filters)),
    },
    planTimes: {
        get all() { return k('planTimes') },
        list: (filters) => k('planTimes', 'list', stableFilters(filters)),
    },
    periods: { get all() { return k('periods') } },
    /** Time Entry'nin donem durumu ailesi — Tasks'tan Log Time sonrasi
     *  da tazelenir (ayni core_db kaydi yazilir). */
    periodStatus: { get all() { return k('periodStatus') } },
    /** Work item lifecycle (otomatik arsiv) politikasi — tekil ayar. */
    taskLifecyclePolicy: { get all() { return k('task-lifecycle-policy') } },
    tasks: {
        get all() { return k('tasks') },
        list: (filters) => k('tasks', 'list', stableFilters(filters)),
        detail: (id) => k('tasks', 'detail', id),
    },
    /** Gorev aktivite akisi (Review modal + yorum thread'i ayni aileyi
     *  tuketir; kok anahtar DEGISTIRILEMEZ). */
    taskActivity: {
        get all() { return k('task-activity') },
        byTask: (taskId) => k('task-activity', taskId),
    },
    /** Alt projeler — Create modal ile Tasks filtre cubugu AYNI cache'i
     *  paylasir, bu yuzden anahtar birebir aynidir. */
    taskSubProjects: {
        get all() { return k('task-sub-projects') },
        list: (customerId, projectId) => k('task-sub-projects', customerId, projectId),
    },
    /** auth-service /users/lookup — iki ayri cagri sekli var. */
    authUsersLookup: {
        get all() { return k('auth-users-lookup') },
        byIds: (ids) => k('auth-users-lookup', { ids }),
        activeUsers: () => k('auth-users-lookup', { include_inactive: false }),
    },
    /** DIKKAT: gercek anahtar 'task-permissions' (tire ile). Onceki
     *  ['taskPermissions'] degeri hicbir yerde kullanilmiyordu ve
     *  invalidation'i sessizce iskalardi. */
    taskPermissions: { get all() { return k('task-permissions') } },
    // `all` = admin kullanici YONETIMI (zarfli, users.manage ister).
    // `lookup` = yalniz ad gostermek icin en az ayricalikli dizin
    // (duz dizi). Ayri anahtar SART: ayni anahtar altinda iki farkli
    // sekil birbirini ezer.
    users: {
        get all() { return k('users') },
        get lookup() { return k('users-lookup') },
    },
    userGroups: { get all() { return k('userGroups') } },
    rbacRoles: {
        get all() { return k('rbac-roles') },
        get active() { return k('rbac-roles-active') },
        get catalog() { return k('rbac-catalog') },
    },
    customers: { get all() { return k('customers') } },
    projects: { get all() { return k('projects') } },
    workTypes: { get all() { return k('workTypes') } },
    workLines: { get all() { return k('workLines') } },
    platforms: { get all() { return k('platforms') } },
    activityTypes: { get all() { return k('activityTypes') } },
    meetings: { get all() { return k('meetings') } },
    dashboard: {
        get all() { return k('dashboard') },
        /** Tarih araligi cache anahtarinin PARCASIDIR: aralik degisince
         *  ayri bir sorgu olur, geri donuste onceki sonuc hazir gelir. */
        range: (from, to) => k('dashboard', 'range', stableFilters({ from, to })),
    },
    reports: { get all() { return k('reports') } },
    apiClients: { get all() { return k('apiClients') } },
}
