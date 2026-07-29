/**
 * =============================================================================
 * Sprint 5C — Tasks SAF MODEL birim testleri
 * =============================================================================
 * Entegrasyon testleri davranisi uctan uca kanitlar; bunlar cikarilan saf
 * fonksiyonlarin kendi sozlesmesini kilitler — kenar durumlar tum sayfayi
 * mount etmeden, milisaniyeler icinde.
 * =============================================================================
 */
import { describe, expect, it, afterEach, vi } from 'vitest'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'

import {
    currentWeekStart, dateKey, isoWeekWindow, quickFilterParams, todayKey,
    yesterdayKey,
} from '../../features/tasks/model/dates'
import { buildTaskListParams, scopeParams } from '../../features/tasks/model/taskQuery'
import {
    PLURAL_TO_TYPE, TASK_QUICK_FILTERS, TASK_SCOPES, TYPE_TO_PLURAL, typeMetaFor,
} from '../../features/tasks/model/constants'

dayjs.extend(isoWeek)

afterEach(() => vi.useRealTimers())

describe('dates — gun anahtarlari yerel kalir', () => {
    it('date-only string YEREL gun olarak okunur (UTC parse tuzagi yok)', () => {
        // `new Date('2026-03-01')` UTC gece yarisidir ve negatif offsette
        // 28 Subat'a duser. dateKey ayni gunu geri vermelidir.
        expect(dateKey('2026-03-01')).toBe('2026-03-01')
        expect(dateKey('2028-02-29')).toBe('2028-02-29')
        expect(dateKey('2026-12-31')).toBe('2026-12-31')
    })

    it('dun, ay/yil/artik-gun sinirlarini dogru gecer', () => {
        expect(yesterdayKey(dayjs('2026-03-01'))).toBe('2026-02-28')
        expect(yesterdayKey(dayjs('2028-03-01'))).toBe('2028-02-29')
        expect(yesterdayKey(dayjs('2027-01-01'))).toBe('2026-12-31')
        expect(todayKey(dayjs('2026-08-31'))).toBe('2026-08-31')
    })

    it('ISO hafta penceresi ay sonu / yil gecisi / artik gunde kirilmaz', () => {
        expect(isoWeekWindow(dayjs('2026-08-31').startOf('isoWeek')))
            .toEqual({ from: '2026-08-31', to: '2026-09-06' })
        expect(isoWeekWindow(dayjs('2026-12-30').startOf('isoWeek')))
            .toEqual({ from: '2026-12-28', to: '2027-01-03' })
        expect(isoWeekWindow(dayjs('2028-02-29').startOf('isoWeek')))
            .toEqual({ from: '2028-02-28', to: '2028-03-05' })
    })

    it('currentWeekStart her zaman PAZARTESIye hizalanir', () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2026-08-02T12:00:00Z')) // Pazar
        expect(currentWeekStart().format('YYYY-MM-DD')).toBe('2026-07-27')
        expect(currentWeekStart().format('ddd')).toBe('Mon')
    })
})

describe('quickFilterParams', () => {
    const weekStart = dayjs('2026-08-31').startOf('isoWeek')

    it('due-this-week: hafta penceresi + biten/reddedilen HARIC', () => {
        expect(quickFilterParams('due-this-week', { weekStart })).toEqual({
            due_from: '2026-08-31',
            due_to: '2026-09-06',
            status_exclude: ['completed', 'rejected'],
        })
    })

    it('overdue: due_to = DUN, tarih penceresi YOK', () => {
        const p = quickFilterParams('overdue', {
            weekStart, yesterday: '2026-08-30',
        })
        expect(p).toEqual({
            due_to: '2026-08-30',
            status_exclude: ['completed', 'rejected'],
        })
        expect(p.due_from).toBeUndefined()
    })

    it('completed-this-week: completed_* penceresi + statuses', () => {
        expect(quickFilterParams('completed-this-week', { weekStart })).toEqual({
            statuses: ['completed'],
            completed_from: '2026-08-31',
            completed_to: '2026-09-06',
        })
    })

    it('bilinmeyen/bos filtre null doner (pencere dusurulmez)', () => {
        expect(quickFilterParams(null, { weekStart })).toBeNull()
        expect(quickFilterParams('nope', { weekStart })).toBeNull()
    })
})

