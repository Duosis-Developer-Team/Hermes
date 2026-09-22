/**
 * =============================================================================
 * PM rework P3.5 — gorunum modeli (saf)
 * =============================================================================
 *   1. Sistem gorunumu → sorgu girdileri (kapsam/tip/termin/sahipsiz).
 *   2. Kayitli satir normalize edilir; bilinmeyen kimlik varsayilana duser;
 *      atama yetkisi yoksa "Assigned by Me" gorunmez ve cozulmez.
 *   3. Sapma (dirty): filtre, yerlesim ya da gruplama gorunumden ayrilinca.
 *   4. filter_json: bos degerler yazilmaz; gruplama icinde tasinir.
 *   5. Gruplama/takvim yardimcilari: proje · durum · sahip · termin.
 * =============================================================================
 */
import { describe, expect, it } from 'vitest'
import dayjs from 'dayjs'

import {
    EMPTY_FILTERS, filtersOfView, isViewDirty, normalizeSavedView, resolveView,
    systemViewsFor, toFilterJson, viewQueryInputs, createTypeOfView,
} from '../../features/tasks/model/views'
import { dueBucketOf, partitionTasks, tasksByDay } from '../../features/tasks/model/viewGroups'

const WEEK = dayjs('2026-09-14')

describe('viewQueryInputs', () => {
    it('mine: kendi isleri, tum turler, termin filtresi yok', () => {
        const v = resolveView('mine')
        expect(viewQueryInputs(v, { weekStart: WEEK, yesterday: '2026-09-15' })).toEqual({
            taskType: null, taskScope: 'my-tasks', scopeAll: false, unassigned: false,
            quickFilter: null, rangeMode: 'all',
        })
    })
    it('triage: gorunur kume + sahipsiz (E3)', () => {
        const q = viewQueryInputs(resolveView('triage'), { weekStart: WEEK, yesterday: '2026-09-15' })
        expect(q.scopeAll).toBe(true)
        expect(q.unassigned).toBe(true)
    })
    it('overdue / due-this-week / completed-this-week hazir parametre verir', () => {
        const y = '2026-09-15'
        expect(viewQueryInputs(resolveView('overdue'), { weekStart: WEEK, yesterday: y }).quickFilter)
            .toEqual({ due_to: y, status_exclude: ['completed'] })
        expect(viewQueryInputs(resolveView('due-this-week'), { weekStart: WEEK, yesterday: y }).quickFilter)
            .toEqual({ due_from: '2026-09-14', due_to: '2026-09-20', status_exclude: ['completed'] })
        expect(viewQueryInputs(resolveView('completed-this-week'), { weekStart: WEEK, yesterday: y }).quickFilter)
            .toEqual({ statuses: ['completed'], completed_from: '2026-09-14', completed_to: '2026-09-20' })
    })
    it('issues: tip filtresi + gorunur kume; olusturma turu issue', () => {
        const v = resolveView('issues')
        expect(viewQueryInputs(v, { weekStart: WEEK }).taskType).toBe('issue')
        expect(createTypeOfView(v)).toBe('issue')
        expect(createTypeOfView(resolveView('mine'))).toBe('task')
    })
})

describe('resolveView / systemViewsFor', () => {
    it('atama yetkisi yoksa Assigned by Me listelenmez ve varsayilana duser', () => {
        expect(systemViewsFor({ canViewAssignedByMe: false }).map((v) => v.id)).not.toContain('assigned-by-me')
        expect(resolveView('assigned-by-me', [], { canViewAssignedByMe: false }).id).toBe('mine')
        expect(resolveView('assigned-by-me', [], { canViewAssignedByMe: true }).id).toBe('assigned-by-me')
    })
    it('kayitli gorunum cozulur; bilinmeyen kimlik varsayilana duser', () => {
        const saved = normalizeSavedView({
            id: 'v1', name: 'Vakko', scope: 'personal', layout: 'list', can_edit: true,
            filter_json: { scope: 'all', customer_id: 'c1', group_by: 'due', due: 'overdue' },
        })
        expect(saved).toMatchObject({ id: 'v1', saved: true, defaultLayout: 'list', defaultGroup: 'due', canEdit: true })
        expect(resolveView('v1', [saved]).name).toBe('Vakko')
        expect(resolveView('nope', [saved]).id).toBe('mine')
        expect(filtersOfView(saved)).toEqual({ ...EMPTY_FILTERS, customer: 'c1' })
        expect(viewQueryInputs(saved, { weekStart: WEEK, yesterday: 'y' })).toMatchObject({ scopeAll: true })
    })
})

