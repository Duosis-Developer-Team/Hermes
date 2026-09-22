/**
 * =============================================================================
 * HERMES - Gruplama ve takvim yardimcilari (PM rework P3.5 / E1, E5)
 * =============================================================================
 * Liste yerlesiminde bolumler (proje · durum · sahip · termin) ve takvim
 * yerlesiminde gun kovalari. Mantiksal is (coklu atama = TEK kart)
 * gruplama modelinden gelir; burada ikinci bir gruplama YAZILMAZ.
 * SAF fonksiyonlar.
 * =============================================================================
 */
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'

import { groupIntoLogicalItems, userLabel } from './grouping'

dayjs.extend(isoWeek)

const STATUS_ORDER = { pending: 0, in_progress: 1, completed: 2, cancelled: 3, rejected: 4 }
const STATUS_LABEL = {
    pending: 'Pending', in_progress: 'In Progress', completed: 'Completed',
    cancelled: 'Cancelled', rejected: 'Rejected',
}
const DUE_ORDER = { overdue: 0, today: 1, week: 2, later: 3, none: 4 }

/** Termin kovasi: gecikmis · bugun · bu hafta · sonra · terminsiz. */
export function dueBucketOf(dueDate, today = dayjs()) {
    if (!dueDate) return 'none'
    const due = dayjs(dueDate)
    if (!due.isValid()) return 'none'
    const ref = dayjs(today).startOf('day')
    if (due.isBefore(ref, 'day')) return 'overdue'
    if (due.isSame(ref, 'day')) return 'today'
    if (due.isBefore(ref.endOf('isoWeek'), 'day') || due.isSame(ref.endOf('isoWeek'), 'day')) return 'week'
    return 'later'
}

const rawTasksOf = (items) => items.flatMap((i) => i.assignments.map((a) => a.task))

/**
 * Ham gorev satirlarini mantiksal ise indirger, gruplar ve her grubu
 * TasksListView'in bekledigi ham satirlara geri acar.
 * @returns [{ key, label, count, tasks }]
 */
export function partitionTasks(tasks, group, { userMap = {}, today = dayjs(), labels = {} } = {}) {
    const items = groupIntoLogicalItems(tasks || [], (id) => userLabel(id, userMap))
    if (!group || group === 'none') {
        return [{ key: 'all', label: null, count: items.length, tasks: rawTasksOf(items) }]
    }
    const buckets = new Map()
    const put = (key, label, order, item) => {
        if (!buckets.has(key)) buckets.set(key, { key, label, order, items: [] })
        buckets.get(key).items.push(item)
    }
    for (const item of items) {
        if (group === 'project') {
            const label = [item.customerName, item.projectName].filter(Boolean).join(' · ')
                || labels.noProject || '—'
            put(`p:${item.customerId || '-'}:${item.projectId || '-'}`, label, label, item)
        } else if (group === 'status') {
            const s = item.aggregateStatus || 'pending'
            put(`s:${s}`, labels.status?.[s] || STATUS_LABEL[s] || s, STATUS_ORDER[s] ?? 9, item)
        } else if (group === 'owner') {
            // Coklu atamali is HER sahibin altinda gorunur (kopya kart degil,
            // ayni mantiksal is iki bolumde).
            const seen = new Set()
            for (const a of item.assignments) {
                const id = a.assigneeUserId || '__none__'
                if (seen.has(id)) continue
                seen.add(id)
                const label = a.assigneeUserId ? userLabel(a.assigneeUserId, userMap) : (labels.noOwner || 'Unassigned')
                put(`o:${id}`, label, a.assigneeUserId ? label : '~', item)
            }
        } else if (group === 'due') {
            const b = dueBucketOf(item.dueDate, today)
            put(`d:${b}`, labels.due?.[b] || b, DUE_ORDER[b], item)
        }
    }
    return [...buckets.values()]
        .sort((a, b) => (typeof a.order === 'number' && typeof b.order === 'number')
            ? a.order - b.order
            : String(a.order).localeCompare(String(b.order), 'en'))
        .map((b) => ({ key: b.key, label: b.label, count: b.items.length, tasks: rawTasksOf(b.items) }))
}

/** Takvim: haftanin 7 gunu (ISO, Pazartesi). */
export function calendarDays(weekStart) {
    const start = dayjs(weekStart).startOf('isoWeek')
    return Array.from({ length: 7 }, (_, i) => start.add(i, 'day'))
}

/** Mantiksal isleri termine gore gunlere dagitir; hafta disi sayilir. */
export function tasksByDay(tasks, weekStart, { userMap = {} } = {}) {
    const items = groupIntoLogicalItems(tasks || [], (id) => userLabel(id, userMap))
    const days = calendarDays(weekStart)
    const from = days[0].format('YYYY-MM-DD')
    const to = days[6].format('YYYY-MM-DD')
    const byDay = Object.fromEntries(days.map((d) => [d.format('YYYY-MM-DD'), []]))
    let outside = 0
    let undated = 0
    for (const item of items) {
        if (!item.dueDate) { undated += 1; continue }
        const key = dayjs(item.dueDate).format('YYYY-MM-DD')
        if (key < from || key > to) { outside += 1; continue }
        byDay[key].push(item)
    }
    return { byDay, outside, undated }
}
