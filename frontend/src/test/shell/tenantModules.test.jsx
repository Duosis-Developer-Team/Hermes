/**
 * =============================================================================
 * Tenant modulleri (docs/tenant-platform/00-plan.md §2) — arayuz katmani
 * =============================================================================
 *   1. Katalog backend/shared/modules.py ile birebir (kodlar, sira,
 *      bagimlilik, izin → modul).
 *   2. Acilis: tenant'in ACIK ilk modulu (sabit /time-entry degil).
 *   3. Kabuk: kapali modul menude yok; tenant `modules` tasimiyorsa hepsi acik.
 *   4. Rota: kapali modulun rotasi acilis sayfasina yonlenir.
 *   5. Ayarlar: modulu kapali bolum/sayfa gorunmez.
 * =============================================================================
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../routes/loaders', () => {
    const stub = (label) => () => Promise.resolve({ default: () => <div>{label}</div> })
    return {
        routeLoaders: {
            login: stub('STUB-LOGIN'), authCallback: stub('STUB-CALLBACK'),
            home: stub('STUB-HOME'), timeEntry: stub('STUB-TIME-ENTRY'), tasks: stub('STUB-TASKS'),
            meetings: stub('STUB-MEETINGS'), dashboard: stub('STUB-DASH'),
            ticketHub: stub('STUB-TICKETS'), supportPortal: stub('STUB-PORTAL'),
            developerPortal: stub('STUB-DEV'), workLink: stub('STUB-WORKLINK'),
            settings: () => import('../../pages/settings/SettingsPage'),
        },
        loaderByPath: {},
    }
})
vi.mock('../../services/api', () => ({
    authService: { getMe: vi.fn(), logout: vi.fn(), lookupUsers: vi.fn().mockResolvedValue([]) },
    rbacService: { getMyPermissions: vi.fn() },
    customerService: { getAll: vi.fn().mockResolvedValue([]) },
    projectService: { getAll: vi.fn().mockResolvedValue([]) },
    homeService: { week: vi.fn().mockResolvedValue({ days: [] }), team: vi.fn() },
    meetingService: { syncMe: vi.fn().mockResolvedValue({ ok: true }) },
}))
vi.mock('../../api/ticketsApi', () => ({
    ticketContextService: { get: vi.fn().mockResolvedValue({ surface: 'hub', permissions: [] }) },
}))
vi.mock('../../hooks/useTaskPermissions', () => ({
    useTaskPermissions: () => ({
        isLoading: false, canAccessAny: true, isTaskAdmin: false,
        assignableUserIds: [], assignableGroupIds: [], scopes: { task: {}, issue: {} },
    }),
}))

import App from '../../App'
import { authService, meetingService, rbacService } from '../../services/api'
import { makeTestQueryClient, resetAuthStore } from '../utils'
import {
    MODULE_CODES, MODULE_REQUIRES, PERMISSION_MODULE, landingPath,
} from '../../features/modules/catalog'
import { visibleSections } from '../../features/settings/sections'

const renderApp = (route) => render(
    <QueryClientProvider client={makeTestQueryClient()}>
        <MemoryRouter initialEntries={[route]}><App /></MemoryRouter>
    </QueryClientProvider>,
)

const signIn = (modules, permissions = []) => {
    authService.getMe.mockResolvedValue({
        id: 'u1', email: 't@x.com', is_admin: true,
        tenant: { id: 't1', slug: 'acme', display_name: 'Acme', ...(modules ? { modules } : {}) },
    })
    rbacService.getMyPermissions.mockResolvedValue({ permissions })
}

beforeEach(() => {
    resetAuthStore()
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
})

describe('katalog', () => {
    it('backend/shared/modules.py ile birebir', () => {
        const py = readFileSync(join('..', 'backend/shared/modules.py'), 'utf8')
        const block = (name) => py.slice(py.indexOf(name), py.indexOf(')', py.indexOf(name)))
        const order = [...block('ALL_MODULES: Tuple').matchAll(/Module\.([A-Z_]+)/g)].map((m) => m[1].toLowerCase())
        expect(order).toEqual(MODULE_CODES)
        // Izin → modul
        const permBlock = py.slice(py.indexOf('PERMISSION_MODULE'), py.indexOf('}', py.indexOf('PERMISSION_MODULE')))
        const perms = readFileSync(join('..', 'backend/shared/permissions.py'), 'utf8')
        const codeOf = (constName) => perms.match(new RegExp(`${constName} = "([^"]+)"`))[1]
        const pairs = [...permBlock.matchAll(/Perm\.([A-Z_]+): Module\.([A-Z_]+)/g)]
            .map(([, c, m]) => [codeOf(c), m.toLowerCase()])
        expect(Object.fromEntries(pairs)).toEqual(PERMISSION_MODULE)
        expect(py).toMatch(/Module\.REPORTS: \(Module\.TIME_ENTRY,\)/)
        expect(MODULE_REQUIRES).toEqual({ reports: ['time_entry'] })
    })

    it('acilis: acik ilk modul; modul yoksa ana sayfa; liste yoksa eski davranis', () => {
        expect(landingPath({ modules: ['tickets', 'reports'] })).toBe('/tickets')
        expect(landingPath({ modules: ['meetings', 'tickets'] })).toBe('/meetings')
        expect(landingPath({ modules: [] })).toBe('/')
        expect(landingPath({})).toBe('/time-entry')
    })

    it('ayarlar: modulu kapali sayfa gorunmez', () => {
        const canAny = () => true
        const only = (mods) => (m) => mods.includes(m)
        const keys = (mods) => visibleSections(canAny, only(mods)).flatMap((s) => s.items.map((i) => i.key))
        const ticketsOnly = keys(['tickets'])
        expect(ticketsOnly).toContain('users')        // cekirdek
        expect(ticketsOnly).toContain('tickets')
        for (const k of ['capacity', 'pm', 'work-types', 'customers', 'projects', 'api']) {
            expect(ticketsOnly).not.toContain(k)
        }
        expect(keys(['work'])).toEqual(expect.arrayContaining(['pm', 'customers', 'projects']))
    })
})

describe('kabuk + rotalar', () => {
    const tabs = () => [...document.querySelectorAll('.island-tab')].map((el) => el.textContent.trim())

    it('yalniz talep: zaman/is/toplanti sekmesi yok, talepler var; toplanti senkronu yok', async () => {
        signIn(['tickets'], ['tickets.access'])
        renderApp('/')
        await waitFor(() => expect(tabs()).toContain('Tickets'))
        expect(tabs()).not.toContain('Time Entry')
        expect(tabs()).not.toContain('Meetings')
        expect(tabs().some((x) => /Project/.test(x))).toBe(false)
        expect(meetingService.syncMe).not.toHaveBeenCalled()
    })

    it('kapali modul rotasi acilis sayfasina yonlenir', async () => {
        signIn(['tickets'], ['tickets.access'])
        renderApp('/time-entry')
        expect(await screen.findByText('STUB-TICKETS')).toBeInTheDocument()
        expect(screen.queryByText('STUB-TIME-ENTRY')).toBeNull()
    })

    it('modul listesi gelmezse (eski oturum) her sey acik', async () => {
        signIn(undefined, [])
        renderApp('/meetings')
        expect(await screen.findByText('STUB-MEETINGS')).toBeInTheDocument()
        await waitFor(() => expect(tabs()).toContain('Time Entry'))
    })
})
