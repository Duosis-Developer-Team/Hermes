/**
 * HERMES - Dalga D (00-plan §4.4) — istemci.
 *   D1 Birlestirme: yalniz ayni musterinin acik talepleri aday; hedef secilince
 *      musteri mesaji dolar; onay birlestirme ucunu cagirir.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders, resetAuthStore } from '../utils'
import { useAuthStore } from '../../stores/authStore'

vi.mock('../../api/ticketsApi', async () => {
    const actual = await vi.importActual('../../api/ticketsApi')
    return {
        ...actual,
        ticketHubService: { list: vi.fn(async () => ({ items: [] })) },
        ticketHelpdeskService: { requesterHistory: vi.fn(), merge: vi.fn() },
    }
})

const { ticketHelpdeskService } = await import('../../api/ticketsApi')
const { default: MergeModal } = await import('../../features/tickets/MergeModal')

const setup = () => userEvent.setup({ delay: null, pointerEventsCheck: 0 })
const CUSTOMER = { id: 'src1' }
const APP = { id: 'app1' }
const row = (id, number, extra = {}) => ({
    id, ticket_number: number, title: `Talep ${number}`, status: 'open', source_tenant: CUSTOMER, application: APP, ...extra,
})

beforeEach(() => {
    resetAuthStore()
    useAuthStore.setState({ isAuthenticated: true, user: { id: 'me' }, permissions: ['tickets.access'] })
    vi.clearAllMocks()
})

describe('birlestirme', () => {
    it('yalniz ayni musterinin acik talepleri aday; onay birlestirir', async () => {
        const user = setup()
        ticketHelpdeskService.requesterHistory.mockResolvedValue([
            row('t2', 'TKT-000002'),
            row('t3', 'TKT-000003', { status: 'closed' }),                // kapali → aday degil
            row('t4', 'TKT-000004', { source_tenant: { id: 'other' } }),  // baska musteri
        ])
        ticketHelpdeskService.merge.mockResolvedValue({ id: 't2' })
        const onMerged = vi.fn()
        renderWithProviders(
            <MergeModal open ticket={{ ...row('t1', 'TKT-000001'), version: 5 }} onClose={vi.fn()} onMerged={onMerged} />,
        )
        const dialog = await screen.findByRole('dialog')
        await user.click(within(dialog).getByRole('combobox', { name: 'Merge into' }))
        expect(await screen.findByTitle('TKT-000002 · Talep TKT-000002')).toBeInTheDocument()
        expect(screen.queryByTitle(/TKT-000003/)).toBeNull()
        expect(screen.queryByTitle(/TKT-000004/)).toBeNull()
        await user.click(screen.getByTitle('TKT-000002 · Talep TKT-000002'))
        expect(within(dialog).getByLabelText('Message to the customer'))
            .toHaveValue('This request was merged into TKT-000002; we will continue there.')
        await user.click(within(dialog).getByRole('button', { name: 'Merge' }))
        await waitFor(() => expect(ticketHelpdeskService.merge).toHaveBeenCalledWith('t1', {
            target_ticket_id: 't2',
            public_summary: 'This request was merged into TKT-000002; we will continue there.',
            note_header: 'TKT-000001 was merged into this ticket.',
            expected_version: 5,
        }))
        expect(onMerged).toHaveBeenCalledWith({ id: 't2' })
    })
})
