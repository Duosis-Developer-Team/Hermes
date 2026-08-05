/**
 * =============================================================================
 * HERMES - Work item yasam dongusu (SAF)
 * =============================================================================
 * Active/Archive ekseni ve arsiv yetkisi TEK kaynakta. Bilesenler kendi
 * kurallarini yazmaz.
 *
 * ONEMLI: bu dosya bir GORUNURLUK/YETKI kopyasi degildir — arsiv
 * kosullari sunucuda YENIDEN dogrulanir (409/403). Buradaki kurallar
 * yalnizca "aksiyonu goster/gizle" icindir.
 * =============================================================================
 */

export const ARCHIVE_STATES = [
    { value: 'active', label: 'Active' },
    { value: 'archived', label: 'Archive' },
]

export const DEFAULT_ARCHIVE_STATE = 'active'

export const isValidArchiveState = (value) =>
    ARCHIVE_STATES.some((s) => s.value === value)

/** Terminal durumlar — arsivlenebilirligin on kosulu. */
export const TERMINAL_STATUSES = new Set(['completed', 'rejected'])

/**
 * Logical work item arsivlenebilir mi? (GORUNUM karari)
 * Butun gorunur assignment'lari terminal olmali. Sunucu ayrica TUM
 * assignment'lari ve Log Time kosulunu dogrular.
 */
export const isArchivable = (item) =>
    Boolean(item?.assignments?.length)
    && item.assignments.every((a) => TERMINAL_STATUSES.has(a.status))

/**
 * Arsivleme yetkisi: admin VEYA isin atayani. Normal assignee, yalnizca
 * kendisine atanmis olmasi nedeniyle arsivleyemez — backend'deki
 * kuralin AYNISI.
 */
export const canArchiveWorkItem = ({ item, currentUserId, isTaskAdmin = false }) => {
    if (!isArchivable(item)) return false
    if (isTaskAdmin) return true
    return String(item?.assignerUserId || '') === String(currentUserId || '')
}

/** Restore yetkisi arsivleme ile AYNI kapidan gecer. */
export const canRestoreWorkItem = ({ item, currentUserId, isTaskAdmin = false }) => {
    if (isTaskAdmin) return true
    return String(item?.assignerUserId || '') === String(currentUserId || '')
}

/** Arsiv gorunumu SALT OKUNURDUR: durum mutasyonu, surukleme ve
 *  olusturma kapali. Tek istisna acik "Restore and reopen" akisidir. */
export const isReadOnlyState = (archiveState) => archiveState === 'archived'
