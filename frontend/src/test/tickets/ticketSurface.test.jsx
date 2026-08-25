/**
 * HERMES - Ticket yuzey karari ve navigasyon.
 *
 * Kritik kural: "hangi ekran?" sorusunu SUNUCU cevaplar. Frontend'de
 * tenant kimligi karsilastirmasi YOKTUR — support tenant'i bir ortam
 * degeridir ve degistiginde hicbir istemci kodu degismemelidir.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithProviders, resetAuthStore } from '../utils'
import { useAuthStore } from '../../stores/authStore'

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
        },
    }
})

const { ticketContextService } = await import('../../api/ticketsApi')
const { default: TicketHubPage } = await import(
    '../../pages/tickets/TicketHubPage'
)
const { default: SupportPortalPage } = await import(
    '../../pages/tickets/SupportPortalPage'
)

const context = (overrides = {}) => ({
    module_enabled: true,
    surface: 'hub',
    permissions: ['tickets.access'],
    can_create: false,
    has_scope: true,
    attachments_enabled: false,
    route: null,
    ...overrides,
})

describe('ticket surface', () => {
    beforeEach(() => {
        resetAuthStore()
        useAuthStore.setState({
            isAuthenticated: true,
            permissions: ['tickets.access'],
        })
        vi.clearAllMocks()
    })

    it('hub yuzeyi agent ekranini acar', async () => {
        ticketContextService.get.mockResolvedValue(context())
        renderWithProviders(<TicketHubPage />)
        expect(await screen.findByText('Tickets')).toBeInTheDocument()
    })

    it('grup uyeligi olmayan agent bos liste yerine ACIK bir aciklama gorur', async () => {
        ticketContextService.get.mockResolvedValue(
            context({ has_scope: false }),
        )
        renderWithProviders(<TicketHubPage />)
        expect(
            await screen.findByText(/No queue is visible to you/),
        ).toBeInTheDocument()
    })

    it('izin yoksa modul kapali gorunur (bos liste DEGIL)', async () => {
        ticketContextService.get.mockResolvedValue(
            context({ surface: 'unavailable', reason: 'missing_permission' }),
        )
        renderWithProviders(<TicketHubPage />)
        expect(
            await screen.findByText(/do not have access to the support module/),
        ).toBeInTheDocument()
    })

    it('modul yapilandirilmamissa durum acikca soylenir', async () => {
        ticketContextService.get.mockResolvedValue(
            context({ surface: 'unavailable', reason: 'not_configured' }),
        )
        renderWithProviders(<SupportPortalPage />)
        expect(
            await screen.findByText(/not configured on this environment/),
        ).toBeInTheDocument()
    })

    it('portal yuzeyinde hedef ekip READONLY gosterilir', async () => {
        ticketContextService.get.mockResolvedValue(context({
            surface: 'portal',
            can_create: true,
            route: { configured: true, group_name: 'DevOps Team',
                     route_version: 3 },
        }))
        renderWithProviders(<SupportPortalPage />)
        expect(
            await screen.findByText(/requests go to the DevOps Team team/),
        ).toBeInTheDocument()
    })

    it('route yoksa yeni ticket butonu KAPALIDIR ve neden aciklanir', async () => {
        ticketContextService.get.mockResolvedValue(context({
            surface: 'portal',
            can_create: false,
            route: { configured: false },
        }))
        renderWithProviders(<SupportPortalPage />)
        // Metin hem alt baslikta hem uyari kutusunda gecer; ikisi de
        // dogru — burada VARLIGI dogruluyoruz.
        expect(
            (await screen.findAllByText(
                /Support routing has not been configured/,
            )).length,
        ).toBeGreaterThan(0)
        expect(
            screen.getByRole('button', { name: /New request/ }),
        ).toBeDisabled()
    })
})
