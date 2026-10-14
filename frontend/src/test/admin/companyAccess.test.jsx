/**
 * HERMES - Sirket hesaplari + modul erisimi (docs/tenant-platform/01) — istemci.
 *   - Modul karari: tenant tavani ∩ erisim profili; sirket hesabinda profil
 *     yoksa hicbir modul (fail-closed); sirket hesabi taleplere iner.
 *   - Sirketler: hesap musteriden secilir (ad musteriden), musteri bagi +
 *     destek ekibi kaydedilir; ekibi/musterisi olmayan sirket uyarilir;
 *     baska hesaba bagli musteri secilemez.
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
        customerService: {
            ...actual.customerService,
            getAll: vi.fn(async () => [
                { id: 'cu1', name: 'Defacto', is_active: true },
                { id: 'cu2', name: 'Koton', is_active: true },
            ]),
        },
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
    it('hesap musteriden secilir; musteri bagi + ekip kaydedilir', async () => {
        const user = setup()
        companyService.list.mockResolvedValue([
            { id: 'c0', name: 'Koton', email: 'x@koton.com', is_active: true, modules: ['tickets'] },
            { id: 'c9', name: 'Eski Musteri', email: 'x@eski.com', is_active: true, modules: ['tickets'] },
        ])
        companyService.supportList.mockResolvedValue({ provider: true, items: [
            { account_id: 'c0', display_name: 'Koton', customer_id: 'cu2', customer_name: 'Koton', group_id: null, configured: false },
        ] })
        companyService.create.mockResolvedValue({ id: 'c1', name: 'Defacto', email: 'destek@defacto.com.tr', is_active: true, modules: ['tickets'] })
        companyService.setSupport.mockResolvedValue({ configured: true })
        renderWithProviders(<CompaniesTab />)
        expect(await screen.findByText('Eski Musteri')).toBeInTheDocument()
        expect(screen.getAllByText('No team')).toHaveLength(2)
        expect(screen.getByText('No customer linked')).toBeInTheDocument()          // bagsiz eski hesap

        await user.click(screen.getByRole('button', { name: /New company/ }))
        const dialog = await screen.findByRole('dialog')
        expect(within(dialog).queryByLabelText('Company name')).toBeNull()          // ad yazilmaz
        await user.click(within(dialog).getByRole('combobox', { name: 'Customer' }))
        const koton = (await screen.findAllByTitle('Koton')).find((el) => el.closest('.ant-select-item'))
        expect(koton.closest('.ant-select-item')).toHaveClass('ant-select-item-option-disabled')   // baska hesapta
        await user.click((await screen.findAllByTitle('Defacto')).find((el) => el.closest('.ant-select-item')))
        await user.type(within(dialog).getByLabelText('Sign-in e-mail'), 'destek@defacto.com.tr')
        await user.type(within(dialog).getByLabelText('Password'), 'Guclu-Parola-1')
        await user.click(within(dialog).getByRole('combobox', { name: 'Support team' }))
        await user.click(await screen.findByTitle('Destek'))
        await user.click(within(dialog).getByRole('button', { name: 'Create' }))
        await waitFor(() => expect(companyService.create).toHaveBeenCalledWith({
            name: 'Defacto', email: 'destek@defacto.com.tr', password: 'Guclu-Parola-1', modules: ['tickets'],
        }))
        await waitFor(() => expect(companyService.setSupport).toHaveBeenCalledWith('c1', { customer_id: 'cu1', group_id: 'g1' }))
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
