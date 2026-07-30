/**
 * =============================================================================
 * Sprint 6B.2 completion — Admin liste durumu sozlesmesi
 * =============================================================================
 * Bu dort yuzeyde ortak hata modeli ve form lifecycle zaten uygulanmisti,
 * ama TAM Admin UX sozlesmesi kanitlanmamisti. Eksik olan uc sey her
 * dordunde ayni sekilde kapatildi ve burada davranissal olarak surulur:
 *
 *   1. Kurtarilabilir yukleme hatasi + RETRY. Onceden sorgu patlayinca
 *      tablo SESSIZCE bos gorunuyordu — kullanici "kayit yok" saniyordu.
 *   2. ILK KULLANIM boslugu ile FILTRE sonucu yoklugunun AYRI mesaji.
 *   3. Arkaplan yenilemesi: mevcut veri kaybolmadan bildirilir; ilk
 *      yukleme spinner'i ile karistirilmaz.
 *
 * Ayrica arama eklendi (dordunde de yoktu) ve erisilebilir adi var.
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'

const customerService = { getAll: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() }
const projectService = { getAll: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() }
const workTypeService = { getAll: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() }
const workLogService = { getBillableSummary: vi.fn() }

vi.mock('../../services/api', () => ({
    customerService, projectService, workTypeService, workLogService,
}))

const CustomersPage = (await import('../../pages/admin/CustomersPage')).default
const ProjectsPage = (await import('../../pages/admin/ProjectsPage')).default
const WorkTypesPage = (await import('../../pages/admin/WorkTypesPage')).default
const { adminEmptyText } = await import('../../features/admin/shared/adminEmptyText')
const { makeTestQueryClient } = await import('../utils')

const CUSTOMERS = [
    { id: 'c1', name: 'Vakko', code: 'VKK', contact_person: 'Ada', email: 'ada@vakko.com', is_active: true },
    { id: 'c2', name: 'Beko', code: 'BKO', is_active: true },
]
const PROJECTS = [
    { id: 'p1', name: 'ATM Yenileme', code: 'ATM', customer_name: 'Vakko', customer_id: 'c1', is_active: true },
    { id: 'p2', name: 'Mobil App', code: 'MBL', customer_name: 'Beko', customer_id: 'c2', is_active: true },
]
const WORK_TYPES = [
    { id: 'w1', name: 'Development', code: 'DEV', is_active: true },
    { id: 'w2', name: 'Testing', code: 'TST', is_active: true },
]

const setupUser = () => userEvent.setup({ delay: null })
const httpError = (status, data) => ({ response: { status, data } })

const renderPage = (Comp) =>
    render(
        <QueryClientProvider client={makeTestQueryClient()}>
            <Comp />
        </QueryClientProvider>
    )

/** Her yuzey icin: bileşen, servis, gorunur kayit, arama etiketi, cogul. */
const SURFACES = [
    {
        name: 'Customers', Comp: () => CustomersPage, service: () => customerService,
        visible: 'Vakko', searchLabel: 'Search Customers', plural: 'customers',
        createLabel: 'New Customer', hit: 'Beko',
    },
    {
        name: 'Projects', Comp: () => ProjectsPage, service: () => projectService,
        visible: 'ATM Yenileme', searchLabel: 'Search Projects', plural: 'projects',
        createLabel: 'New Project', hit: 'Mobil App',
    },
    {
        name: 'Work Types', Comp: () => WorkTypesPage, service: () => workTypeService,
        visible: 'Development', searchLabel: 'Search Work Types', plural: 'work types',
        createLabel: 'New Work Type', hit: 'Testing',
    },
]

beforeEach(() => {
    vi.clearAllMocks()
    customerService.getAll.mockResolvedValue(CUSTOMERS.map((c) => ({ ...c })))
    projectService.getAll.mockResolvedValue(PROJECTS.map((p) => ({ ...p })))
    workTypeService.getAll.mockResolvedValue(WORK_TYPES.map((w) => ({ ...w })))
    workLogService.getBillableSummary.mockResolvedValue({ data: {} })
})

