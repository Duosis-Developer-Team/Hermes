/**
 * HERMES - Musterilerim (hub): talep acmamis musteri de gorunur; karta
 * tiklayinca talep listesi o musteriye suzulur.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders, resetAuthStore } from '../utils'
import { useAuthStore } from '../../stores/authStore'

vi.mock('../../api/ticketsApi', async () => {
    const actual = await vi.importActual('../../api/ticketsApi')
    return {
        ...actual,
        ticketContextService: { get: vi.fn() },
        ticketHelpdeskService: { myCustomers: vi.fn() },
    }
})

const { ticketContextService, ticketHelpdeskService } = await import('../../api/ticketsApi')
const { default: CustomersPage } = await import('../../pages/tickets/CustomersPage')
const { Route, Routes, useLocation } = await import('react-router-dom')

function Where() {
    const location = useLocation()
    return <p data-testid="where">{location.pathname + location.search}</p>
}

beforeEach(() => {
    resetAuthStore()
    useAuthStore.setState({ isAuthenticated: true, permissions: ['tickets.access'] })
    vi.clearAllMocks()
})

describe('musterilerim', () => {
    it('talepsiz musteri de listelenir; kart talepleri suzer', async () => {
        const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 })
        ticketContextService.get.mockResolvedValue({
            module_enabled: true, surface: 'hub', surfaces: ['hub'], permissions: ['tickets.access'], providers: [],
        })
        ticketHelpdeskService.myCustomers.mockResolvedValue([
            { id: 's1', display_name: 'Defacto', kind: 'company', application: 'Hermes',
              team: { id: 'g1', name: 'Destek Ekibi' }, open_count: 0, total_count: 0, last_activity_at: null },
            { id: 's2', display_name: 'Acme Industries', kind: 'workspace', application: 'Hermes',
              team: { id: 'g1', name: 'Destek Ekibi' }, open_count: 2, total_count: 5, last_activity_at: new Date().toISOString() },
        ])
        renderWithProviders(
            <Routes>
                <Route path="/tickets/customers" element={<CustomersPage />} />
                <Route path="/tickets" element={<Where />} />
            </Routes>,
            { route: '/tickets/customers' },
        )
        expect(await screen.findByText('Defacto')).toBeInTheDocument()
        expect(screen.getByText('Company account')).toBeInTheDocument()
        expect(screen.getByText('No requests yet')).toBeInTheDocument()

        await user.type(screen.getByLabelText('Search customer, team or application'), 'acme')
        expect(screen.queryByText('Defacto')).toBeNull()
        await user.clear(screen.getByLabelText('Search customer, team or application'))

        await user.click(screen.getByRole('button', { name: 'Open requests of Defacto' }))
        expect(screen.getByTestId('where')).toHaveTextContent('/tickets?queue=all&customer=s1')
    })
})
