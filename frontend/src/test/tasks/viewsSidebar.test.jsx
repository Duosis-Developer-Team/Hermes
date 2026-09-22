/**
 * =============================================================================
 * PM rework P3.5 — gorunumler sol kolonu (E1/E2/E3) + Projeler agaci
 * =============================================================================
 * Eski Explorer agacinin yerine: sonuc kumesinin Musteri → Proje → Alt
 * proje agaci, klasor secimi = capraz filtre. Gorunumler bir tablist.
 *   1. Sistem gorunumleri sirayla; kisisel/paylasilan bolumleri yalniz
 *      doluyken; secili gorunum aria-selected.
 *   2. Kayitli gorunum yalnizca sahibi icin silinebilir.
 *   3. Agac: sayaclar mantiksal is sayar (coklu atama TEK), kapali klasor
 *      mount edilmez, acma/kapama aria-expanded tasir, secim ust katmana
 *      {customer, project, subProject} verir; sanal klasor secilemez.
 * =============================================================================
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import TaskViewsSidebar from '../../features/tasks/components/TaskViewsSidebar'
import { SYSTEM_VIEWS } from '../../features/tasks/model/views'
import { buildHierarchy } from '../../features/tasks/model/hierarchy'
import { groupIntoLogicalItems } from '../../features/tasks/model/grouping'

let n = 0
const t = (over = {}) => ({
    id: `t${++n}`, title: over.title || `Task ${n}`, task_type: 'task',
    customer_id: 'cA', customer_name: 'A Customer', project_id: 'pA', project_name: 'A Project',
    sub_project_id: null, sub_project_name: null, assignee_user_id: 'u1', assigner_user_id: 'boss',
    status: 'pending', priority: 'medium', scheduled_date: '2026-08-04', due_date: null,
    assignment_batch_id: null, ...over,
})
const tree = (tasks) => buildHierarchy(groupIntoLogicalItems(tasks, () => 'x'))

const FIXTURE = () => {
    n = 0
    return [
        t({ title: 'Task A' }),
        t({ title: 'Task B', project_id: 'pB', project_name: 'B Project' }),
        t({ title: 'Task C', project_id: 'pB', project_name: 'B Project' }),
        ...[1, 2, 3].map((i) => t({ title: `B${i}`, customer_id: 'cB', customer_name: 'B Customer', project_id: 'pC', project_name: 'C Project' })),
        t({ title: 'Orphan', customer_id: null, customer_name: null, project_id: null, project_name: null }),
        // Bes kisilik TEK is (ayni batch) — sayac 1.
        ...['u1', 'u2', 'u3', 'u4', 'u5'].map((u) => t({
            title: 'Ortak is', assignee_user_id: u, assignment_batch_id: 'batch-1',
            customer_id: 'cD', customer_name: 'D Customer', project_id: 'pE', project_name: 'E Project',
        })),
    ]
}

const folder = (name) => screen.getByRole('button', { name: new RegExp(`^${name},`) })

const renderSidebar = (props = {}) => render(
    <TaskViewsSidebar
        systemViews={SYSTEM_VIEWS}
        activeViewId="mine"
        onSelectView={vi.fn()}
        onDeleteView={vi.fn()}
        projectTree={tree(FIXTURE())}
        onSelectFolder={vi.fn()}
        {...props}
    />
)

describe('gorunumler', () => {
    it('sistem gorunumleri sekme, secili aria-selected; bos bolumler yok', () => {
        renderSidebar()
        const tabs = screen.getAllByRole('tab')
        expect(tabs.map((x) => x.textContent)).toEqual([
            'My work items', 'Assigned by Me', 'Triage', 'Overdue', 'Due This Week',
            'Completed This Week', 'Issues', 'Suggestions', 'All work items',
        ])
        expect(screen.getByRole('tab', { name: 'My work items' })).toHaveAttribute('aria-selected', 'true')
        expect(screen.queryByText('My views')).toBeNull()
        expect(screen.queryByText('Shared views')).toBeNull()
    })

    it('kisisel/paylasilan bolumleri; silme yalniz duzenleyebilene', async () => {
        const onDeleteView = vi.fn()
        const onSelectView = vi.fn()
        const mine = { id: 'v1', name: 'Vakko gecikmis', scope: 'personal', saved: true, canEdit: true, filter: {} }
        const shared = { id: 'v2', name: 'Ekip panosu', scope: 'shared', saved: true, canEdit: false, filter: {} }
        renderSidebar({ personalViews: [mine], sharedViews: [shared], activeViewId: 'v2', onDeleteView, onSelectView })
        expect(screen.getByText('My views')).toBeInTheDocument()
        expect(screen.getByText('Shared views')).toBeInTheDocument()
        expect(screen.getByRole('tab', { name: 'Ekip panosu' })).toHaveAttribute('aria-selected', 'true')
        expect(screen.getByRole('button', { name: 'Delete view — Vakko gecikmis' })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Delete view — Ekip panosu' })).toBeNull()
        await userEvent.click(screen.getByRole('button', { name: 'Delete view — Vakko gecikmis' }))
        expect(onDeleteView).toHaveBeenCalledWith(mine)
        await userEvent.click(screen.getByRole('tab', { name: 'Triage' }))
        expect(onSelectView).toHaveBeenCalledWith('triage')
    })
})

describe('Projeler agaci', () => {
    it('musteri klasorleri ve sayaclar (coklu atama TEK sayilir; sanal klasor sonda)', () => {
        renderSidebar()
        expect(folder('A Customer')).toHaveAccessibleName('A Customer, 3 work items')
        expect(folder('B Customer')).toHaveAccessibleName('B Customer, 3 work items')
        expect(folder('D Customer')).toHaveAccessibleName('D Customer, 1 work items')
        const virtual = screen.getByRole('button', { name: /^No Customer,/ })
        expect(virtual).toBeDisabled()
        expect(screen.queryByRole('button', { name: /^A Project,/ })).toBeNull() // kapali: mount yok
    })

    it('acma/kapama aria-expanded; proje secimi filtre verir', async () => {
        const onSelectFolder = vi.fn()
        renderSidebar({ onSelectFolder })
        const toggle = screen.getByRole('button', { name: 'Expand A Customer' })
        expect(toggle).toHaveAttribute('aria-expanded', 'false')
        await userEvent.click(toggle)
        expect(screen.getByRole('button', { name: 'Collapse A Customer' })).toHaveAttribute('aria-expanded', 'true')
        expect(folder('A Project')).toHaveAccessibleName('A Project, 1 work items')
        expect(folder('B Project')).toHaveAccessibleName('B Project, 2 work items')

        await userEvent.click(folder('B Project'))
        expect(onSelectFolder).toHaveBeenCalledWith({ customer: 'cA', project: 'pB', subProject: null })
        await userEvent.click(folder('A Customer'))
        expect(onSelectFolder).toHaveBeenCalledWith({ customer: 'cA', project: null, subProject: null })
        await userEvent.click(screen.getByRole('button', { name: 'All projects' }))
        expect(onSelectFolder).toHaveBeenCalledWith(null)
    })

    it('secili klasor isaretlenir', () => {
        renderSidebar({ folderSelection: { customer: 'cB', project: null, subProject: null } })
        expect(folder('B Customer')).toHaveAttribute('aria-current', 'true')
        expect(within(folder('A Customer').parentElement).getByRole('button', { name: /^A Customer,/ })).not.toHaveAttribute('aria-current')
        expect(screen.getByRole('button', { name: 'All projects' })).not.toHaveAttribute('aria-current')
    })

    it('agac bos ise Projeler bolumu cizilmez', () => {
        renderSidebar({ projectTree: [] })
        expect(screen.queryByText('Projects')).toBeNull()
    })
})
