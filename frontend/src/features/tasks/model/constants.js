/**
 * =============================================================================
 * HERMES - Tasks sabitleri (Sprint 5C)
 * =============================================================================
 * Secenek listeleri ve URL <-> state esleme tablolari. SAF VERI — React,
 * DOM veya API bagimliligi yok; hem sayfa hem componentler ayni kaynagi
 * okur, ikinci bir kopya olusmaz.
 * =============================================================================
 */

/*
 * KULLANICI KARARI (2026-08-05): `rejected` UGRUNDEN KALDIRILDI.
 * Atanmis bir is reddedilmez; akis Pending → In Progress → Completed.
 * Veritabanindaki CHECK kisiti DEGISTIRILMEDI (destructive migration
 * yok): gecmiste kalmis bir kayit varsa gecersiz hale gelmez, ekranda
 * Pending olarak gorunur ve kaybolmaz.
 */
export const STATUS_OPTIONS = [
    { value: 'pending', label: 'Pending' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
]

export const PRIORITY_OPTIONS = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'urgent', label: 'Urgent' },
]

// Scope (primary) — which pool of tasks we're looking at. Single-
// select. "Assigned by Me" stays hidden from users without assign
// permission (same gate as the legacy pill).
export const TASK_SCOPES = [
    { value: 'my-tasks', label: 'My Tasks' },
    { value: 'assigned-by-me', label: 'Assigned by Me', assignerOnly: true },
]

// Work item kinds — same board/list/comments/notifications; just a filter
// + colour cue. Colours mirror the per-card border accents (TaskCard.css).
export const TASK_TYPES = [
    { value: 'task', label: 'Tasks', singular: 'Task', color: '#388bff' },
    { value: 'issue', label: 'Issues', singular: 'Issue', color: '#f97316' },
    {
        value: 'suggestion',
        label: 'Suggestions',
        singular: 'Suggestion',
        color: '#a855f7',
    },
]

// Quick filters (secondary) — optional single-select chip on top of
// the scope. Clicking the active chip clears it.
export const TASK_QUICK_FILTERS = [
    { value: 'due-this-week', label: 'Due This Week' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'completed-this-week', label: 'Completed This Week' },
]

// Layout axis — the old Calendar (weekly) layout was removed as it was
// not usable for task management. Board is the default surface.
export const TASK_LAYOUTS = [
    { value: 'explorer', label: 'Explorer' },
    { value: 'board', label: 'Board' },
    { value: 'list', label: 'List' },
]

/** Tasks sayfasinin VARSAYILAN gorunumu (§6.1). Gecersiz/eski bir
 *  deger geldiginde de buraya duselir — Board gosterip hemen Explorer'a
 *  gecerek gorsel flash olusturulmaz. */
export const DEFAULT_TASK_LAYOUT = 'explorer'

export const isValidTaskLayout = (value) =>
    TASK_LAYOUTS.some((l) => l.value === value)

// Time range axis — 'all' (default): date-independent kanban showing
// every visible item regardless of dates. 'week': the classic weekly
// window, but windowed by DUE DATE (termin), not scheduled date.
export const TASK_RANGE_MODES = [
    { value: 'all', label: 'All' },
    { value: 'week', label: 'Weekly' },
]

// URL <-> state: the route segment is the plural ("/project-management/issues"),
// the internal taskType is the singular ("issue").
export const TYPE_TO_PLURAL = {
    task: 'tasks', issue: 'issues', suggestion: 'suggestions',
}
export const PLURAL_TO_TYPE = {
    tasks: 'task', issues: 'issue', suggestions: 'suggestion',
}
export const PM_BASE = '/project-management'

export const typeMetaFor = (taskType) =>
    TASK_TYPES.find((t) => t.value === taskType) || TASK_TYPES[0]
