/**
 * HERMES - Talep yonetimi Dalga B (00-plan §4.2) — istemci.
 *
 *   SLA rozeti · kayitli gorunum · toplu islem · hazir yanit (makro) ·
 *   birlesik zil (is kalemi + talep) · SLA ayari (saat → dakika).
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
        ticketContextService: { get: vi.fn() },
        ticketHelpdeskService: {
            notifications: vi.fn(async () => ({ unread: 1, items: [] })),
            readNotification: vi.fn(async () => {}),
            readAllNotifications: vi.fn(async () => {}),
            slaPolicy: vi.fn(),
            saveSlaPolicy: vi.fn(async (p) => ({ exists: true, ...p })),
        },
    }
})
vi.mock('../../services/api', async () => {
    const actual = await vi.importActual('../../services/api')
    return {
        ...actual,
        notificationService: {
            unreadCount: vi.fn(async () => ({ unread_count: 2 })),
            list: vi.fn(async () => ({ items: [] })),
            markRead: vi.fn(), markAllRead: vi.fn(),
        },
    }
})

const { ticketContextService, ticketHelpdeskService } = await import('../../api/ticketsApi')
const { notificationService } = await import('../../services/api')
const { default: SlaBadge } = await import('../../features/tickets/SlaBadge')
const { default: SavedViews } = await import('../../features/tickets/SavedViews')
const { default: BulkBar } = await import('../../features/tickets/BulkBar')
const { AgentComposer } = await import('../../features/tickets/AgentComposer')
const { default: NotificationBell } = await import('../../components/layout/NotificationBell')
const { default: TicketHelpdeskSettings } = await import('../../pages/tickets/TicketHelpdeskSettings')

const NOW = new Date('2026-10-14T10:00:00Z').getTime()
const leg = (status, minutesFromNow, extra = {}) => ({
    status, due_at: new Date(NOW + minutesFromNow * 60000).toISOString(), target_minutes: 240, ...extra,
})
const setup = () => userEvent.setup({ delay: null, pointerEventsCheck: 0 })

beforeEach(() => {
    resetAuthStore()
    useAuthStore.setState({ isAuthenticated: true, user: { id: 'me' }, permissions: ['tickets.access'] })
    vi.clearAllMocks()
})

describe('SLA rozeti', () => {
    it('siradaki karsilanmamis hedefi ve kalan/geciken sureyi yazar', () => {
        const { rerender } = renderWithProviders(
            <SlaBadge now={NOW} sla={{ first_response: leg('met', -30, { met_at: 'x' }), resolution: leg('at_risk', 25) }} />,
        )
        expect(screen.getByText('25m left')).toBeInTheDocument()
        expect(screen.getByLabelText('Resolution: 25m left')).toBeInTheDocument()
        rerender(<SlaBadge now={NOW} sla={{ first_response: leg('breached', -95) }} />)
        expect(screen.getByText('overdue 1h 35m')).toBeInTheDocument()
        rerender(<SlaBadge now={NOW} sla={{ resolution: leg('paused', 600) }} />)
        expect(screen.getByText('paused')).toBeInTheDocument()
    })

    it('karsilanmis SLA listede gizli, detayda gorunur', () => {
        const sla = { resolution: leg('met', 10, { met_at: 'x' }) }
        const { container, rerender } = renderWithProviders(<SlaBadge now={NOW} sla={sla} />)
        expect(container.textContent).toBe('')
        rerender(<SlaBadge now={NOW} sla={sla} showMet />)
        expect(screen.getByText('met')).toBeInTheDocument()
    })
})

describe('kayitli gorunum + toplu islem', () => {
    it('gorunum kaydeder (paylasim yalniz yetkiliye) ve uygular', async () => {
        const user = setup()
        const onSave = vi.fn()
        const onApply = vi.fn()
        const view = { id: 'v1', name: 'Acillerim', is_mine: true, filters: { priority: ['urgent'] } }
        renderWithProviders(<SavedViews views={[view]} canSave canShare onSave={onSave} onApply={onApply} onDelete={vi.fn()} />)
        await user.click(screen.getByRole('button', { name: /^\s*Acillerim$/ }))
        expect(onApply).toHaveBeenCalledWith(view)
        await user.click(screen.getByRole('button', { name: /Save view/ }))
        const dialog = await screen.findByRole('dialog')
        await user.type(within(dialog).getByLabelText('View name'), 'Ekip kuyrugu')
        await user.click(within(dialog).getByRole('switch', { name: 'Share with the team' }))
        await user.click(within(dialog).getByRole('button', { name: 'Save' }))
        expect(onSave).toHaveBeenCalledWith({ name: 'Ekip kuyrugu', is_shared: true })
    })

    it('toplu oncelik secimi eylemi tetikler', async () => {
        const user = setup()
        const onAction = vi.fn()
        renderWithProviders(<BulkBar count={3} canRespond canAssign groups={[]} tags={[]} onAction={onAction} onClear={vi.fn()} />)
        expect(screen.getByText('3 selected')).toBeInTheDocument()
        await user.click(screen.getByRole('combobox', { name: 'Set priority for selected' }))
        await user.click(await screen.findByTitle('Urgent'))
        expect(onAction).toHaveBeenCalledWith('priority', 'urgent')
        await user.click(screen.getByRole('button', { name: /Start working/ }))
        expect(onAction).toHaveBeenLastCalledWith('status', 'in_progress')
    })
})

describe('hazir yanit', () => {
    it('eylemli makro metni doldurur ve "Uygula ve gonder" ile sunucuya gider', async () => {
        const user = setup()
        const onApplyMacro = vi.fn()
        const onSubmit = vi.fn()
        const macro = { id: 'm1', name: 'Ekran goruntusu iste', body: 'Ekran goruntusu paylasir misiniz?',
            visibility: 'public', set_status: 'waiting_customer', set_priority: 'high', add_tag_ids: ['t1'] }
        renderWithProviders(<AgentComposer macros={[macro]} onApplyMacro={onApplyMacro} onSubmit={onSubmit} />)
        await user.click(screen.getByRole('combobox', { name: 'Canned responses' }))
        await user.click(await screen.findByTitle('Ekran goruntusu iste'))
        expect(screen.getByRole('textbox', { name: 'Reply to customer' })).toHaveValue('Ekran goruntusu paylasir misiniz?')
        expect(screen.getByText(/status → Waiting on customer · priority → High · \+1 tags/)).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: /Apply and send/ }))
        expect(onApplyMacro).toHaveBeenCalledWith(macro, 'Ekran goruntusu paylasir misiniz?')
        expect(onSubmit).not.toHaveBeenCalled()
    })
})

describe('birlesik zil', () => {
    it('is kalemi + talep okunmamislari toplanir; talep bildirimi talebe gider', async () => {
        const user = setup()
        ticketHelpdeskService.notifications.mockResolvedValue({
            unread: 1,
            items: [{ id: 'n1', kind: 'customer_replied', ticket_id: 'tk1', ticket_number: 'TKT-000042',
                title: 'Yazici', read_at: null, created_at: '2026-10-14T09:00:00Z' }],
        })
        renderWithProviders(<NotificationBell sources={{ work: true, tickets: true }} />)
        expect(await screen.findByRole('button', { name: /3/ })).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: /3/ }))
        await user.click(await screen.findByText('Customer replied on TKT-000042: Yazici'))
        expect(ticketHelpdeskService.readNotification).toHaveBeenCalledWith('n1')
        expect(notificationService.markRead).not.toHaveBeenCalled()
    })
})

describe('talep yonetimi ayarlari', () => {
    it('SLA hedefleri saat olarak girilir, dakika olarak kaydedilir', async () => {
        const user = setup()
        ticketContextService.get.mockResolvedValue({ module_enabled: true, surface: 'hub', surfaces: ['hub'], permissions: [] })
        ticketHelpdeskService.slaPolicy.mockResolvedValue({
            exists: false, name: 'Default', is_active: false,
            targets: { urgent: { first_response: 60, resolution: 240 } }, calendar: null,
        })
        renderWithProviders(<TicketHelpdeskSettings />)
        const field = await screen.findByLabelText('Urgent · First response')
        await user.clear(field)
        await user.type(field, '0.5')
        await user.click(screen.getByRole('button', { name: 'Save' }))
        await waitFor(() => expect(ticketHelpdeskService.saveSlaPolicy).toHaveBeenCalled())
        const payload = ticketHelpdeskService.saveSlaPolicy.mock.calls[0][0]
        expect(payload.targets.urgent).toEqual({ first_response: 30, resolution: 240 })
        expect(payload.calendar).toBeNull()
        expect(payload.is_active).toBe(true)
    })
})
