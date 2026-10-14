/**
 * HERMES - Talep kanbani: sutunlar "top kimde"ye gore; birakma kurallari;
 * tamamlanan kartta "Efor gir"; numara musteriye gore.
 */
import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '../utils'
import TicketBoard, { dropDecision } from '../../features/tickets/TicketBoard'

const row = (id, column, extra = {}) => ({
    id, board_column: column, customer_ref: `Defacto Ticket-00${id}`, ticket_number: `TKT-00000${id}`,
    title: `Talep ${id}`, priority: 'normal', status: column === 'completed' ? 'resolved' : 'open',
    version: 2, assigned_group: { name: 'Destek' }, tags: [], updated_at: new Date().toISOString(), ...extra,
})

describe('talep kanbani', () => {
    it('kartlar sutunlarina dagilir; tamamlanan kartta efor girilir', async () => {
        const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 })
        const onLogTime = vi.fn()
        const onOpen = vi.fn()
        renderWithProviders(
            <TicketBoard rows={[row(1, 'pending'), row(2, 'in_progress'), row(3, 'completed')]}
                         canRespond canResolve onLogTime={onLogTime} onOpen={onOpen} />,
        )
        const column = (label) => screen.getByText(label).closest('.tasks-board-column')
        expect(within(column('Pending')).getByText('Defacto Ticket-001')).toBeInTheDocument()
        expect(within(column('In progress')).getByText('Defacto Ticket-002')).toBeInTheDocument()
        expect(within(column('Completed')).getByText('Defacto Ticket-003')).toBeInTheDocument()

        expect(within(column('Pending')).queryByRole('button', { name: /Log time/ })).toBeNull()
        await user.click(screen.getByRole('button', { name: 'Log time for Defacto Ticket-003' }))
        expect(onLogTime).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }))
        await user.click(screen.getByText('Talep 1'))
        expect(onOpen).toHaveBeenCalledWith(1)
    })

    it('birakma kurallari', () => {
        const all = { canResolve: true, canRespond: true }
        expect(dropDecision('pending', 'completed', all)).toBe('resolve')
        expect(dropDecision('pending', 'in_progress', all)).toBe('reply')
        expect(dropDecision('completed', 'pending', all)).toBe('reopen')
        expect(dropDecision('in_progress', 'pending', all)).toEqual({ info: 'ticketBoard.pendingAuto' })
        expect(dropDecision('completed', 'in_progress', all)).toEqual({ info: 'ticketBoard.reopenFirst' })
        expect(dropDecision('pending', 'completed', { canResolve: false })).toEqual({ info: 'ticketBoard.noResolve' })
        expect(dropDecision('pending', 'pending', all)).toBeNull()
    })
})
