/**
 * =============================================================================
 * Detay paneli — assignment roster (§12)
 * =============================================================================
 * Gruplanmis bir karta tiklandiginda kullanici TEK logical work item
 * detayini gormeli ve BUTUN assignee'ler ile bireysel durumlari
 * eksiksiz gorunmeli. Aggregate durum ayrica ve ACIKCA adlandirilmis
 * olmali. Tek atamada onceki gorunum degismemeli.
 * =============================================================================
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../services/api', () => ({
    taskService: { getActivity: vi.fn().mockResolvedValue([]) },
    taskCommentService: { list: vi.fn().mockResolvedValue([]) },
}))

const TaskDetailPanel = (await import('../../components/tasks/TaskDetailPanel')).default

const TASK = {
    id: 'a1', task_code: 'TASK-1', title: 'API rate limit',
    description: 'desc', task_type: 'task',
    customer_name: 'A Customer', project_name: 'A Project',
    assignee_user_id: 'u1', assigner_user_id: 'boss',
    scheduled_date: '2026-08-04', due_date: '2026-08-20',
    priority: 'high', status: 'completed',
}

const a = (id, name, status) => ({
    id, assigneeUserId: `u-${id}`, assigneeName: name, status,
})

const FIVE = [
    a('1', 'Ahmet', 'completed'), a('2', 'Ayse', 'completed'),
    a('3', 'Mehmet', 'completed'), a('4', 'Elif', 'in_progress'),
    a('5', 'Can', 'in_progress'),
]

const USER_MAP = { u1: { full_name: 'Ahmet' }, boss: { full_name: 'Boss' } }

const renderPanel = (assignments) =>
    render(
        <TaskDetailPanel
            task={TASK}
            assignments={assignments}
            userMap={USER_MAP}
            currentUserId="u1"
            onClose={() => {}}
        />
    )

describe('coklu atamada roster', () => {
    it('BES assignee de detayda gorunur', () => {
        renderPanel(FIVE)
        for (const n of ['Ahmet', 'Ayse', 'Mehmet', 'Elif', 'Can']) {
            expect(screen.getByText(n)).toBeInTheDocument()
        }
    })

    it('bireysel durumlar korunur (3 completed + 2 in progress)', () => {
        const { container } = renderPanel(FIVE)
        expect(container.querySelectorAll('.h-assignee-badge--completed')).toHaveLength(3)
        expect(container.querySelectorAll('.h-assignee-badge--in_progress')).toHaveLength(2)
    })

    it('baslik atama SAYISINI tasir', () => {
        renderPanel(FIVE)
        expect(screen.getByText('Assignees (5)')).toBeInTheDocument()
    })

    it('aggregate durum AYRI ve acikca adlandirilmis', () => {
        const { container } = renderPanel(FIVE)
        expect(screen.getByText('Aggregate status')).toBeInTheDocument()
        // 3 completed + 2 in progress → In Progress. Metin badge'lerde
        // de gectigi icin ROZETE bakilir: temsilcinin 'completed'
        // durumu DEGIL, aggregate deger gosterilmeli.
        const tags = [...container.querySelectorAll('.ant-tag')]
            .map((t) => t.textContent)
        expect(tags).toContain('In Progress')
        expect(tags).not.toContain('Completed')
    })
})

describe('tek atamada onceki gorunum korunur', () => {
    it('assignments verilmezse tek Assignee satiri cizilir', () => {
        renderPanel(null)
        expect(screen.getByText('Assignee')).toBeInTheDocument()
        expect(screen.queryByText(/^Assignees \(/)).toBeNull()
        expect(screen.getByText('Status')).toBeInTheDocument()
        expect(screen.queryByText('Aggregate status')).toBeNull()
    })

    it('tek assignment roster ACMAZ', () => {
        renderPanel([a('1', 'Ahmet', 'completed')])
        expect(screen.getByText('Assignee')).toBeInTheDocument()
        expect(screen.queryByText('Aggregate status')).toBeNull()
    })
})