describe('scopeParams — kapsam sahipligi', () => {
    it('My Tasks → assignee, Assigned by Me → assigner', () => {
        expect(scopeParams('my-tasks', 'u1')).toEqual({ assignee_user_id: 'u1' })
        expect(scopeParams('assigned-by-me', 'u1'))
            .toEqual({ assigner_user_id: 'u1' })
    })

    it('kullanici cozulmemisken HICBIR sahiplik parametresi uretilmez', () => {
        // Fail-closed: bos kapsam, "herkesin gorevleri" anlamina gelecek
        // bir istek olusturmaz.
        expect(scopeParams('my-tasks', null)).toEqual({})
        expect(scopeParams('assigned-by-me', undefined)).toEqual({})
    })
})

describe('buildTaskListParams', () => {
    const weekStart = dayjs('2026-08-31').startOf('isoWeek')
    const base = { taskType: 'task', taskScope: 'my-tasks', viewedUserId: 'u1' }

    it('all modunda tarih penceresi YOKTUR', () => {
        const p = buildTaskListParams({ ...base, rangeMode: 'all', weekStart })
        expect(p).toEqual({
            status: undefined, priority: undefined, task_type: 'task',
            customer_id: undefined, project_id: undefined,
            sub_project_id: undefined, assignee_user_id: 'u1',
        })
    })

    it('week modunda pencere DUE DATE ile kurulur', () => {
        const p = buildTaskListParams({ ...base, rangeMode: 'week', weekStart })
        expect(p.due_from).toBe('2026-08-31')
        expect(p.due_to).toBe('2026-09-06')
        expect(p.scheduled_from).toBeUndefined()
    })

    it('hizli filtre varsa hafta penceresi DUSER (filtre kendi araligini getirir)', () => {
        const p = buildTaskListParams({
            ...base,
            rangeMode: 'week',
            weekStart,
            quickFilter: { due_to: '2026-08-30', status_exclude: ['completed'] },
        })
        expect(p.due_to).toBe('2026-08-30')
        expect(p.due_from).toBeUndefined()
    })

    it('bos filtreler undefined olur (istege hic gitmez)', () => {
        const p = buildTaskListParams({
            ...base, rangeMode: 'all', weekStart,
            statusFilter: null, customerFilter: '',
        })
        expect(p.status).toBeUndefined()
        expect(p.customer_id).toBeUndefined()
    })

    it('dolu filtreler AYNEN tasinir', () => {
        const p = buildTaskListParams({
            ...base, rangeMode: 'all', weekStart,
            statusFilter: 'completed', priorityFilter: 'urgent',
            customerFilter: 'c1', projectFilter: 'p1', subProjectFilter: 'sp1',
        })
        expect(p).toMatchObject({
            status: 'completed', priority: 'urgent',
            customer_id: 'c1', project_id: 'p1', sub_project_id: 'sp1',
        })
    })
})

describe('constants — URL <-> state eslemesi tutarli', () => {
    it('cogul ↔ tekil esleme cift yonlu kapalidir', () => {
        for (const [type, plural] of Object.entries(TYPE_TO_PLURAL)) {
            expect(PLURAL_TO_TYPE[plural]).toBe(type)
        }
    })

    it('"Assigned by Me" atama yetkisi isteyen TEK kapsamdir', () => {
        const assignerOnly = TASK_SCOPES.filter((s) => s.assignerOnly)
        expect(assignerOnly.map((s) => s.value)).toEqual(['assigned-by-me'])
    })

    it('her hizli filtrenin model karsiligi vardir', () => {
        for (const f of TASK_QUICK_FILTERS) {
            expect(
                quickFilterParams(f.value, {
                    weekStart: dayjs('2026-08-31').startOf('isoWeek'),
                    yesterday: '2026-08-30',
                })
            ).not.toBeNull()
        }
    })

    it('bilinmeyen tur ilk (task) meta’sina duser', () => {
        expect(typeMetaFor('task').value).toBe('task')
        expect(typeMetaFor('issue').value).toBe('issue')
        expect(typeMetaFor('bilinmeyen').value).toBe('task')
    })
})
