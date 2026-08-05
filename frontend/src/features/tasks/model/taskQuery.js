/**
 * =============================================================================
 * HERMES - Tasks liste sorgusu modeli (Sprint 5C)
 * =============================================================================
 * "Ekrandaki durum → liste ucunun parametreleri" donusumunun TEK yeri.
 * Saf fonksiyon: ayni girdi her zaman ayni payload'i uretir, componentte
 * dagitilmis ad-hoc normalizasyon YOKTUR (§4 adapter/selector kurali).
 * =============================================================================
 */
import { isoWeekWindow } from './dates'

/**
 * Kapsam → backend sahibi parametresi.
 * "My Tasks"       → bana ATANAN isler
 * "Assigned by Me" → benim ATADIGIM isler (salt izleme)
 */
export const scopeParams = (taskScope, viewedUserId) => {
    if (!viewedUserId) return {}
    return taskScope === 'assigned-by-me'
        ? { assigner_user_id: viewedUserId }
        : { assignee_user_id: viewedUserId }
}

/**
 * Aktif gorunumu liste-ucu parametrelerine cevirir.
 *
 * Oncelik sirasi (mevcut urun davranisi):
 *  1. Hizli filtre varsa tarih penceresi DUSURULUR — filtre kendi
 *     araligini getirir.
 *  2. Weekly modda pencere DUE DATE (termin) ile kurulur; scheduled
 *     tarihiyle DEGIL.
 *  3. 'all' modunda tarihten bagimsiz kanban: her gorunur kayit.
 */
export function buildTaskListParams({
    taskType,
    statusFilter = null,
    priorityFilter = null,
    customerFilter = null,
    projectFilter = null,
    subProjectFilter = null,
    taskScope,
    viewedUserId,
    rangeMode = 'all',
    weekStart,
    quickFilter = null,
    archiveState = 'active',
}) {
    const base = {
        status: statusFilter || undefined,
        priority: priorityFilter || undefined,
        task_type: taskType,
        customer_id: customerFilter || undefined,
        project_id: projectFilter || undefined,
        sub_project_id: subProjectFilter || undefined,
        ...scopeParams(taskScope, viewedUserId),
        // Arsiv havuzu sorgu anahtarinin PARCASIDIR: Active ve Archive
        // cache'leri birbirine karismaz.
        archive_state: archiveState,
    }
    if (quickFilter) return { ...base, ...quickFilter }
    if (rangeMode === 'week') {
        const week = isoWeekWindow(weekStart)
        return { ...base, due_from: week.from, due_to: week.to }
    }
    return base
}
