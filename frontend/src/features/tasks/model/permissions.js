/**
 * =============================================================================
 * HERMES - Tasks izin selector'lari (Sprint 5, CTO paketi §4)
 * =============================================================================
 * UI izin kararlarinin TEK katmani. Saf fonksiyonlar — DOM/React yok,
 * dogrudan test edilebilir. Mantik TasksPage'den BIREBIR cikarildi;
 * davranis characterization testleriyle kilitli.
 *
 * ONEMLI: bunlar YALNIZCA arayuz kararlaridir. Backend authorization
 * yerine GECMEZ — sunucu her istekte kendi kontrolunu yapar (kilit:
 * public API scope+binding katmani ve core RBAC guard'lari).
 *
 * Kaynak veri: useTaskPermissions() → { isTaskAdmin, canAccessAny,
 * scopes: { task: {...}, issue: {...} } }. 'issue' scope'u hem issue
 * hem suggestion turunu kapsar (mevcut kural).
 */

/** Aktif is-turu → izin scope'u. issue + suggestion AYNI scope'u paylasir. */
export const permScopeFor = (taskType) => (taskType === 'task' ? 'task' : 'issue')

/** Bir scope'un ham izin nesnesi (yoksa task scope'una duser — mevcut
 *  davranis; sonra bos nesne). */
export const scopePerms = (scopes, taskType) => {
    const key = permScopeFor(taskType)
    return scopes?.[key] || scopes?.task || {}
}

/**
 * Ekranin ihtiyac duydugu TUM izin kararlari tek yerden.
 * FAIL-CLOSED: scopes henuz yuklenmediyse (undefined/null) her sey false —
 * izin flash'i ile yetkisiz kontrol gorunmez (§4 kurali).
 */
export function selectTaskPermissions({
    scopes, isTaskAdmin = false, canAccessAny = false, taskType = 'task',
    createType = null,
} = {}) {
    const active = scopePerms(scopes, taskType)
    const create = createType
        ? (scopes?.[permScopeFor(createType)] || {})
        : active

    const canAssign = !!active.canAssign
    return {
        // Route/menu gorunurlugu
        canAccessTasks: !!canAccessAny,
        canAccessScope: !!active.canAccess,
        // Atama yetkisi ve aday listeleri (hiyerarsi kaynakli)
        canAssignTasks: canAssign,
        assignableUserIds: active.assignableUserIds || [],
        assignableGroupIds: active.assignableGroupIds || [],
        // Create modal'i OLUSTURULAN turun scope'unu kullanir (goruntulenen
        // turden farkli olabilir: Tasks sekmesindeyken "+ New Issue").
        createAssignableUserIds: create.assignableUserIds || [],
        createAssignableGroupIds: create.assignableGroupIds || [],
        // "Assigned by Me" admin VEYA aktif scope'ta atama yetkisi ister.
        canViewAssignedByMe: !!isTaskAdmin || canAssign,
        // Yalnizca admin baska kullanici goruntuleyebilir.
        canSelectUser: !!isTaskAdmin,
        isTaskAdmin: !!isTaskAdmin,
    }
}

/** Goruntulenen kullanici: admin secebilir, digerleri HER KOSULDA kendisi.
 *  (Backend de ayni sekilde zorlar — derinlemesine savunma.) */
export const resolveViewedUserId = ({ isTaskAdmin, selectedUserId, currentUserId }) =>
    isTaskAdmin ? (selectedUserId || currentUserId) : currentUserId

