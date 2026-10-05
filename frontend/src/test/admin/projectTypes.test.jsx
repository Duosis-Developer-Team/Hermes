/**
 * =============================================================================
 * Proje turleri + jenerik proje logosu (CTO 05.10)
 * =============================================================================
 *   1. Jenerik logo = TUR RENGI + glif: renk degisince gorsel degisir;
 *      bilinmeyen glif cizilmez; turu yoksa notr gri.
 *   2. ProjectLogo: yuklenmis ozel logo > jenerik logo; ozel logo tur
 *      renginden ETKILENMEZ.
 *   3. Gruplama: turlu gruplar ada gore, tursuzler en sonda.
 *   4. Tur sayfasi: renk ana renklerden (gorsel ornekli radio), olustur
 *      ad+renk gonderir, kullanimdaki tur silinmez.
 *   5. Proje formu: tur + "Logo sec" kaydedilir; glif secmek yuklenmis
 *      logoyu kaldirir, dosya yuklemek glifi temizler.
 * =============================================================================
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'

const projectService = {
    getAll: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    uploadLogo: vi.fn(), deleteLogo: vi.fn(),
    listMembers: vi.fn(), addMember: vi.fn(), updateMember: vi.fn(), removeMember: vi.fn(),
}
const projectTypeService = { getAll: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() }
const customerService = { getAll: vi.fn() }
const workLogService = { getBillableSummary: vi.fn() }
vi.mock('../../services/api', () => ({
    projectService, projectTypeService, customerService, workLogService,
    authService: { lookupUsers: vi.fn().mockResolvedValue([]) },
}))

const { genericLogoSvg, genericLogoUrl } = await import('../../features/projectTypes/genericLogo')
const { PROJECT_TYPE_PALETTE, NEUTRAL_TONE } = await import('../../features/projectTypes/palette')
const { LOGO_GLYPH_KEYS } = await import('../../features/projectTypes/glyphs')
const { groupProjectsByType, UNTYPED } = await import('../../features/projectTypes/grouping')
const { ProjectLogo } = await import('../../components/liquid')
const { useCustomerLogoStore } = await import('../../stores/customerLogoStore')
const ProjectTypesPage = (await import('../../pages/admin/ProjectTypesPage')).default
const ProjectsPage = (await import('../../pages/admin/ProjectsPage')).default
const { makeTestQueryClient } = await import('../utils')

const setup = () => userEvent.setup({ delay: null, pointerEventsCheck: 0 })
const withClient = (ui) => render(<QueryClientProvider client={makeTestQueryClient()}>{ui}</QueryClientProvider>)

const TYPES = [
    { id: 't1', name: 'Destek', color: 'red', project_count: 2, created_at: '2026-10-05T00:00:00Z' },
    { id: 't2', name: 'Talep', color: 'amber', project_count: 0, created_at: '2026-10-05T00:00:00Z' },
]

beforeEach(() => {
    vi.clearAllMocks()
    useCustomerLogoStore.setState({ etags: {}, projects: {}, generic: {} })
    projectTypeService.getAll.mockResolvedValue(TYPES)
    customerService.getAll.mockResolvedValue([])
    workLogService.getBillableSummary.mockResolvedValue({ data: {} })
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview')
    globalThis.URL.revokeObjectURL = vi.fn()
})

describe('jenerik logo modeli', () => {
    it('renk + glif: renk degisince SVG degisir, yer tutucu kalmaz', () => {
        const red = genericLogoSvg('lv3', 'red')
        const yellow = genericLogoSvg('lv3', 'yellow')
        expect(red).toContain(PROJECT_TYPE_PALETTE.red.from)
        expect(red).toContain(PROJECT_TYPE_PALETTE.red.to)
        expect(yellow).toContain(PROJECT_TYPE_PALETTE.yellow.from)
        expect(red).not.toBe(yellow)
        expect(red).toContain('LV3')
        // Rozetli gliflerde koyu ton yer tutucusu doldurulur.
        expect(genericLogoSvg('product-new', 'blue')).not.toContain('{{C2}}')
        expect(genericLogoSvg('product-new', 'blue')).toContain(PROJECT_TYPE_PALETTE.blue.to)
    })

    it('turu yoksa notr gri; bilinmeyen glif cizilmez', () => {
        expect(genericLogoSvg('general', null)).toContain(NEUTRAL_TONE.from)
        expect(genericLogoSvg('nope', 'red')).toBeNull()
        expect(genericLogoUrl('nope', 'red')).toBeNull()
        expect(LOGO_GLYPH_KEYS).toHaveLength(23)
    })

    it('ProjectLogo: ozel logo > jenerik; jenerik tur rengini izler', () => {
        useCustomerLogoStore.setState({ projects: { p1: 'e1' }, generic: { p1: { glyph: 'lv1', color: 'red' }, p2: { glyph: 'lv1', color: 'red' } } })
        const { container, rerender } = render(<ProjectLogo id="p1" />)
        // Ozel (yuklenmis) logo: tur rengi ona dokunmaz.
        expect(container.querySelector('img').getAttribute('src')).toBe('/api/v1/core/projects/p1/logo?v=e1')
        rerender(<ProjectLogo id="p2" />)
        const redSrc = container.querySelector('img').getAttribute('src')
        expect(decodeURIComponent(redSrc)).toContain(PROJECT_TYPE_PALETTE.red.from)
        // Tur rengi sariya: ayni proje, yeni renk.
        useCustomerLogoStore.getState().setFromProjects([
            { id: 'p2', logo_glyph: 'lv1', project_type_color: 'yellow' },
        ])
        rerender(<ProjectLogo id="p2" />)
        expect(decodeURIComponent(container.querySelector('img').getAttribute('src'))).toContain(PROJECT_TYPE_PALETTE.yellow.from)
    })

    it('gruplama: turlu gruplar ada gore, tursuzler en sonda', () => {
        const groups = groupProjectsByType([
            { id: 'a', name: 'A', project_type_id: 't2', project_type_name: 'Talep', project_type_color: 'amber' },
            { id: 'b', name: 'B' },
            { id: 'c', name: 'C', project_type_id: 't1', project_type_name: 'Destek', project_type_color: 'red' },
            { id: 'd', name: 'D', project_type_id: 't1', project_type_name: 'Destek', project_type_color: 'red' },
        ], 'Türsüz')
        expect(groups.map((g) => [g.name, g.projects.map((p) => p.id)])).toEqual([
            ['Destek', ['c', 'd']], ['Talep', ['a']], ['Türsüz', ['b']],
        ])
        expect(groups[2].key).toBe(UNTYPED)
        expect(groupProjectsByType([], 'x')).toEqual([])
    })
})

describe('Proje turleri sayfasi', () => {
    it('renk ana renklerden secilir; olustur ad + renk gonderir', async () => {
        const user = setup()
        projectTypeService.create.mockResolvedValue({ id: 't9', name: 'Proje', color: 'teal', project_count: 0 })
        withClient(<ProjectTypesPage />)
        await screen.findByText('Destek')
        await user.click(screen.getByRole('button', { name: /New project type/ }))
        const dialog = await screen.findByRole('dialog')
        const radios = within(dialog).getAllByRole('radio')
        expect(radios).toHaveLength(12)
        // Ornek renk + ad birlikte (yalniz metin degil).
        expect(radios[0].querySelector('.pt-color__swatch')).toBeTruthy()
        await user.type(within(dialog).getByLabelText('Type name'), 'Proje')
        await user.click(within(dialog).getByRole('radio', { name: 'Teal' }))
        expect(within(dialog).getByRole('radio', { name: 'Teal' })).toHaveAttribute('aria-checked', 'true')
        await user.click(within(dialog).getByRole('button', { name: 'Create' }))
        await waitFor(() => expect(projectTypeService.create).toHaveBeenCalledWith({ name: 'Proje', color: 'teal' }))
    })

    it('kullanimdaki tur silinmez; bos tur silinir', async () => {
        const user = setup()
        projectTypeService.delete.mockResolvedValue()
        withClient(<ProjectTypesPage />)
        await screen.findByText('Destek')
        await user.click(screen.getByRole('button', { name: 'Delete project type: Destek' }))
        expect(await screen.findByText(/This type has 2 projects/)).toBeInTheDocument()
        expect(projectTypeService.delete).not.toHaveBeenCalled()
        await user.click(screen.getByRole('button', { name: 'Delete project type: Talep' }))
        const dialog = await screen.findByRole('dialog')
        await user.click(within(dialog).getByRole('button', { name: 'Delete project type' }))
        await waitFor(() => expect(projectTypeService.delete).toHaveBeenCalledWith('t2'))
    })
})

describe('Proje formu: tur + logo sec', () => {
    const PROJECT = {
        id: 'p1', name: 'Level3 Support', customer_id: null, is_active: true,
        has_logo: true, logo_etag: 'old', logo_glyph: null,
        project_type_id: 't1', project_type_name: 'Destek', project_type_color: 'red',
        is_billable_default: true,
    }

    it('glif secmek yuklenmis logoyu kaldirir ve glifi kaydeder', async () => {
        const user = setup()
        projectService.getAll.mockResolvedValue([PROJECT])
        projectService.update.mockResolvedValue({ ...PROJECT, has_logo: false, logo_glyph: 'lv3' })
        projectService.deleteLogo.mockResolvedValue()
        withClient(<ProjectsPage />)
        const row = (await screen.findByText('Level3 Support')).closest('tr')
        await user.click(within(row).getByRole('button', { name: 'Edit Level3 Support' }))
        const dialog = await screen.findByRole('dialog')
        await user.click(within(dialog).getAllByRole('button', { name: /Choose logo/ })[1])
        const picker = await screen.findByRole('listbox', { name: 'Choose a generic logo' })
        // Secici turun adini ve rengini kullanir.
        expect(screen.getByText(/project type: Destek/)).toBeInTheDocument()
        await user.click(within(picker).getByRole('option', { name: /Level 3/ }))
        expect(dialog.querySelector('[data-testid="project-logo-generic"]').dataset.glyph).toBe('lv3')
        await user.click(within(dialog).getByRole('button', { name: 'Update' }))
        await waitFor(() => expect(projectService.update).toHaveBeenCalled())
        const [, payload] = projectService.update.mock.calls[0]
        expect(payload).toMatchObject({ project_type_id: 't1', logo_glyph: 'lv3' })
        await waitFor(() => expect(projectService.deleteLogo).toHaveBeenCalledWith('p1'))
        expect(projectService.uploadLogo).not.toHaveBeenCalled()
    })

    it('dosya yuklemek glifi temizler', async () => {
        const user = setup()
        const generic = { ...PROJECT, has_logo: false, logo_etag: null, logo_glyph: 'lv3' }
        projectService.getAll.mockResolvedValue([generic])
        projectService.update.mockResolvedValue(generic)
        projectService.uploadLogo.mockResolvedValue({ has_logo: true, logo_etag: 'new' })
        withClient(<ProjectsPage />)
        const row = (await screen.findByText('Level3 Support')).closest('tr')
        await user.click(within(row).getByRole('button', { name: 'Edit Level3 Support' }))
        const dialog = await screen.findByRole('dialog')
        const input = dialog.querySelector('[data-testid="project-logo-input"]')
        fireEvent.change(input, { target: { files: [new File([new Uint8Array(8)], 'l.png', { type: 'image/png' })] } })
        await user.click(within(dialog).getByRole('button', { name: 'Update' }))
        await waitFor(() => expect(projectService.uploadLogo).toHaveBeenCalledTimes(1))
        expect(projectService.update.mock.calls[0][1]).toMatchObject({ logo_glyph: null })
    })
})
