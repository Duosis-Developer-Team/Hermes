/**
 * HERMES - Dalga D (00-plan §4.4) — istemci.
 *   D1 Birlestirme: yalniz ayni musterinin acik talepleri aday; hedef secilince
 *      musteri mesaji dolar; onay birlestirme ucunu cagirir.
 *   D2 Otomasyon: editor zamanli kurali (yas + kosul + eylem) dogru govdeyle kaydeder.
 *   D3 Yardim merkezi: arama + makale + oy; yeni talep yazilirken oneriler.
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
        ticketHubService: {
            list: vi.fn(async () => ({ items: [] })),
            listApplications: vi.fn(async () => []),
            routingGroups: vi.fn(async () => []),
        },
        ticketHelpdeskService: {
            requesterHistory: vi.fn(), merge: vi.fn(),
            tags: vi.fn(async () => []), customers: vi.fn(async () => []),
            automations: vi.fn(async () => []), createAutomation: vi.fn(async () => ({})),
        },
        ticketContextService: { get: vi.fn() },
        helpCenterService: {
            categories: vi.fn(async () => [{ id: 'c1', name: 'Hesap', article_count: 1 }]),
            articles: vi.fn(async () => [{ id: 'a1', title: 'Şifre sıfırlama', summary: 'Unuttuysanız' }]),
            article: vi.fn(async () => ({ id: 'a1', title: 'Şifre sıfırlama', body: '**Adım 1**', my_vote: null })),
            vote: vi.fn(async () => ({ id: 'a1', title: 'Şifre sıfırlama', body: '**Adım 1**', my_vote: true })),
            suggest: vi.fn(async () => [{ id: 'a1', title: 'Şifre sıfırlama' }]),
        },
    }
})

const { ticketHelpdeskService, ticketContextService, helpCenterService } = await import('../../api/ticketsApi')
const { default: MergeModal } = await import('../../features/tickets/MergeModal')
const { default: AutomationsTab } = await import('../../pages/tickets/AutomationsTab')
const { default: HelpCenterPage } = await import('../../pages/tickets/HelpCenterPage')
const { default: CreateTicketModal } = await import('../../features/tickets/CreateTicketModal')
const { Route, Routes } = await import('react-router-dom')

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


describe('otomasyon editoru', () => {
    it('zamanli kurali yas + kosul + eylemle kaydeder', async () => {
        const user = setup()
        renderWithProviders(<AutomationsTab />)
        await user.click(await screen.findByRole('button', { name: /New rule/ }))
        const dialog = await screen.findByRole('dialog')
        await user.type(within(dialog).getByLabelText('Rule name'), 'Hatirlatma')
        await user.click(within(dialog).getByRole('button', { name: 'On a schedule (hourly)' }))
        const hours = within(dialog).getByLabelText('Hours')
        await user.clear(hours)
        await user.type(hours, '72')
        await user.click(within(dialog).getByRole('combobox', { name: 'Add condition' }))
        await user.click(await screen.findByTitle('Status is'))
        await user.click(within(dialog).getByRole('combobox', { name: 'Status is' }))
        await user.click(await screen.findByTitle('Waiting on customer'))
        await user.click(within(dialog).getByRole('combobox', { name: 'Add action' }))
        await user.click(await screen.findByTitle('Reply to customer'))
        await user.type(within(dialog).getByLabelText('Reply to customer'), 'Yanitinizi bekliyoruz.')
        await user.click(within(dialog).getByRole('button', { name: 'Save' }))
        await waitFor(() => expect(ticketHelpdeskService.createAutomation).toHaveBeenCalledWith({
            name: 'Hatirlatma', trigger: 'schedule', is_active: true, position: 0,
            conditions: { age: { basis: 'updated', hours: 72 }, status: ['waiting_customer'] },
            actions: [{ type: 'public_reply', body: 'Yanitinizi bekliyoruz.' }],
        }))
    })
})


describe('yardim merkezi', () => {
    it('makaleyi acar ve oy verdirir', async () => {
        const user = setup()
        ticketContextService.get.mockResolvedValue({ module_enabled: true, surface: 'portal', surfaces: ['portal'],
            permissions: ['tickets.access'], providers: [{ tenant_id: 'p1', display_name: 'Duosis', can_create: true, is_active: true }] })
        renderWithProviders(
            <Routes>
                <Route path="/support/help" element={<HelpCenterPage />} />
                <Route path="/support/help/:articleId" element={<HelpCenterPage />} />
            </Routes>,
            { route: '/support/help' },
        )
        expect(await screen.findByRole('button', { name: /Hesap/ })).toBeInTheDocument()
        await user.click(await screen.findByRole('button', { name: /Şifre sıfırlama/ }))
        const drawer = await screen.findByRole('dialog')
        expect(await within(drawer).findByText('Adım 1')).toBeInTheDocument()
        await user.click(within(drawer).getByRole('button', { name: /Yes/ }))
        await waitFor(() => expect(helpCenterService.vote).toHaveBeenCalledWith('a1', true, 'p1'))
    })

    it('yeni talep basligi yazilinca makale onerir', async () => {
        const user = setup()
        const onOpenArticle = vi.fn()
        renderWithProviders(
            <CreateTicketModal open onCancel={vi.fn()} onSubmit={vi.fn()} routeReady groupName="Destek"
                               suggest={helpCenterService.suggest} onOpenArticle={onOpenArticle} />,
        )
        await user.type(screen.getByLabelText('Title'), 'Şifremi unuttum')
        const region = await screen.findByRole('region', { name: 'These articles might help' }, { timeout: 2000 })
        await user.click(within(region).getByRole('button', { name: 'Şifre sıfırlama' }))
        expect(onOpenArticle).toHaveBeenCalledWith('a1')
        expect(helpCenterService.suggest).toHaveBeenCalledWith('Şifremi unuttum')
    })
})
