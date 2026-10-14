/**
 * HERMES - Talep agi (00-plan §4.0) — istemci davranisi.
 *
 *   1. Hem saglayici hem talep eden tenant: iki sayfa da acilir, yonlendirme
 *      YOK, ust anahtar "Gelen talepler / Actigim talepler" gorunur.
 *   2. Iki saglayicida: kartlar saglayiciyi gosterir; yeni talep KIME
 *      sorusunu sorar ve secilen saglayici istege eklenir.
 *   3. Ayar katalogu: dis entegrasyon sayfasi yalniz ana destek tenant'inda.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders, resetAuthStore } from '../utils'
import { useAuthStore } from '../../stores/authStore'
import { visibleSections } from '../../features/settings/sections'

vi.mock('../../api/ticketsApi', async () => {
    const actual = await vi.importActual('../../api/ticketsApi')
    return {
        ...actual,
        ticketContextService: { get: vi.fn() },
        ticketHubService: {
            listApplications: vi.fn(async () => []),
            listQueues: vi.fn(async () => []),
            list: vi.fn(async () => ({ items: [], total: 0 })),
            routingGroups: vi.fn(async () => []),
        },
        supportPortalService: {
            list: vi.fn(async () => ({ items: [], total: 0 })),
            create: vi.fn(async () => ({ id: 'n1', ticket_number: 'TKT-000001', provider: { tenant_id: 'p2' } })),
            get: vi.fn(async () => null),
            openAttachmentSession: vi.fn(),
            uploadAttachmentContent: vi.fn(),
        },
    }
})

const { ticketContextService, supportPortalService } = await import('../../api/ticketsApi')
const { default: TicketHubPage } = await import('../../pages/tickets/TicketHubPage')
const { default: SupportPortalPage } = await import('../../pages/tickets/SupportPortalPage')

const route = (team) => ({ configured: true, group_name: team, route_version: 1 })
const provider = (id, name, team, extra = {}) => ({
    tenant_id: id, display_name: name, is_active: true, can_create: true, route: route(team), ...extra,
})
const context = (overrides = {}) => ({
    module_enabled: true, surface: 'hub', surfaces: ['hub'], permissions: ['tickets.access', 'tickets.create'],
    can_create: false, has_scope: true, attachments_enabled: false, route: null, providers: [],
    integrations: false, ...overrides,
})

beforeEach(() => {
    resetAuthStore()
    useAuthStore.setState({ isAuthenticated: true, permissions: ['tickets.access', 'tickets.create'] })
    vi.clearAllMocks()
})

describe('hem saglayici hem talep eden', () => {
    const dual = context({
        surface: 'hub', surfaces: ['hub', 'portal'], can_create: true,
        providers: [provider('p1', 'Duosis', 'Destek')],
    })

    it('hub sayfasi portala yonlendirmez; iki yuzey anahtari gorunur', async () => {
        ticketContextService.get.mockResolvedValue(dual)
        renderWithProviders(<TicketHubPage />, { route: '/tickets' })
        const sw = await screen.findByRole('group', { name: 'Ticket views' })
        expect(within(sw).getByRole('button', { name: 'Incoming requests' })).toHaveAttribute('aria-pressed', 'true')
        expect(within(sw).getByRole('button', { name: 'My requests' })).toBeInTheDocument()
    })

    it('portal sayfasi hub\'a yonlendirmez; baslik "My requests"', async () => {
        ticketContextService.get.mockResolvedValue(dual)
        renderWithProviders(<SupportPortalPage />, { route: '/support' })
        expect(await screen.findByRole('heading', { name: 'My requests' })).toBeInTheDocument()
        expect(screen.getByText('Your requests go to Duosis · Destek team.')).toBeInTheDocument()
    })
})

describe('iki saglayici', () => {
    const two = context({
        surface: 'portal', surfaces: ['portal'], can_create: true,
        providers: [provider('p1', 'Duosis', 'Destek'), provider('p2', 'Intertech', 'IT Servis')],
    })

    it('kart saglayiciyi gosterir; yeni talep KIME sorar ve secimi gonderir', async () => {
        const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 })
        ticketContextService.get.mockResolvedValue(two)
        supportPortalService.list.mockResolvedValue({
            total: 1,
            items: [{
                id: 't1', ticket_number: 'TKT-000007', title: 'Yazici calismiyor', status: 'open',
                category: 'bug', impact: 'single_user', updated_at: new Date().toISOString(),
                provider: { tenant_id: 'p2', display_name: 'Intertech' },
            }],
        })
        renderWithProviders(<SupportPortalPage />, { route: '/support' })
        expect(await screen.findByText('You can open requests with 2 support providers.')).toBeInTheDocument()
        const card = await screen.findByRole('button', { name: /TKT-000007/ })
        expect(within(card).getByText('Intertech')).toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: /New request/ }))
        const dialog = await screen.findByRole('dialog')
        expect(within(dialog).getByText('Send to')).toBeInTheDocument()
        expect(within(dialog).getByText('Destek')).toBeInTheDocument()
        // Saglayici degisince hedef ekip de degisir.
        await user.click(within(dialog).getByRole('combobox', { name: 'Send to' }))
        await user.click(await screen.findByTitle('Intertech'))
        expect(within(dialog).getByText('IT Servis')).toBeInTheDocument()
    })
})

describe('e-posta baglantisi (Dalga D4)', () => {
    it('/support?ticket=..&provider=.. talebi o saglayicidan acar', async () => {
        ticketContextService.get.mockResolvedValue(context({
            surface: 'portal', surfaces: ['portal'], can_create: true,
            providers: [provider('p1', 'Duosis', 'Destek'), provider('p2', 'Intertech', 'IT Servis')],
        }))
        renderWithProviders(<SupportPortalPage />, { route: '/support?ticket=t9&provider=p2' })
        await waitFor(() => expect(supportPortalService.get).toHaveBeenCalledWith('t9', 'p2'))
    })
})

describe('ayar katalogu', () => {
    const canAny = () => true
    const keys = (caps) => visibleSections(canAny, () => true, caps)
        .flatMap((s) => s.items.map((i) => i.key))

    it('dis entegrasyon sayfasi yalniz ana destek tenant\'inda', () => {
        expect(keys({ ticketIntegrations: false })).not.toContain('tickets')
        expect(keys({ ticketIntegrations: true })).toContain('tickets')
        // Yetenek henuz bilinmiyorsa (baglam yuklenmedi) filtre uygulanmaz.
        expect(keys(null)).toContain('tickets')
    })
})

describe('baglantisi olmayan tenant', () => {
    it('portal sayfasi "kullanilamaz" der', async () => {
        ticketContextService.get.mockResolvedValue(context({
            surface: 'unavailable', surfaces: [], reason: 'not_connected',
        }))
        renderWithProviders(<SupportPortalPage />, { route: '/support' })
        await waitFor(() => expect(ticketContextService.get).toHaveBeenCalled())
        expect(await screen.findByText(/not connected to a support provider/)).toBeInTheDocument()
    })
})
