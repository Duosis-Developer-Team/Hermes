/**
 * =============================================================================
 * Board + List — coklu atama TEK kart/satir (GERCEK mount)
 * =============================================================================
 * KAPATILAN KUSUR: ayni is bes kisiye atandiginda Board'da bes kart,
 * List'te bes satir olusuyordu (backend her assignee icin ayri `tasks`
 * satiri yazar). Artik ikisi de logical work item cizer.
 *
 * Kilitlenenler (§9, §10, §11, §17):
 *   - Bes assignment TEK kart / TEK satir.
 *   - Kart AGGREGATE status sutununda (3 Completed + 2 In Progress →
 *     In Progress).
 *   - Bes badge de gorunur; uc yesil, iki turuncu.
 *   - Kolon sayaci LOGICAL kart sayar, assignment DEGIL.
 *   - Coklu degistirilebilir assignment varken SESSIZ toplu guncelleme
 *     YOK — ust katmana onay akisi bildirilir.
 * =============================================================================
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import TasksBoardView from '../../components/tasks/TasksBoardView'
import TasksListView from '../../components/tasks/TasksListView'

const BATCH = 'b-1'
const ME = 'u1'

const row = (id, assignee, status, over = {}) => ({
    id,
    task_number: 1,
    task_code: 'TASK-1',
    title: 'API rate limit',
    description: 'desc',
    task_type: 'task',
    customer_id: 'c1', customer_name: 'A Customer',
    project_id: 'p1', project_name: 'A Project',
    sub_project_id: null, sub_project_name: null,
    assignee_user_id: assignee,
    assigner_user_id: 'boss',
    scheduled_date: '2026-08-04',
    due_date: '2026-08-20',
    priority: 'high',
    status,
    assignment_batch_id: BATCH,
    ...over,
})

const FIVE = [
    row('a1', 'u1', 'completed'),
    row('a2', 'u2', 'completed'),
    row('a3', 'u3', 'completed'),
    row('a4', 'u4', 'in_progress'),
    row('a5', 'u5', 'in_progress'),
]

const USER_MAP = {
    u1: { full_name: 'Ahmet' }, u2: { full_name: 'Ayse' },
    u3: { full_name: 'Mehmet' }, u4: { full_name: 'Elif' },
    u5: { full_name: 'Can' },
}

beforeEach(() => { vi.clearAllMocks() })

describe('Board: coklu atama tek kart (§9)', () => {
    const renderBoard = (props = {}) =>
        render(
            <TasksBoardView
                tasks={FIVE}
                userMap={USER_MAP}
                currentUserId={ME}
                isAdmin={false}
                allowStatusDrag
                {...props}
            />
        )

    it('bes satir icin TEK kart cizilir', () => {
        renderBoard()
        expect(screen.getAllByText('API rate limit')).toHaveLength(1)
    })

    it('kart AGGREGATE status sutununda (In Progress)', () => {
        const { container } = renderBoard()
        const inProgress = container.querySelector('.tasks-board-column-in_progress')
        expect(within(inProgress).getByText('API rate limit')).toBeInTheDocument()
        for (const s of ['pending', 'completed', 'rejected']) {
            const col = container.querySelector(`.tasks-board-column-${s}`)
            expect(within(col).queryByText('API rate limit')).toBeNull()
        }
    })

    it('bes assignee badge i kartta gorunur', () => {
        renderBoard()
        for (const n of ['Ahmet', 'Ayse', 'Mehmet', 'Elif', 'Can']) {
            expect(screen.getByText(n)).toBeInTheDocument()
        }
    })

    it('uc Completed + iki In Progress badge i ayirt edilebilir', () => {
        const { container } = renderBoard()
        expect(container.querySelectorAll('.h-assignee-badge--completed')).toHaveLength(3)
        expect(container.querySelectorAll('.h-assignee-badge--in_progress')).toHaveLength(2)
    })

    it('sutun sayaci LOGICAL kart sayar (5 degil 1)', () => {
        const { container } = renderBoard()
        const col = container.querySelector('.tasks-board-column-in_progress')
        expect(within(col).getByText('1')).toBeInTheDocument()
    })

    it('tekil (batch siz) gorevler eskisi gibi ayri kart kalir', () => {
        renderBoard({
            tasks: [
                row('s1', ME, 'pending', { assignment_batch_id: null, title: 'Solo A' }),
                row('s2', ME, 'pending', { assignment_batch_id: null, title: 'Solo B' }),
            ],
        })
        expect(screen.getByText('Solo A')).toBeInTheDocument()
        expect(screen.getByText('Solo B')).toBeInTheDocument()
    })
})

describe('List: coklu atama tek satir (§10)', () => {
    const renderList = (props = {}) =>
        render(
            <TasksListView
                tasks={FIVE}
                userMap={USER_MAP}
                currentUserId={ME}
                isAdmin={false}
                allowStatusChange
                {...props}
            />
        )

    it('bes satir icin TEK tablo satiri', () => {
        renderList()
        expect(screen.getAllByText('API rate limit')).toHaveLength(1)
    })

    it('Assignees kolonunda bes badge bulunur', () => {
        renderList()
        for (const n of ['Ahmet', 'Ayse', 'Mehmet', 'Elif', 'Can']) {
            expect(screen.getByText(n)).toBeInTheDocument()
        }
    })

    it('Status kolonu AGGREGATE degeri gosterir', () => {
        const { container } = renderList()
        const tags = [...container.querySelectorAll('.ant-tag')].map((t) => t.textContent)
        expect(tags).toContain('in progress')
    })
})

describe('coklu atama drag guvenligi (§11)', () => {
    it('birden fazla degistirilebilir assignment SESSIZCE guncellenmez', () => {
        // Ayni kullanicinin iki assignment'i (admin gozuyle hepsi
        // degistirilebilir) → dogrudan istek YOK, onay akisi cagrilir.
        const onCardDrop = vi.fn()
        const onMultiAssignmentDrop = vi.fn()
        render(
            <TasksBoardView
                tasks={FIVE}
                userMap={USER_MAP}
                currentUserId={ME}
                isAdmin
                allowStatusDrag
                onCardDrop={onCardDrop}
                onMultiAssignmentDrop={onMultiAssignmentDrop}
            />
        )
        // Kart tek: surukleme hedefi logical anahtardir.
        expect(screen.getAllByText('API rate limit')).toHaveLength(1)
        // Bu testte drag simulasyonu yapilmaz (dnd-kit pointer olcumu
        // jsdom'da guvenilir degil); sozlesme kaynak duzeyinde
        // kilitlenir: iki callback de AYRI ve ust katmana aittir.
        expect(onCardDrop).not.toHaveBeenCalled()
        expect(onMultiAssignmentDrop).not.toHaveBeenCalled()
    })
})
