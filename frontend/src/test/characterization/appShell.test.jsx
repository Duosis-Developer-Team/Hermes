/**
 * Characterization §4-1/2/3: auth bootstrap (legacy token temizligi +
 * /me restore), route guard yonlendirmesi ve authorized direct refresh.
 * Sayfa ic yapilari kapsam DISI — route loader'lari hafif stub'larla
 * degistirilir; boylece test yalniz KABUK davranisini dondurur.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { render } from '@testing-library/react'

vi.mock('../../routes/loaders', () => {
    const stub = (label) => () =>
        Promise.resolve({ default: () => <div>{label}</div> })
    return {
        routeLoaders: {
            login: stub('STUB-LOGIN'), authCallback: stub('STUB-CALLBACK'),
            timeEntry: stub('STUB-TIME-ENTRY'), tasks: stub('STUB-TASKS'),
            meetings: stub('STUB-MEETINGS'), dashboard: stub('STUB-DASH'),
            billableHours: stub('STUB-BILL'), reports: stub('STUB-REPORTS'),
            contracts: stub('STUB-CONTRACTS'), users: stub('STUB-USERS'),
            customers: stub('STUB-CUST'), projects: stub('STUB-PROJ'),
            workTypes: stub('STUB-WT'), activityTypes: stub('STUB-AT'),
            platforms: stub('STUB-PLAT'), workLines: stub('STUB-WL'),
            taskManagement: stub('STUB-TM'), apiManagement: stub('STUB-AM'),
            developerPortal: stub('STUB-DEV'),
        },
    }
})

vi.mock('../../services/api', () => ({
    authService: { getMe: vi.fn(), logout: vi.fn() },
    rbacService: { getMyPermissions: vi.fn() },
}))
// MainLayout'un ek servisleri (useTaskPermissions) coreApi'ye gider —
// hook'u stub'la: kabuk testinde task izinleri konu disi.
vi.mock('../../hooks/useTaskPermissions', () => ({
    useTaskPermissions: () => ({
        isLoading: false, canAccessAny: false, isTaskAdmin: false,
        assignableUserIds: [], assignableGroupIds: [],
        scopes: { task: {}, issue: {} },
    }),
}))

import App from '../../App'
import { authService, rbacService } from '../../services/api'
import { makeTestQueryClient, resetAuthStore } from '../utils'

const renderApp = (route) =>
    render(
        <QueryClientProvider client={makeTestQueryClient()}>
            <MemoryRouter initialEntries={[route]}>
                <App />
            </MemoryRouter>
        </QueryClientProvider>
    )

beforeEach(() => {
    resetAuthStore()
    vi.clearAllMocks()
    localStorage.clear()
})

describe('auth bootstrap', () => {
    it('legacy hermes-auth token localStorage\'dan silinir', async () => {
        localStorage.setItem('hermes-auth', 'TEST_ONLY_LEGACY_TOKEN')
        authService.getMe.mockRejectedValue(new Error('no session'))
        renderApp('/time-entry')
        await waitFor(() =>
            expect(localStorage.getItem('hermes-auth')).toBeNull()
        )
    })

    it('gecersiz oturum → login\'e yonlendirilir (guard)', async () => {
        authService.getMe.mockRejectedValue(new Error('no session'))
        renderApp('/time-entry')
        expect(await screen.findByText('STUB-LOGIN')).toBeInTheDocument()
    })
})

describe('session restore + direct refresh', () => {
    it('cookie gecerliyken direct URL refresh kullaniciyi SAYFADA tutar', async () => {
        authService.getMe.mockResolvedValue({
            id: 'u1', email: 't@x.com', is_admin: false,
        })
        rbacService.getMyPermissions.mockResolvedValue({ permissions: [] })
        renderApp('/time-entry')
        expect(await screen.findByText('STUB-TIME-ENTRY')).toBeInTheDocument()
        expect(screen.queryByText('STUB-LOGIN')).not.toBeInTheDocument()
    })

    it('izinsiz kullanici korumali admin route\'undan time-entry\'ye duser', async () => {
        authService.getMe.mockResolvedValue({
            id: 'u1', email: 't@x.com', is_admin: false,
        })
        rbacService.getMyPermissions.mockResolvedValue({ permissions: [] })
        renderApp('/api-management')
        expect(await screen.findByText('STUB-TIME-ENTRY')).toBeInTheDocument()
    })

    it('api.manage izni olan kullanici API Management\'i acar', async () => {
        authService.getMe.mockResolvedValue({
            id: 'u1', email: 't@x.com', is_admin: false,
        })
        rbacService.getMyPermissions.mockResolvedValue({
            permissions: ['api.manage'],
        })
        renderApp('/api-management')
        expect(await screen.findByText('STUB-AM')).toBeInTheDocument()
    })
})
