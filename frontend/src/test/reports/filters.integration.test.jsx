/**
 * =============================================================================
 * Reports — filtre sozlesmesi (GERCEK mount, gercek etkilesim)
 * =============================================================================
 * KAPATILAN REGRESYON: premium redesign turunda Project/Type/Platform
 * filtreleri "More filters" arkasina alinmisti — filtreler silinmedi ama
 * kullanici icin GORUNMEZ oldu. Bu testler yalnizca DOM varligini degil,
 * acilip secim yapilabildigini ve secimin ISTEGE yansidigini kilitler.
 *
 * Mobil: ayni kontroller Filters sheet'inde render edilir (masaustunde
 * inline). Ayni erisilebilir adin iki kez DOM'da bulunmamasi icin render
 * seviyesinde ayrilir — test her iki modu ayri ayri surer.
 * =============================================================================
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'

const reportsService = {
    getJsonUserLogs: vi.fn(),
    getJsonGlobalDetailed: vi.fn(),
    getJsonMatrix: vi.fn(),
    exportGlobalDetailed: vi.fn(),
    exportMatrix: vi.fn(),
    exportExcel: vi.fn(),
    getDashboard: vi.fn(),
}
const authService = { getUsers: vi.fn(), lookupUsers: vi.fn() }
const customerService = { getAll: vi.fn() }
const projectService = { getAll: vi.fn() }
const workTypeService = { getAll: vi.fn() }
const platformService = { getAll: vi.fn() }

vi.mock('../../services/api', () => ({
    reportsService, authService, customerService, projectService,
    workTypeService, platformService,
}))

const ReportsPage = (await import('../../pages/ReportsPage')).default
const { useAuthStore } = await import('../../stores/authStore')
const { makeTestQueryClient, resetAuthStore } = await import('../utils')

const CUSTOMERS = [{ id: 'c1', name: 'Vakko' }]
const PROJECTS = [{ id: 'p1', name: 'ATM Yenileme' }, { id: 'p2', name: 'Portal' }]
const TYPES = [{ id: 'w1', name: 'Development' }, { id: 'w2', name: 'Support' }]
const PLATFORMS = [{ id: 'pl1', name: 'Web' }, { id: 'pl2', name: 'Mobile' }]

const setMobile = (isMobile) => {
    window.matchMedia = (query) => ({
        matches: isMobile && query.includes('max-width'),
        media: query,
        addEventListener: () => {}, removeEventListener: () => {},
        addListener: () => {}, removeListener: () => {},
        dispatchEvent: () => false, onchange: null,
    })
}

const renderReports = () =>
    render(
        <QueryClientProvider client={makeTestQueryClient()}>
            <ReportsPage />
        </QueryClientProvider>
    )

beforeEach(() => {
    vi.clearAllMocks()
    resetAuthStore()
    // Reports RBAC kapisi: izinler cozulmeden sayfa RENDER EDILMEZ
    // (fail-closed). Test gercek kapiyi kullanir, atlamaz.
    useAuthStore.setState({
        user: { id: 'u1', email: 'a@x.com', full_name: 'Ada', is_admin: true },
        isAuthenticated: true,
        permissions: ['reports.view'],
    })
    setMobile(false)
    authService.getUsers.mockResolvedValue({ data: [{ id: 'u1', full_name: 'Ada Lovelace' }] })
    customerService.getAll.mockResolvedValue(CUSTOMERS)
    projectService.getAll.mockResolvedValue(PROJECTS)
    workTypeService.getAll.mockResolvedValue(TYPES)
    platformService.getAll.mockResolvedValue(PLATFORMS)
    reportsService.getJsonUserLogs.mockResolvedValue({ data: [] })
    reportsService.getJsonGlobalDetailed.mockResolvedValue({ data: [] })
    reportsService.getJsonMatrix.mockResolvedValue({ data: [] })
})

const user = () => userEvent.setup({ delay: null })

describe('masaustu: temel filtreler DOGRUDAN gorunur', () => {
    it('Project, Type ve Platform gizli DEGIL', async () => {
        renderReports()
        expect(await screen.findByRole('combobox', { name: 'Filter by project' }))
            .toBeInTheDocument()
        expect(screen.getByRole('combobox', { name: 'Filter by type' }))
            .toBeInTheDocument()
        expect(screen.getByRole('combobox', { name: 'Filter by platform' }))
            .toBeInTheDocument()
        // Regresyonun sebebi olan gizleme aksiyonu ARTIK YOK.
        expect(screen.queryByRole('button', { name: /More filters/i })).toBeNull()
    })

    it('Project secimi rapor sorgusuna GECER', async () => {
        const u = user()
        renderReports()
        const box = await screen.findByRole('combobox', { name: 'Filter by project' })
        await u.click(box)
        await u.click(await screen.findByTitle('ATM Yenileme'))
        await waitFor(() => {
            const calls = reportsService.getJsonUserLogs.mock.calls
            const last = calls[calls.length - 1]?.[0] || {}
            expect(last.project_ids).toContain('p1')
        })
    })

    it('Type secimi rapor sorgusuna GECER', async () => {
        const u = user()
        renderReports()
        const box = await screen.findByRole('combobox', { name: 'Filter by type' })
        await u.click(box)
        await u.click(await screen.findByTitle('Development'))
        await waitFor(() => {
            const calls = reportsService.getJsonUserLogs.mock.calls
            const last = calls[calls.length - 1]?.[0] || {}
            expect(last.work_type_ids).toContain('w1')
        })
    })

    it('Platform secimi rapor sorgusuna GECER', async () => {
        const u = user()
        renderReports()
        const box = await screen.findByRole('combobox', { name: 'Filter by platform' })
        await u.click(box)
        await u.click(await screen.findByTitle('Web'))
        await waitFor(() => {
            const calls = reportsService.getJsonUserLogs.mock.calls
            const last = calls[calls.length - 1]?.[0] || {}
            expect(last.platform_ids).toContain('pl1')
        })
    })

    it('birlikte secilince parametreler BIRLIKTE gider ve Clear hepsini sifirlar', async () => {
        const u = user()
        renderReports()
        await u.click(await screen.findByRole('combobox', { name: 'Filter by project' }))
        await u.click(await screen.findByTitle('ATM Yenileme'))
        await u.click(screen.getByRole('combobox', { name: 'Filter by type' }))
        await u.click(await screen.findByTitle('Support'))
        await waitFor(() => {
            const last = reportsService.getJsonUserLogs.mock.calls.at(-1)?.[0] || {}
            expect(last.project_ids).toContain('p1')
            expect(last.work_type_ids).toContain('w2')
        })

        await u.click(screen.getByRole('button', { name: /Clear Filters/i }))
        await waitFor(() => {
            const last = reportsService.getJsonUserLogs.mock.calls.at(-1)?.[0] || {}
            expect(last.project_ids || []).toHaveLength(0)
            expect(last.work_type_ids || []).toHaveLength(0)
        })
    })
})

describe('mobil: ayni filtreler Filters sheet icinde', () => {
    it('sheet acilinca Project/Type/Platform gorunur', async () => {
        setMobile(true)
        const u = user()
        renderReports()
        const trigger = await screen.findByRole('button', { name: /Filters/i })
        // Sayfada dogrudan select YIGINI YOK (mobilde inline render edilmez).
        expect(screen.queryByRole('combobox', { name: 'Filter by project' })).toBeNull()

        await u.click(trigger)
        const sheet = await screen.findByRole('dialog')
        expect(within(sheet).getByRole('combobox', { name: 'Filter by project' }))
            .toBeInTheDocument()
        expect(within(sheet).getByRole('combobox', { name: 'Filter by type' }))
            .toBeInTheDocument()
        expect(within(sheet).getByRole('combobox', { name: 'Filter by platform' }))
            .toBeInTheDocument()
    })
})
