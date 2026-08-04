/**
 * =============================================================================
 * Explorer — hiyerarsi, secim, sayim ve bos durum (GERCEK mount)
 * =============================================================================
 * §17'nin zorunlu senaryosu arayuz seviyesinde dogrulanir. Explorer'in
 * calisma alani MEVCUT Board'dur; bu yuzden bes kisilik is burada da
 * tek kart olarak ve aggregate sutunda gorunur — ikinci bir kart dili
 * veya ikinci bir drag engine YOK.
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import TasksExplorerView from '../../features/tasks/components/TasksExplorerView'

let n = 0
const t = (over = {}) => ({
    id: `t${++n}`,
    title: over.title || `Task ${n}`,
    task_type: 'task',
    customer_id: 'cA', customer_name: 'A Customer',
    project_id: 'pA', project_name: 'A Project',
    sub_project_id: null, sub_project_name: null,
    assignee_user_id: 'u1', assigner_user_id: 'boss',
    status: 'pending', priority: 'medium',
    scheduled_date: '2026-08-04', due_date: null,
    assignment_batch_id: null,
    ...over,
})

/** §17 fixture — A(3: A Project 1 + B Project 2), B(3), C(1), D(3) */
const FIXTURE = () => {
    n = 0
    return [
        t({ title: 'Task A' }),
        t({ title: 'Task B', project_id: 'pB', project_name: 'B Project' }),
        t({ title: 'Task C', project_id: 'pB', project_name: 'B Project' }),
        ...[1, 2, 3].map((i) => t({
            title: `B${i}`, customer_id: 'cB', customer_name: 'B Customer',
            project_id: 'pC', project_name: 'C Project',
        })),
        t({ title: 'C1', customer_id: 'cC', customer_name: 'C Customer',
            project_id: 'pD', project_name: 'D Project' }),
        ...[1, 2, 3].map((i) => t({
            title: `D${i}`, customer_id: 'cD', customer_name: 'D Customer',
            project_id: 'pE', project_name: 'E Project',
        })),
    ]
}

const USER_MAP = {
    u1: { full_name: 'Ahmet' }, u2: { full_name: 'Ayse' },
    u3: { full_name: 'Mehmet' }, u4: { full_name: 'Elif' },
    u5: { full_name: 'Can' },
}

const renderExplorer = (tasks) =>
    render(
        <TasksExplorerView
            tasks={tasks}
            boardProps={{ userMap: USER_MAP, currentUserId: 'u1', allowStatusDrag: true }}
        />
    )

const folder = (name) => screen.getByRole('button', { name: new RegExp(`^${name},`) })

beforeEach(() => {
    vi.clearAllMocks()
    window.matchMedia = (q) => ({
        matches: false, media: q,
        addEventListener: () => {}, removeEventListener: () => {},
        addListener: () => {}, removeListener: () => {},
        dispatchEvent: () => false, onchange: null,
    })
})

describe('hiyerarsi ve sayimlar (§17.1-6)', () => {
    it('baslangicta dort musteri klasoru gorunur', () => {
        renderExplorer(FIXTURE())
        for (const c of ['A Customer', 'B Customer', 'C Customer', 'D Customer']) {
            expect(folder(c)).toBeInTheDocument()
        }
    })

    it('A Customer sayaci 3', () => {
        renderExplorer(FIXTURE())
        expect(folder('A Customer')).toHaveAccessibleName('A Customer, 3 work items')
    })

    it('A acilinca A Project ve B Project gorunur; sayaclari 1 ve 2', async () => {
        renderExplorer(FIXTURE())
        await userEvent.click(screen.getByRole('button', { name: 'Expand A Customer' }))
        expect(folder('A Project')).toHaveAccessibleName('A Project, 1 work items')
        expect(folder('B Project')).toHaveAccessibleName('B Project, 2 work items')
    })

    it('kapali klasorun alt agaci MOUNT EDILMEZ (§15)', () => {
        renderExplorer(FIXTURE())
        expect(screen.queryByRole('button', { name: /^A Project,/ })).toBeNull()
    })

    it('B/C/D sayaclari 3/1/3', () => {
        renderExplorer(FIXTURE())
        expect(folder('B Customer')).toHaveAccessibleName('B Customer, 3 work items')
        expect(folder('C Customer')).toHaveAccessibleName('C Customer, 1 work items')
        expect(folder('D Customer')).toHaveAccessibleName('D Customer, 3 work items')
    })

    it('acma/kapama aria-expanded tasir (§16)', async () => {
        renderExplorer(FIXTURE())
        const toggle = screen.getByRole('button', { name: 'Expand A Customer' })
        expect(toggle).toHaveAttribute('aria-expanded', 'false')
        await userEvent.click(toggle)
        expect(screen.getByRole('button', { name: 'Collapse A Customer' }))
            .toHaveAttribute('aria-expanded', 'true')
    })
})