describe('isViewDirty / toFilterJson', () => {
    it('sistem gorunumu: varsayilan yerlesim + bos filtre = temiz', () => {
        const v = resolveView('mine')
        expect(isViewDirty(v, { filters: EMPTY_FILTERS, layout: 'board', group: 'status' })).toBe(false)
        expect(isViewDirty(v, { filters: { ...EMPTY_FILTERS, status: 'pending' }, layout: 'board', group: 'status' })).toBe(true)
        expect(isViewDirty(v, { filters: EMPTY_FILTERS, layout: 'list', group: 'project' })).toBe(true)
        expect(isViewDirty(v, { filters: EMPTY_FILTERS, layout: 'board', group: 'owner' })).toBe(true)
    })
    it('kayitli gorunum kendi filtre/yerlesimiyle temiz', () => {
        const saved = normalizeSavedView({
            id: 'v1', name: 'x', scope: 'personal', layout: 'list',
            filter_json: { scope: 'my-tasks', status: 'pending', group_by: 'owner' },
        })
        expect(isViewDirty(saved, { filters: { ...EMPTY_FILTERS, status: 'pending' }, layout: 'list', group: 'owner' })).toBe(false)
        expect(isViewDirty(saved, { filters: { ...EMPTY_FILTERS, status: 'pending' }, layout: 'list', group: 'due' })).toBe(true)
    })
    it('filter_json bos degerleri yazmaz, gorunum eksenini + gruplamayi tasir', () => {
        const json = toFilterJson(resolveView('overdue'), {
            filters: { ...EMPTY_FILTERS, customer: 'c1', priority: 'high' }, group: 'project',
        })
        expect(json).toEqual({ scope: 'my-tasks', due: 'overdue', priority: 'high', customer_id: 'c1', group_by: 'project' })
    })
})

describe('gruplama ve takvim (viewGroups)', () => {
    let n = 0
    const task = (over = {}) => ({
        id: `t${++n}`, title: `T${n}`, customer_id: 'c1', customer_name: 'Vakko', project_id: 'p1',
        project_name: 'ATM', assignee_user_id: 'u1', status: 'pending', due_date: null,
        assignment_batch_id: null, ...over,
    })
    const USERS = { u1: { full_name: 'Ada' }, u2: { full_name: 'Bob' } }

    it('dueBucketOf', () => {
        const today = dayjs('2026-09-16')
        expect(dueBucketOf('2026-09-10', today)).toBe('overdue')
        expect(dueBucketOf('2026-09-16', today)).toBe('today')
        expect(dueBucketOf('2026-09-19', today)).toBe('week')
        expect(dueBucketOf('2026-09-30', today)).toBe('later')
        expect(dueBucketOf(null, today)).toBe('none')
    })

    it('proje / durum / sahip / termin bolumleri; coklu atama tek is, iki sahipte', () => {
        n = 0
        const tasks = [
            task(), task({ project_id: 'p2', project_name: 'Portal', status: 'in_progress' }),
            task({ assignee_user_id: 'u1', assignment_batch_id: 'b', due_date: '2026-09-10' }),
            task({ assignee_user_id: 'u2', assignment_batch_id: 'b', due_date: '2026-09-10', title: 'T3' }),
        ]
        const byProject = partitionTasks(tasks, 'project', { userMap: USERS })
        expect(byProject.map((s) => [s.label, s.count])).toEqual([['Vakko · ATM', 2], ['Vakko · Portal', 1]])
        const byStatus = partitionTasks(tasks, 'status', { userMap: USERS })
        expect(byStatus.map((s) => [s.label, s.count])).toEqual([['Pending', 2], ['In Progress', 1]])
        const byOwner = partitionTasks(tasks, 'owner', { userMap: USERS })
        expect(byOwner.map((s) => [s.label, s.count])).toEqual([['Ada', 3], ['Bob', 1]])
        const byDue = partitionTasks(tasks, 'due', { userMap: USERS, today: dayjs('2026-09-16'), labels: { due: { overdue: 'Overdue', none: 'No due' } } })
        expect(byDue.map((s) => [s.label, s.count])).toEqual([['Overdue', 1], ['No due', 2]])
        expect(partitionTasks(tasks, 'none')[0]).toMatchObject({ key: 'all', label: null, count: 3 })
    })

    it('takvim: hafta ici gunlere dagitim, hafta disi ve terminsiz sayilir', () => {
        n = 0
        const tasks = [
            task({ due_date: '2026-09-16' }), task({ due_date: '2026-09-16' }),
            task({ due_date: '2026-09-25' }), task(),
        ]
        const out = tasksByDay(tasks, dayjs('2026-09-14'))
        expect(out.byDay['2026-09-16']).toHaveLength(2)
        expect(out.byDay['2026-09-14']).toEqual([])
        expect(out.outside).toBe(1)
        expect(out.undated).toBe(1)
    })
})