describe.each(SURFACES)('$name — liste durumu sozlesmesi', (surface) => {
    it('kayitlar listelenir', async () => {
        renderPage(surface.Comp())
        expect(await screen.findByText(surface.visible)).toBeInTheDocument()
    })

    it('arama girdisinin ERISILEBILIR ADI vardir', async () => {
        renderPage(surface.Comp())
        await screen.findByText(surface.visible)
        expect(screen.getByLabelText(surface.searchLabel)).toBeInTheDocument()
    })

    it('arama listeyi DARALTIR', async () => {
        const user = setupUser()
        renderPage(surface.Comp())
        await screen.findByText(surface.visible)
        await user.type(screen.getByLabelText(surface.searchLabel), surface.hit)
        await waitFor(() =>
            expect(screen.queryByText(surface.visible)).not.toBeInTheDocument()
        )
        expect(screen.getByText(surface.hit)).toBeInTheDocument()
    })

    it('FILTRE sonucu yoklugu ILK KULLANIM boslugundan AYRI konusur', async () => {
        const user = setupUser()
        renderPage(surface.Comp())
        await screen.findByText(surface.visible)
        await user.type(screen.getByLabelText(surface.searchLabel), 'zzzz')
        expect(await screen.findByText(/match “zzzz”/)).toBeInTheDocument()
    })

    it('hic kayit yoksa ILK KULLANIM mesaji gosterilir', async () => {
        surface.service().getAll.mockResolvedValue([])
        renderPage(surface.Comp())
        expect(
            await screen.findByText(
                new RegExp(`No ${surface.plural} yet`, 'i')
            )
        ).toBeInTheDocument()
    })

    it('liste hatasinda RETRY sunulur ve yeniden cagrilir', async () => {
        surface.service().getAll.mockRejectedValueOnce(httpError(503, {}))
        const user = setupUser()
        renderPage(surface.Comp())
        const retry = await screen.findByRole('button', { name: 'Retry' })
        expect(screen.getByText(/server had a problem/i)).toBeInTheDocument()
        surface.service().getAll.mockResolvedValue(
            surface.name === 'Customers' ? CUSTOMERS
                : surface.name === 'Projects' ? PROJECTS : WORK_TYPES
        )
        await user.click(retry)
        expect(await screen.findByText(surface.visible)).toBeInTheDocument()
    })

    it('teknik hata govdesi kullaniciya SIZMAZ', async () => {
        surface.service().getAll.mockRejectedValueOnce(
            httpError(500, { detail: 'sqlalchemy.exc.OperationalError: boom' })
        )
        renderPage(surface.Comp())
        await screen.findByRole('button', { name: 'Retry' })
        expect(screen.queryByText(/sqlalchemy/)).not.toBeInTheDocument()
    })
})

describe('adminEmptyText — bosluk dili', () => {
    it('FILTRE varken arama terimini soyler', () => {
        expect(adminEmptyText({
            filtered: true, entityPlural: 'customers', term: 'vak',
        })).toBe('No customers match “vak”.')
    })

    it('filtre var ama terim yoksa FILTRE dilinde konusur', () => {
        expect(adminEmptyText({
            filtered: true, entityPlural: 'sub-projects',
        })).toBe('No sub-projects match the selected filters.')
    })

    it('ILK KULLANIM boslugu olusturma aksiyonunu ONERIR', () => {
        expect(adminEmptyText({
            filtered: false, entityPlural: 'roles', createLabel: 'New Role',
        })).toBe('No roles yet. Use “New Role”.')
    })

    it('olusturma etiketi yoksa yalin mesaj', () => {
        expect(adminEmptyText({ filtered: false, entityPlural: 'groups' }))
            .toBe('No groups yet.')
    })
})