describe('klasor secimi ve calisma alani', () => {
    it('musteri secilince yalniz o musterinin isleri cizilir', async () => {
        renderExplorer(FIXTURE())
        await userEvent.click(folder('C Customer'))
        expect(screen.getByText('C1')).toBeInTheDocument()
        expect(screen.queryByText('Task A')).toBeNull()
    })

    it('breadcrumb secili yolu gosterir', async () => {
        renderExplorer(FIXTURE())
        await userEvent.click(folder('A Customer'))
        const nav = screen.getByRole('navigation', { name: 'Folder path' })
        expect(within(nav).getByText('A Customer')).toBeInTheDocument()
    })

    it('proje secilince o projenin isleri gelir', async () => {
        renderExplorer(FIXTURE())
        await userEvent.click(screen.getByRole('button', { name: 'Expand A Customer' }))
        await userEvent.click(folder('B Project'))
        expect(screen.getByText('Task B')).toBeInTheDocument()
        expect(screen.queryByText('Task A')).toBeNull()
    })
})

describe('bes kisilik is Explorer da TEK kart (§17.7-10)', () => {
    const FIVE = [1, 2, 3, 4, 5].map((i) => t({
        id: `a${i}`, title: 'API rate limit',
        assignee_user_id: `u${i}`,
        status: i <= 3 ? 'completed' : 'in_progress',
        assignment_batch_id: 'B',
    }))

    it('tek kart cizilir ve bes badge gorunur', () => {
        n = 0
        renderExplorer(FIVE)
        expect(screen.getAllByText('API rate limit')).toHaveLength(1)
        for (const name of ['Ahmet', 'Ayse', 'Mehmet', 'Elif', 'Can']) {
            expect(screen.getByText(name)).toBeInTheDocument()
        }
    })

    it('kart aggregate In Progress sutununda', () => {
        n = 0
        const { container } = renderExplorer(FIVE)
        const col = container.querySelector('.tasks-board-column-in_progress')
        expect(within(col).getByText('API rate limit')).toBeInTheDocument()
    })

    it('klasor sayaci 1 (assignment sayisi DEGIL)', () => {
        n = 0
        renderExplorer(FIVE)
        expect(folder('A Customer')).toHaveAccessibleName('A Customer, 1 work items')
    })
})

describe('bos/eksik iliskiler ve arama (§6.5, §14)', () => {
    it('customer siz is No Customer klasorunde gorunur', () => {
        renderExplorer([t({ title: 'Orphan', customer_id: null, customer_name: null })])
        expect(folder('No Customer')).toBeInTheDocument()
    })

    it('arama eslesen isin ATA klasorunu korur', async () => {
        renderExplorer(FIXTURE())
        await userEvent.type(screen.getByRole('textbox', { name: 'Search work items' }), 'C1')
        expect(folder('C Customer')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /^A Customer,/ })).toBeNull()
    })

    it('"filtreye uyan yok" ile "klasor bos" AYRI mesajlardir', async () => {
        renderExplorer(FIXTURE())
        await userEvent.type(
            screen.getByRole('textbox', { name: 'Search work items' }), 'zzzz'
        )
        // Mesaj hem agacta hem calisma alaninda gorunur — ikisi de bos.
        expect(screen.getAllByText('No work items match your search.').length)
            .toBeGreaterThan(0)
    })

    it('hic is yoksa bos mesaji farklidir', () => {
        renderExplorer([])
        expect(screen.getAllByText('No work items yet.').length).toBeGreaterThan(0)
    })
})
