/**
 * =============================================================================
 * Detay paneli — takipci (B5, PM rework P1.3)
 * =============================================================================
 * Satir `participants[]` tasir; role === 'watcher' olanlar "Watchers"
 * satirinda adlariyla gorunur. Zil dugmesi: takip etmiyorsam "Watch",
 * ediyorsam "Stop watching"; tiklama ust katmana (task, {userId, watching})
 * ile gider — panel kendi istek atmaz (saf bilesen, provider'siz).
 * =============================================================================
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../services/api', () => ({
    taskService: { getActivity: vi.fn().mockResolvedValue([]) },
    taskCommentService: { list: vi.fn().mockResolvedValue([]) },
}))

const TaskDetailPanel = (await import('../../components/tasks/TaskDetailPanel')).default

const participant = (id, user_id, role) => ({
    id, user_id, role, accepted_at: null, completed_at: null, note: null, status: 'pending',
})

const TASK = {
    id: 'wi1', task_code: 'TASK-1', title: 'API rate limit',
    description: 'desc', task_type: 'task',
    customer_name: 'A Customer', project_name: 'A Project',
    assignee_user_id: 'u1', assigner_user_id: 'boss',
    scheduled_date: '2026-08-04', due_date: '2026-08-20',
    priority: 'high', status: 'pending',
    participants: [
        participant('p1', 'u1', 'assignee'),
        participant('w1', 'u3', 'watcher'),
        participant('w2', 'u4', 'watcher'),
    ],
}

const USER_MAP = {
    u1: { full_name: 'Ahmet' }, boss: { full_name: 'Boss' },
    u3: { full_name: 'Alan Turing' }, u4: { full_name: 'Elif' },
}

const renderPanel = (over = {}) => {
    const onToggleWatch = vi.fn()
    render(
        <TaskDetailPanel
            task={TASK}
            userMap={USER_MAP}
            currentUserId="u1"
            onClose={() => {}}
            onToggleWatch={onToggleWatch}
            {...over}
        />
    )
    return { onToggleWatch }
}

describe('takipciler (B5)', () => {
    it('Watchers satiri takipcileri adlariyla listeler; atanan listelenmez', () => {
        renderPanel()
        const row = screen.getByText('Watchers (2)').parentElement
        expect(row).toHaveTextContent('Alan Turing, Elif')
        expect(row).not.toHaveTextContent('Ahmet')
    })

    it('takip etmeyen kullanici "Watch" gorur; tiklama watching:false ile ust katmana gider', async () => {
        const user = userEvent.setup({ delay: null })
        const { onToggleWatch } = renderPanel()
        const btn = screen.getByRole('button', { name: 'Watch this item' })
        expect(btn).toHaveAttribute('aria-pressed', 'false')
        await user.click(btn)
        expect(onToggleWatch).toHaveBeenCalledWith(TASK, { userId: 'u1', watching: false })
    })

    it('takip eden kullanici "Stop watching" gorur; tiklama watching:true gonderir', async () => {
        const user = userEvent.setup({ delay: null })
        const { onToggleWatch } = renderPanel({ currentUserId: 'u3' })
        const btn = screen.getByRole('button', { name: 'Stop watching' })
        expect(btn).toHaveAttribute('aria-pressed', 'true')
        await user.click(btn)
        expect(onToggleWatch).toHaveBeenCalledWith(TASK, { userId: 'u3', watching: true })
    })

    it('onToggleWatch verilmezse dugme cizilmez; takipci yoksa satir yok', () => {
        render(
            <TaskDetailPanel
                task={{ ...TASK, participants: [participant('p1', 'u1', 'assignee')] }}
                userMap={USER_MAP}
                currentUserId="u1"
                onClose={() => {}}
            />
        )
        expect(screen.queryByRole('button', { name: /Watch/ })).toBeNull()
        expect(screen.queryByText(/^Watchers/)).toBeNull()
    })

    it('istek ucarken dugme kilitlenir', () => {
        renderPanel({ watchPending: true })
        expect(screen.getByRole('button', { name: 'Watch this item' })).toBeDisabled()
    })
})
