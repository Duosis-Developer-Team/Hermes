/**
 * =============================================================================
 * Kisi ekseni — Explorer "By user" agaci + Filters kisi filtresi
 * =============================================================================
 * KULLANICI ISTEGI (2026-08-05): "Assigned by Me" kapsaminda atayan kisi
 * kimin neyi yaptigini kisi klasorlerine tiklayarak izleyebilmeli;
 * ayrica Filters panelinden kisi secilebilmeli.
 *
 * Kilitlenenler:
 *   - Eksen secici YALNIZ "Assigned by Me" kapsaminda gorunur
 *     ("My Tasks"ta tek kisi vardir — orada anlamsiz).
 *   - Kisi agaci logical work item sayar; coklu atamali is atandigi HER
 *     kisinin altinda gorunur (o kisinin gercekten atamasi vardir).
 *   - Kisi filtresi ISTEMCIDE daraltir; hic gelmemis kayit uretilmez.
 *   - Filtre secenekleri GORUNUR kayitlardan turetilir — dizin uzerinden
 *     "kim var" bilgisi sizmaz.
 * =============================================================================
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderHook } from '@testing-library/react'

import TasksExplorerView from '../../features/tasks/components/TasksExplorerView'
import useAssigneeScope from '../../features/tasks/hooks/useAssigneeScope'
import { groupIntoLogicalItems } from '../../features/tasks/model/grouping'
import { buildUserHierarchy } from '../../features/tasks/model/hierarchy'

let n = 0
const t = (over = {}) => ({
    id: `t${++n}`, title: over.title || `Task ${n}`, task_type: 'task',
    customer_id: 'cA', customer_name: 'A Customer',
    project_id: 'pA', project_name: 'A Project',
    sub_project_id: null, sub_project_name: null,
    assignee_user_id: 'u1', assigner_user_id: 'boss',
    status: 'pending', priority: 'medium',
    scheduled_date: '2026-08-04', due_date: null,
    assignment_batch_id: null, ...over,
})

const USER_MAP = {
    u1: { full_name: 'Ahmet' }, u2: { full_name: 'Ayse' },
    u3: { full_name: 'Mehmet' },
}
const NAMES = (id) => USER_MAP[id]?.full_name || null

describe('kisi agaci (model)', () => {
    it('her kisi kendi klasorunu alir, sayac logical is sayar', () => {
        n = 0
        const items = groupIntoLogicalItems([
            t({ assignee_user_id: 'u1' }),
            t({ assignee_user_id: 'u1' }),
            t({ assignee_user_id: 'u2' }),
        ], NAMES)
        const tree = buildUserHierarchy(items)
        expect(tree.map((u) => u.label)).toEqual(['Ahmet', 'Ayse'])
        expect(tree.find((u) => u.label === 'Ahmet').count).toBe(2)
        expect(tree.find((u) => u.label === 'Ayse').count).toBe(1)
    })

    it('coklu atamali is HER assignee nin altinda gorunur', () => {
        n = 0
        const items = groupIntoLogicalItems([
            t({ id: 'a1', assignee_user_id: 'u1', assignment_batch_id: 'B', title: 'Shared' }),
            t({ id: 'a2', assignee_user_id: 'u2', assignment_batch_id: 'B', title: 'Shared' }),
            t({ id: 'a3', assignee_user_id: 'u3', assignment_batch_id: 'B', title: 'Shared' }),
        ], NAMES)
        const tree = buildUserHierarchy(items)
        expect(tree).toHaveLength(3)
        // Ama her kisinin altinda BIR KEZ — tekrar yok.
        for (const u of tree) expect(u.count).toBe(1)
    })

    it('adi cozulemeyen atama ham kimlik BASMAZ', () => {
        n = 0
        const items = groupIntoLogicalItems([t({ assignee_user_id: 'gizli' })], () => null)
        const tree = buildUserHierarchy(items)
        expect(tree[0].label).toBe('Unknown user')
        expect(JSON.stringify(tree.map((u) => u.label))).not.toContain('gizli')
    })

    it('kisi altinda musteri · proje kirilimi korunur', () => {
        n = 0
        const items = groupIntoLogicalItems([
            t({ assignee_user_id: 'u1', customer_name: 'A Customer', project_name: 'A Project' }),
            t({ assignee_user_id: 'u1', customer_id: 'cB', customer_name: 'B Customer',
                project_id: 'pB', project_name: 'B Project' }),
        ], NAMES)
        const tree = buildUserHierarchy(items)
        expect(tree[0].children.map((p) => p.label))
            .toEqual(['A Customer · A Project', 'B Customer · B Project'])
    })
})

describe('eksen secici gorunurlugu (Explorer)', () => {
    const renderExplorer = (canGroupByUser) => {
        n = 0
        return render(
            <TasksExplorerView
                tasks={[t({ assignee_user_id: 'u1' }), t({ assignee_user_id: 'u2' })]}
                canGroupByUser={canGroupByUser}
                boardProps={{ userMap: USER_MAP, currentUserId: 'boss' }}
            />
        )
    }

    it('My Tasks kapsaminda secici GORUNMEZ', () => {
        renderExplorer(false)
        expect(screen.queryByText('By user')).toBeNull()
        expect(screen.getByRole('button', { name: /^All customers,/ })).toBeInTheDocument()
    })

    it('Assigned by Me kapsaminda secici gorunur', () => {
        renderExplorer(true)
        expect(screen.getByText('By user')).toBeInTheDocument()
        expect(screen.getByText('By customer')).toBeInTheDocument()
    })

    it('By user secilince agac KISI klasorlerine doner', async () => {
        renderExplorer(true)
        await userEvent.click(screen.getByText('By user'))
        expect(screen.getByRole('button', { name: /^Ahmet,/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /^Ayse,/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /^All users,/ })).toBeInTheDocument()
    })
})

describe('kisi filtresi (useAssigneeScope)', () => {
    const TASKS = [
        t({ id: 'x1', assignee_user_id: 'u1' }),
        t({ id: 'x2', assignee_user_id: 'u2' }),
        t({ id: 'x3', assignee_user_id: 'u2' }),
    ]

    const run = (taskScope, assigneeFilter) =>
        renderHook(() => useAssigneeScope({
            tasks: TASKS, taskScope, userMap: USER_MAP, assigneeFilter,
        })).result.current

    it('My Tasks kapsaminda secenek YOK', () => {
        expect(run('my-tasks', null).assigneeOptions).toBeNull()
    })

    it('secenekler GORUNUR kayitlardan turetilir', () => {
        const { assigneeOptions } = run('assigned-by-me', null)
        expect(assigneeOptions.map((o) => o.label)).toEqual(['Ahmet', 'Ayse'])
        // Listede assignment'i olmayan Mehmet SECENEK DEGIL.
        expect(assigneeOptions.map((o) => o.value)).not.toContain('u3')
    })

    it('filtre secilince yalniz o kisinin kayitlari kalir', () => {
        expect(run('assigned-by-me', 'u2').visibleTasks.map((t2) => t2.id))
            .toEqual(['x2', 'x3'])
    })

    it('filtre yokken kume DEGISMEZ (ayni referans)', () => {
        expect(run('assigned-by-me', null).visibleTasks).toBe(TASKS)
    })

    it('My Tasks kapsaminda filtre UYGULANMAZ', () => {
        expect(run('my-tasks', 'u2').visibleTasks).toBe(TASKS)
    })
})
