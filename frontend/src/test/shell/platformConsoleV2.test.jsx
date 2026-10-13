/**
 * =============================================================================
 * Super-admin konsolu (Faz 2) — davranis
 * =============================================================================
 *   1. Liste: TR karakter duyarsiz arama; satir → detay adresi.
 *   2. Detay > Moduller: secim degisince kaydet cubugu; kayit moduller +
 *      expected_version gonderir; Raporlar secimi Zaman girisini de acar.
 *   3. Sayfa yenilemesi: platform oturumu /me ile geri gelir, yoksa /login.
 * =============================================================================
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../../api/platformApi', () => ({
    platformService: {
        me: vi.fn(),
        overview: vi.fn().mockResolvedValue({ tenants: { total: 2, by_status: { active: 2 } } }),
        listTenants: vi.fn(),
        getTenant: vi.fn(),
        updateTenant: vi.fn(),
        listTenantMembers: vi.fn().mockResolvedValue([]),
        listAuditEvents: vi.fn().mockResolvedValue([]),
        logout: vi.fn(),
    },
}))

import { platformService } from '../../api/platformApi'
import PlatformConsole from '../../pages/platform/PlatformConsole'
import { usePlatformAuthStore } from '../../stores/platformAuthStore'

const TENANTS = [
    { id: 't1', slug: 'istanbul-grup', display_name: 'İstanbul Grup', status: 'active', modules: ['tickets'], active_members: 3, version: 4, email_domains: [] },
    { id: 't2', slug: 'acme', display_name: 'Acme', status: 'active', modules: ['time_entry', 'work'], active_members: 9, version: 2, email_domains: [] },
]

const setup = () => userEvent.setup({ delay: null, pointerEventsCheck: 0 })
const renderAt = (path) => render(
    <MemoryRouter initialEntries={[path]}>
        <Routes>
            <Route path="/platform-admin/*" element={<PlatformConsole />} />
            <Route path="/login" element={<div>LOGIN</div>} />
        </Routes>
    </MemoryRouter>,
)

beforeEach(() => {
    vi.clearAllMocks()
    platformService.listTenants.mockResolvedValue({ tenants: TENANTS })
    platformService.getTenant.mockImplementation((id) => Promise.resolve(TENANTS.find((x) => x.id === id)))
    usePlatformAuthStore.setState({ admin: { id: 'ops', email: 'ops@hermes.dev' }, isAuthenticated: true,
        permissions: ['platform.tenants.view', 'platform.tenants.manage', 'platform.audit.view'] })
})

describe('kiraci listesi', () => {
    it('TR karakter duyarsiz arar; satir detaya gider', async () => {
        const user = setup()
        renderAt('/platform-admin/tenants')
        await screen.findByText('Acme')
        await user.type(screen.getByRole('textbox', { name: /Search tenants/ }), 'istanbul')
        await waitFor(() => expect(screen.queryByText('Acme')).toBeNull())
        await user.click(screen.getByText('İstanbul Grup'))
        expect(await screen.findByRole('heading', { name: 'İstanbul Grup' })).toBeInTheDocument()
        expect(platformService.getTenant).toHaveBeenCalledWith('t1')
    })
})

describe('kiraci detayi > moduller', () => {
    it('Raporlar secimi Zaman girisini acar; kayit modul + surum gonderir', async () => {
        const user = setup()
        platformService.updateTenant.mockResolvedValue({ changed: {} })
        renderAt('/platform-admin/tenants/t1')
        await screen.findByRole('heading', { name: 'İstanbul Grup' })
        await user.click(screen.getByRole('button', { name: 'Modules' }))
        const reports = await screen.findByRole('switch', { name: /Reports and dashboard/ })
        expect(screen.queryByRole('region', { name: /unsaved/i })).toBeNull()
        await user.click(reports)
        expect(screen.getByRole('switch', { name: /^Time entry/ })).toHaveAttribute('aria-checked', 'true')
        expect(screen.getByRole('status')).toHaveTextContent(/Time entry was enabled too/)
        const bar = screen.getByRole('region', { name: /unsaved/i })
        await user.click(within(bar).getByRole('button', { name: 'Save modules' }))
        await waitFor(() => expect(platformService.updateTenant).toHaveBeenCalledWith('t1', {
            modules: ['time_entry', 'tickets', 'reports'], expected_version: 4,
        }))
    })
})

describe('oturum geri yukleme', () => {
    it('sayfa yenilenince /me ile geri gelir; cerez yoksa girise', async () => {
        const { default: App } = await import('../../App')
        const { QueryClientProvider } = await import('@tanstack/react-query')
        const { makeTestQueryClient } = await import('../utils')
        usePlatformAuthStore.setState({ admin: null, isAuthenticated: false, permissions: null })
        platformService.me.mockResolvedValue({ admin: { id: 'ops', email: 'ops@hermes.dev' }, permissions: ['platform.tenants.view'] })
        const view = render(
            <QueryClientProvider client={makeTestQueryClient()}>
                <MemoryRouter initialEntries={['/platform-admin/tenants']}><App /></MemoryRouter>
            </QueryClientProvider>,
        )
        expect(await screen.findByText('Acme')).toBeInTheDocument()
        expect(usePlatformAuthStore.getState().isAuthenticated).toBe(true)
        view.unmount()
        usePlatformAuthStore.setState({ admin: null, isAuthenticated: false, permissions: null })
        platformService.me.mockRejectedValue(new Error('401'))
        render(
            <QueryClientProvider client={makeTestQueryClient()}>
                <MemoryRouter initialEntries={['/platform-admin']}><App /></MemoryRouter>
            </QueryClientProvider>,
        )
        await waitFor(() => expect(usePlatformAuthStore.getState().isAuthenticated).toBe(false))
        expect((await screen.findAllByRole('button', { name: /Sign in/i })).length).toBeGreaterThan(0)
    })
})
