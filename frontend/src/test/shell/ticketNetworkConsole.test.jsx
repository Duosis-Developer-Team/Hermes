/**
 * =============================================================================
 * Super-admin > Talep agi (Faz 3.0) — davranis
 * =============================================================================
 *   1. Baglantilar SAGLAYICIYA gore kartlanir; ana destek once, uyarilar gorunur.
 *   2. Ekip degisimi ve kapatma iyimser kilidi (version) tasir.
 *   3. Yeni baglanti: talep eden + saglayici + ekip; modulu kapali talep eden
 *      icin uyari; sunucunun hata KODU yerel mesaja cevrilir.
 *   4. Eski /routing adresi talep agina yonlenir.
 * =============================================================================
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../../api/platformApi', () => ({
    platformService: {
        me: vi.fn(),
        overview: vi.fn().mockResolvedValue({}),
        listTenants: vi.fn(),
        supportNetwork: vi.fn(),
        supportProviders: vi.fn(),
        setNetworkLink: vi.fn(),
        disableNetworkLink: vi.fn(),
        listAuditEvents: vi.fn().mockResolvedValue([]),
        logout: vi.fn(),
    },
}))

import { platformService } from '../../api/platformApi'
import PlatformConsole from '../../pages/platform/PlatformConsole'
import { networkError } from '../../pages/platform/TicketNetwork'
import { usePlatformAuthStore } from '../../stores/platformAuthStore'

const DUOSIS = 'p-duosis'
const INTERTECH = 'p-intertech'
const LINKS = [
    { requester_tenant_id: 't-acme', requester_display_name: 'Acme', provider_tenant_id: DUOSIS,
      provider_display_name: 'Duosis', is_active: true, group_id: 'g1', group_name: 'Destek', version: 3,
      provider_available: true, requester_has_tickets: true },
    { requester_tenant_id: 't-globex', requester_display_name: 'Globex', provider_tenant_id: INTERTECH,
      provider_display_name: 'Intertech', is_active: true, group_id: 'g9', group_name: 'IT Servis', version: 1,
      provider_available: true, requester_has_tickets: false },
]
const PROVIDERS = [
    { tenant_id: INTERTECH, display_name: 'Intertech', is_support_tenant: false,
      groups: [{ id: 'g9', name: 'IT Servis', member_count: 4 }] },
    { tenant_id: DUOSIS, display_name: 'Duosis', is_support_tenant: true,
      groups: [{ id: 'g1', name: 'Destek', member_count: 6 }, { id: 'g2', name: 'Seviye 2', member_count: 2 }] },
]

const setup = () => userEvent.setup({ delay: null, pointerEventsCheck: 0 })
const renderAt = (path) => render(
    <MemoryRouter initialEntries={[path]}>
        <Routes>
            <Route path="/platform-admin/*" element={<PlatformConsole />} />
        </Routes>
    </MemoryRouter>,
)
const card = async (name) => (await screen.findByText(name, { selector: 'b' })).closest('.pc-net')

beforeEach(() => {
    vi.clearAllMocks()
    platformService.supportNetwork.mockResolvedValue({ items: LINKS, module_state: 'ok' })
    platformService.supportProviders.mockResolvedValue({ providers: PROVIDERS, module_state: 'ok' })
    platformService.setNetworkLink.mockResolvedValue({})
    platformService.disableNetworkLink.mockResolvedValue({})
    platformService.listTenants.mockResolvedValue({ tenants: [
        { id: 't-acme', display_name: 'Acme', modules: ['tickets'] },
        { id: 't-orbit', display_name: 'Orbit', modules: ['time_entry'] },
    ] })
    usePlatformAuthStore.setState({ admin: { id: 'ops', email: 'ops@example.com' }, isAuthenticated: true,
        permissions: ['platform.tenants.view', 'platform.tenants.manage'] })
})

describe('talep agi', () => {
    it('saglayiciya gore kartlar; ana destek once; modul uyarisi', async () => {
        renderAt('/platform-admin/network')
        const duosis = await card('Duosis')
        expect(within(duosis).getByText('Main support')).toBeInTheDocument()
        expect(within(duosis).getByText('Acme')).toBeInTheDocument()
        const intertech = await card('Intertech')
        expect(within(intertech).getByText('Tickets module off')).toBeInTheDocument()
        const cards = document.querySelectorAll('.pc-net')
        expect(cards[0]).toBe(duosis)
    })

    it('ekip degisimi ve kapatma surumu tasir', async () => {
        const user = setup()
        renderAt('/platform-admin/network')
        const duosis = await card('Duosis')
        await user.click(within(duosis).getByRole('combobox', { name: 'Team for Acme' }))
        await user.click(await screen.findByTitle('Seviye 2'))
        await waitFor(() => expect(platformService.setNetworkLink).toHaveBeenCalledWith(
            't-acme', DUOSIS, { group_id: 'g2', expected_version: 3 }))
        await user.click(within(duosis).getByRole('switch', { name: 'Allow Acme to open tickets' }))
        await waitFor(() => expect(platformService.disableNetworkLink).toHaveBeenCalledWith('t-acme', DUOSIS, 3))
    })

    it('yeni baglanti: talep eden + saglayici + ekip', async () => {
        const user = setup()
        renderAt('/platform-admin/network')
        await card('Duosis')
        await user.click(screen.getByRole('button', { name: /New connection/ }))
        const dialog = await screen.findByRole('dialog')
        await user.click(within(dialog).getByRole('combobox', { name: 'Requesting workspace' }))
        await user.click(await screen.findByTitle('Orbit'))
        // Talepler modulu kapali talep eden → uyari (portal gorunmez).
        expect(within(dialog).getByText(/Tickets module is off for this workspace/)).toBeInTheDocument()
        await user.click(within(dialog).getByRole('combobox', { name: 'Provider' }))
        await user.click(await screen.findByTitle('Duosis'))
        await user.click(within(dialog).getByRole('button', { name: 'Connect' }))
        await waitFor(() => expect(platformService.setNetworkLink).toHaveBeenCalledWith(
            't-orbit', DUOSIS, { group_id: 'g1' }))
    })

    it('sunucunun hata kodu yerel mesaja cevrilir', () => {
        const t = (k) => k
        const err = (code) => ({ response: { data: { detail: { code, message: 'server text' } } } })
        expect(networkError(t, err('provider_unavailable'))).toBe('platform.network.err.provider_unavailable')
        expect(networkError(t, err('something_else'))).toBe('server text')
        expect(networkError(t, {})).toBe('platform.network.saveFailed')
    })

    it('eski /routing adresi talep agina gider', async () => {
        renderAt('/platform-admin/routing')
        expect(await card('Duosis')).toBeTruthy()
        expect(platformService.supportNetwork).toHaveBeenCalled()
    })
})
