/**
 * HERMES - Talep yonetimi Dalga C (00-plan §4.3) — istemci.
 *   1. Rapor sayfasi: KPI'lar, SLA/CSAT oranlari, ekip tablosu; donem secimi
 *      sunucuya gider.
 *   2. Musteri memnuniyeti: yalniz `can_rate` iken; puan + yorum gonderilir.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders, resetAuthStore } from '../utils'
import { useAuthStore } from '../../stores/authStore'

// Recharts jsdom'da olcum yapamaz (ResizeObserver/SVG); grafik bu testin
// konusu degil — basit kutularla degistirilir.
vi.mock('recharts', () => {
    const Box = ({ children }) => <div data-testid="chart">{children}</div>
    const Nil = () => null
    return { ResponsiveContainer: Box, BarChart: Box, Bar: Nil, CartesianGrid: Nil, Legend: Nil, Tooltip: Nil, XAxis: Nil, YAxis: Nil }
})

vi.mock('../../api/ticketsApi', async () => {
    const actual = await vi.importActual('../../api/ticketsApi')
    return {
        ...actual,
        ticketContextService: { get: vi.fn() },
        ticketHubService: { routingGroups: vi.fn(async () => [{ id: 'g1', name: 'DevOps' }]) },
        ticketHelpdeskService: { reports: vi.fn() },
        supportPortalService: {
            get: vi.fn(), rate: vi.fn(async () => ({})), reply: vi.fn(), reopen: vi.fn(),
            confirmClose: vi.fn(), cancel: vi.fn(), downloadUrl: vi.fn(() => '#'),
            openAttachmentSession: vi.fn(), uploadAttachmentContent: vi.fn(),
        },
    }
})

const { ticketContextService, ticketHelpdeskService, supportPortalService } = await import('../../api/ticketsApi')
const { default: TicketReportsPage } = await import('../../pages/tickets/TicketReportsPage')
const { default: CustomerTicketDetail } = await import('../../features/tickets/CustomerTicketDetail')

const REPORT = {
    totals: { created: 12, resolved: 9, backlog: 5, reopened: 1, median_first_response_minutes: 95, median_resolution_minutes: 1500 },
    sla: { first_response: { total: 10, met: 8, rate: 0.8 }, resolution: { total: 9, met: 9, rate: 1 } },
    csat: { responses: 4, average: 4.5, satisfied_rate: 0.75 },
    series: [{ date: '2026-10-13', created: 3, resolved: 2 }, { date: '2026-10-14', created: 1, resolved: 4 }],
    teams: [{ group_id: 'g1', name: 'DevOps', created: 12, resolved: 9, open: 5, median_resolution_minutes: 1500 }],
    agents: [], by_category: { bug: 8, question: 4 }, by_priority: { high: 3, normal: 9 },
}

beforeEach(() => {
    resetAuthStore()
    useAuthStore.setState({ isAuthenticated: true, user: { id: 'me' }, permissions: ['tickets.access'] })
    vi.clearAllMocks()
})

describe('talep raporlari', () => {
    it('KPI, SLA ve CSAT oranlarini gosterir; donem secimi sunucuya gider', async () => {
        const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 })
        ticketContextService.get.mockResolvedValue({ module_enabled: true, surface: 'hub', surfaces: ['hub'], permissions: [] })
        ticketHelpdeskService.reports.mockResolvedValue(REPORT)
        renderWithProviders(<TicketReportsPage />, { route: '/tickets/reports' })
        expect(await screen.findByText('80%')).toBeInTheDocument()
        expect(screen.getByText('8 of 10')).toBeInTheDocument()
        expect(screen.getByText('4.5 / 5')).toBeInTheDocument()
        expect(screen.getByText('1h 35m')).toBeInTheDocument()            // medyan ilk yanit
        const team = screen.getByRole('row', { name: /DevOps/ })
        expect(within(team).getByText('1d 1h')).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: '90 days' }))
        await waitFor(() => expect(ticketHelpdeskService.reports).toHaveBeenLastCalledWith({ days: 90, group_id: undefined }))
    })
})

describe('musteri memnuniyeti', () => {
    const TICKET = { id: 't1', ticket_number: 'TKT-000042', title: 'Yazici', status: 'resolved', category: 'bug',
        impact: 'single_user', version: 4, messages: [], assigned_group: null }

    it('puan + yorum gonderir', async () => {
        const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 })
        supportPortalService.get.mockResolvedValue({ ...TICKET, can_rate: true, csat: null })
        renderWithProviders(<CustomerTicketDetail ticketId="t1" open provider="p1" onClose={vi.fn()} />)
        const group = await screen.findByRole('group', { name: 'How was the support you received?' })
        const stars = within(group).getAllByRole('radio')
        await user.click(stars[3])                                         // 4 yildiz
        await user.type(screen.getByLabelText('Anything you want to add? (optional)'), 'Hizliydi')
        await user.click(screen.getByRole('button', { name: 'Send rating' }))
        expect(supportPortalService.rate).toHaveBeenCalledWith('t1', { rating: 4, comment: 'Hizliydi' }, 'p1')
    })

    it('puanlanamayan talepte blok yok', async () => {
        supportPortalService.get.mockResolvedValue({ ...TICKET, status: 'in_progress', can_rate: false })
        renderWithProviders(<CustomerTicketDetail ticketId="t1" open onClose={vi.fn()} />)
        expect(await screen.findByText('Yazici')).toBeInTheDocument()
        expect(screen.queryByRole('group', { name: 'How was the support you received?' })).toBeNull()
    })
})
