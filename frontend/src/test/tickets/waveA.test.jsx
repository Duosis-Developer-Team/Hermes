/**
 * HERMES - Talep yonetimi Dalga A (00-plan §4.1) — istemci.
 *
 *   1. Gerekce isteyen gecis (yeniden ac) pencerede SORULUR ve gerekceyle
 *      gider — eskiden gerekcesiz gidip 409 aliyordu.
 *   2. "Musteride bekliyor" musteriye gidecek soruyu ister (taslak dolu gelir).
 *   3. Oncelik ve "Bana ata".
 *   4. Musteri iptali yalniz sunucu izin verince (can_cancel) ve gerekceyle.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders, resetAuthStore } from '../utils'
import { useAuthStore } from '../../stores/authStore'

vi.mock('../../api/ticketsApi', async () => {
    const actual = await vi.importActual('../../api/ticketsApi')
    return {
        ...actual,
        ticketHubService: {
            groupMembers: vi.fn(async () => ({ user_ids: ['me', 'u2'] })),
            audit: vi.fn(async () => []),
        },
        supportPortalService: {
            get: vi.fn(),
            cancel: vi.fn(async () => ({})),
            reply: vi.fn(), reopen: vi.fn(), confirmClose: vi.fn(),
            downloadUrl: vi.fn(() => '#'),
            openAttachmentSession: vi.fn(), uploadAttachmentContent: vi.fn(),
        },
    }
})
vi.mock('../../api/authApi', async () => {
    const actual = await vi.importActual('../../api/authApi')
    return {
        ...actual,
        authService: {
            ...actual.authService,
            lookupUsers: vi.fn(async () => [
                { id: 'me', full_name: 'Ada Lovelace' }, { id: 'u2', full_name: 'Alan Turing' },
            ]),
        },
    }
})

const { supportPortalService } = await import('../../api/ticketsApi')
const { default: TicketStatusModal } = await import('../../features/tickets/TicketStatusModal')
const { default: CustomerTicketDetail } = await import('../../features/tickets/CustomerTicketDetail')

const TICKET = {
    id: 't1', ticket_number: 'TKT-000042', title: 'Kaydetme hatasi', status: 'resolved',
    priority: 'normal', impact: 'single_user', category: 'bug', version: 7,
    allowed_transitions: ['reopened'], assigned_group: { id: 'g1', name: 'Destek' },
    assigned_user_id: null, messages: [], work_items: [], client_context: {},
}

const renderModal = (props = {}) => {
    const handlers = { onTransition: vi.fn(), onPriority: vi.fn(), onAssignUser: vi.fn(), onAssignGroup: vi.fn(), onResolve: vi.fn() }
    renderWithProviders(
        <TicketStatusModal open onClose={vi.fn()} ticket={TICKET} groups={[]} canAssign canRespond canResolve
                           {...handlers} {...props} />,
    )
    return handlers
}
const setup = () => userEvent.setup({ delay: null, pointerEventsCheck: 0 })

beforeEach(() => {
    resetAuthStore()
    useAuthStore.setState({ isAuthenticated: true, user: { id: 'me', email: 'ada@example.com' }, permissions: ['tickets.access'] })
    vi.clearAllMocks()
})

describe('talep paneli', () => {
    it('yeniden ac gerekce sorar ve gerekceyle gonderir', async () => {
        const user = setup()
        const { onTransition } = renderModal()
        await user.click(screen.getByRole('button', { name: 'Reopened' }))
        const apply = screen.getByRole('button', { name: 'Set to "Reopened"' })
        expect(apply).toBeDisabled()
        await user.type(screen.getByLabelText('Reason for "Reopened"'), 'Hata tekrarladi')
        await user.click(apply)
        expect(onTransition).toHaveBeenCalledWith(
            { to: 'reopened', reason: 'Hata tekrarladi', publicMessage: undefined }, expect.any(Function))
    })

    it('musteride bekliyor soruyu ister; taslak dolu gelir', async () => {
        const user = setup()
        const { onTransition } = renderModal({
            ticket: { ...TICKET, status: 'in_progress', allowed_transitions: ['waiting_customer'] },
            draft: 'Hangi tarayiciyi kullaniyorsunuz?',
        })
        await user.click(screen.getByRole('button', { name: 'Waiting on customer' }))
        const field = screen.getByLabelText(/Question for the customer/)
        expect(field).toHaveValue('Hangi tarayiciyi kullaniyorsunuz?')
        await user.click(screen.getByRole('button', { name: 'Set to "Waiting on customer"' }))
        expect(onTransition).toHaveBeenCalledWith({
            to: 'waiting_customer', reason: undefined, publicMessage: 'Hangi tarayiciyi kullaniyorsunuz?',
        }, expect.any(Function))
    })

    it('oncelik ve bana ata', async () => {
        const user = setup()
        const { onPriority, onAssignUser } = renderModal()
        await user.click(within(screen.getByRole('group', { name: 'Priority' })).getByRole('button', { name: 'Urgent' }))
        expect(onPriority).toHaveBeenCalledWith('urgent')
        await user.click(await screen.findByRole('button', { name: /Assign to me/ }))
        expect(onAssignUser).toHaveBeenCalledWith('me')
    })
})

describe('musteri iptali', () => {
    it('can_cancel varken gerekceyle iptal eder; yokken dugme yok', async () => {
        const user = setup()
        supportPortalService.get.mockResolvedValue({ ...TICKET, status: 'open', can_cancel: true, version: 2 })
        renderWithProviders(<CustomerTicketDetail ticketId="t1" open provider="p1" onClose={vi.fn()} />)
        await user.click(await screen.findByRole('button', { name: 'Cancel this request' }))
        await user.type(screen.getByLabelText('Why are you cancelling?'), 'Yanlislikla actim')
        await user.click(screen.getByRole('button', { name: 'Cancel request' }))
        expect(supportPortalService.cancel).toHaveBeenCalledWith(
            't1', { reason: 'Yanlislikla actim', expected_version: 2 }, 'p1')
    })

    it('destek yanit verdiyse iptal dugmesi gorunmez', async () => {
        supportPortalService.get.mockResolvedValue({ ...TICKET, status: 'in_progress', can_cancel: false })
        renderWithProviders(<CustomerTicketDetail ticketId="t1" open onClose={vi.fn()} />)
        expect(await screen.findByText('Kaydetme hatasi')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Cancel this request' })).toBeNull()
    })
})
