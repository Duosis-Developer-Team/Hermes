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

/**
 * TEK GOREV uzerinde durum degistirme yetkisi (kabul / tamamla / yeniden
 * ac / board surukle-birak). Backend'in uyguladigi kuralin AYNISI:
 * admin VEYA atanan VEYA atayan.
 *
 * Sprint 5C bulgusu: bu ifade DORT ayri dosyada elle tekrarlanmisti
 * (board surukleme gate'i, list checkbox'i, sayfanin drop guard'i ve
 * Review modalinin canAct'i). Ayni kuralin dort kopyasi = permissions
 * katmanini asan IKINCI bir RBAC sistemi. Artik tek kaynak burasi.
 *
 * FAIL-CLOSED: gorev veya kullanici cozulmemisse yetki YOKTUR.
 * UI kararidir; sunucu her istekte kendi kontrolunu yapar.
 */
export const canChangeTaskStatus = ({ task, currentUserId, isTaskAdmin = false }) => {
    if (!task) return false
    if (isTaskAdmin) return true
    if (!currentUserId) return false
    return (
        task.assignee_user_id === currentUserId ||
        task.assigner_user_id === currentUserId
    )
}

/**
 * Board'da bir kartin SURUKLENEBILIR olup olmadigi. Iki kosul birlikte:
 *  - gorunum surukleme destekliyor mu (`allowStatusDrag`) — durum
 *    degisikligi atananin kendi "My Tasks" gorunumune aittir; "Assigned
 *    by Me" salt izlemedir,
 *  - kullanici BU gorevin durumunu degistirebiliyor mu.
 */
export const canDragTaskStatus = ({ allowStatusDrag, task, currentUserId, isTaskAdmin }) =>
    !!allowStatusDrag && canChangeTaskStatus({ task, currentUserId, isTaskAdmin })

/**
 * Gorevin CEKIRDEK alanlarini duzenleme / silme yetkisi: admin VEYA
 * gorevi ATAYAN. (Atanan isi yapar, tanimini degistirmez.) Bu kural da
 * TaskCard ve TasksListView'de ayri ayri yazilmisti — tek kaynak burasi.
 */
export const canEditTask = ({ task, currentUserId, isTaskAdmin = false }) => {
    if (!task) return false
    if (isTaskAdmin) return true
    if (!currentUserId) return false
    return task.assigner_user_id === currentUserId
}


/**
 * Bu satir kullanicinin KENDI atamasi mi?
 *
 * Coklu atamali bir logical work item'da "kimin durumu degisecek"
 * sorusu bir YETKI sorusudur; sayfa veya hook icinde ham alan
 * karsilastirmasi yapmak izin katmanini asan ikinci bir kural olurdu
 * (kilit: featureStructure "durum degistirme kurali TEK yerde").
 */
export const isOwnAssignment = ({ task, currentUserId }) =>
    Boolean(task?.assignee_user_id) && task.assignee_user_id === currentUserId
