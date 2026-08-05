/**
 * =============================================================================
 * HERMES - Gorev son tarih siniflandirmasi (Sprint 7)
 * =============================================================================
 * Saf fonksiyon; component dosyasindan AYRI tutulur cunku bir modul hem
 * component hem yardimci export ederse fast-refresh sozlesmesi bozulur
 * (React Fast Refresh o modulu guvenle degistiremez). Ayni karar
 * `adminEmptyText` icin de verilmisti.
 *
 * Davranis DEGISMEDI — kod aynen tasindi.
 * =============================================================================
 */
import dayjs from 'dayjs'

/**
 * Returns the due-date severity bucket for a task, or null when the
 * task does not warrant any badge. Completed tasks never
 * surface as overdue — they're done business, the due date is moot.
 *
 * Exposed for reuse by list and board views.
 */
export function taskDueState(task) {
    if (!task?.due_date) return null
    if (task.status === 'completed') return null
    const today = dayjs().startOf('day')
    const due = dayjs(task.due_date).startOf('day')
    const diffDays = due.diff(today, 'day')
    if (diffDays < 0) return 'overdue'
    if (diffDays === 0) return 'due_today'
    if (diffDays <= 2) return 'due_soon'
    return null
}
