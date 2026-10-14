/**
 * HERMES - Sirket hesaplari + modul erisimi (docs/tenant-platform/01) — istemci.
 *   - Modul karari: tenant tavani ∩ erisim profili; sirket hesabinda profil
 *     yoksa hicbir modul (fail-closed); sirket hesabi taleplere iner.
 *   - Sirketler: yeni sirket hesabi + destek ekibi iki adimda kaydedilir;
 *     ekibi olmayan sirket uyarilir.
 *   - Modul erisimi: "Herkes" anahtari ve sirket ekleme tam govdeyle kaydeder.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders, resetAuthStore } from '../utils'
import { useAuthStore } from '../../stores/authStore'
import { landingPath, userHasModule } from '../../features/modules/catalog'

vi.mock('../../api/companyApi', () => ({
    companyService: {
        list: vi.fn(), create: vi.fn(), update: vi.fn(), resetPassword: vi.fn(),
        supportList: vi.fn(), setSupport: vi.fn(),
    },
    moduleAccessService: { list: vi.fn(), set: vi.fn() },
}))
vi.mock('../../services/api', async () => {
    const actual = await vi.importActual('../../services/api')
    return {
        ...actual,
        userGroupService: { ...actual.userGroupService, list: vi.fn(async () => [{ id: 'g1', name: 'Destek', is_active: true }]) },
        authService: { ...actual.authService, lookupUsers: vi.fn(async () => [{ id: 'u1', full_name: 'Ali Veli' }]) },
    }
})

const { companyService, moduleAccessService } = await import('../../api/companyApi')
const { default: CompaniesTab } = await import('../../pages/admin/CompaniesTab')
const { default: ModuleAccessTab } = await import('../../pages/admin/ModuleAccessTab')

const setup = () => userEvent.setup({ delay: null, pointerEventsCheck: 0 })
const TENANT = { id: 't1', modules: ['time_entry', 'work', 'tickets'] }

beforeEach(() => {
    resetAuthStore()
    useAuthStore.setState({ isAuthenticated: true, tenant: TENANT, permissions: ['users.manage', 'roles.manage'] })
    vi.clearAllMocks()
})

describe('modul karari', () => {
    it('tenant tavani ∩ erisim profili; sirket hesabi taleplere iner', () => {
        expect(userHasModule(TENANT, null, 'work')).toBe(true)                                 // profil yok: tavan
        expect(userHasModule(TENANT, { account_kind: 'person', modules: ['tickets'] }, 'work')).toBe(false)
        expect(userHasModule(TENANT, { account_kind: 'person', modules: ['meetings'] }, 'meetings')).toBe(false) // tavan
        expect(userHasModule(TENANT, { account_kind: 'company' }, 'tickets')).toBe(false)    // fail-closed
        expect(landingPath(TENANT, { account_kind: 'company', modules: ['tickets'] })).toBe('/support')
        expect(landingPath(TENANT, { account_kind: 'person', modules: ['work', 'tickets'] })).toBe('/project-management')
        useAuthStore.setState({ access: { account_kind: 'company', modules: ['tickets'] } })
        expect(useAuthStore.getState().hasModule('work')).toBe(false)
        expect(useAuthStore.getState().isCompanyAccount()).toBe(true)
    })
})

describe('sirketler', () => {
    it('yeni sirket hesabi + destek ekibi kaydedilir; ekipsiz sirket uyarilir', async () => {
        const user = setup()
        companyService.list.mockResolvedValue([
            { id: 'c0', name: 'Eski Musteri', email: 'x@eski.com', is_active: true, modules: ['tickets'] },
        ])
        companyService.supportList.mockResolvedValue({ provider: true, items: [] })
        companyService.create.mockResolvedValue({ id: 'c1', name: 'Defacto', email: 'destek@defacto.com.tr', is_active: true, modules: ['tickets'] })
        companyService.setSupport.mockResolvedValue({ configured: true })
        renderWithProviders(<CompaniesTab />)
        expect(await screen.findByText('Eski Musteri')).toBeInTheDocument()
        expect(screen.getByText('No team')).toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: /New company/ }))
        const dialog = await screen.findByRole('dialog')
        await user.type(within(dialog).getByLabelText('Company name'), 'Defacto')
        await user.type(within(dialog).getByLabelText('Sign-in e-mail'), 'destek@defacto.com.tr')
        await user.type(within(dialog).getByLabelText('Password'), 'Guclu-Parola-1')
        await user.click(within(dialog).getByRole('combobox', { name: 'Support team' }))
        await user.click(await screen.findByTitle('Destek'))
        await user.click(within(dialog).getByRole('button', { name: 'Save' }))
        await waitFor(() => expect(companyService.create).toHaveBeenCalledWith({
            name: 'Defacto', email: 'destek@defacto.com.tr', password: 'Guclu-Parola-1', modules: ['tickets'],
        }))
        await waitFor(() => expect(companyService.setSupport).toHaveBeenCalledWith('c1', { display_name: 'Defacto', group_id: 'g1' }))
    })
})

describe('modul erisimi', () => {
    it('Herkes anahtari ve sirket ekleme tam govdeyle kaydeder', async () => {
        const user = setup()
        companyService.list.mockResolvedValue([{ id: 'c1', name: 'Defacto', email: 'd@d.com', is_active: true, modules: ['tickets'] }])
        let state = [
            { module: 'work', everyone: true, grants: [] },
            { module: 'tickets', everyone: true, grants: [{ type: 'group', id: 'g1' }] },
        ]
        moduleAccessService.list.mockImplementation(async () => state)
        moduleAccessService.set.mockImplementation(async (module, body) => {
            state = state.map((r) => (r.module === module ? { module, ...body } : r))
            return state
        })
        renderWithProviders(<ModuleAccessTab />)
        expect(await screen.findByText('All employees and the ones below see it.')).toBeInTheDocument()

        await user.click(screen.getByRole('switch', { name: 'Work management: everyone' }))
        await waitFor(() => expect(moduleAccessService.set).toHaveBeenCalledWith('work', { everyone: false, grants: [] }))

        await user.click(screen.getByRole('combobox', { name: 'Tickets: add access' }))
        await user.click(await screen.findByTitle('Defacto'))
        await waitFor(() => expect(moduleAccessService.set).toHaveBeenLastCalledWith('tickets', {
            everyone: true, grants: [{ type: 'group', id: 'g1' }, { type: 'user', id: 'c1' }],
        }))
    })
})
