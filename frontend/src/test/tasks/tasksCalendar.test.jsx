/**
 * Gorevler takvimi (CTO 05.10): burasi IS alanidir — toplanti cizilmez;
 * terminsiz isler sayiyla degil tiklanabilir kart olarak gorunur.
 */
import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import dayjs from 'dayjs'

import TasksCalendarView from '../../features/tasks/components/TasksCalendarView'
import { renderWithProviders } from '../utils'

const task = (over) => ({
    id: over.id, task_code: over.id.toUpperCase(), title: over.title, customer_id: 'c1',
    customer_name: 'IGA', project_id: 'p1', project_name: 'Portal', assignee_user_id: 'u1',
    status: 'pending', due_date: null, assignment_batch_id: null, ...over,
})

describe('TasksCalendarView', () => {
    it('isleri gunlere dagitir, terminsizleri kart olarak listeler, toplanti yok', async () => {
        const onOpenPanel = vi.fn()
        renderWithProviders(
            <TasksCalendarView
                tasks={[
                    task({ id: 't1', title: 'Due Wed', due_date: '2026-09-16' }),
                    task({ id: 't2', title: 'No date' }),
                ]}
                weekStart={dayjs('2026-09-14')}
                onOpenPanel={onOpenPanel}
            />,
        )
        const cal = screen.getByTestId('tasks-calendar')
        expect(cal.querySelector('[data-entry="meeting"]')).toBeNull()
        const wed = cal.querySelector('[data-date="2026-09-16"]')
        expect(within(wed).getByRole('button', { name: /Due Wed/ })).toBeInTheDocument()

        const undated = screen.getByTestId('tasks-calendar-undated')
        const card = within(undated).getByRole('button', { name: /No date/ })
        await userEvent.setup({ delay: null, pointerEventsCheck: 0 }).click(card)
        expect(onOpenPanel).toHaveBeenCalledWith(expect.objectContaining({ id: 't2' }))
    })
})
