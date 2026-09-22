/**
 * =============================================================================
 * Proje uyeleri drawer'i (PM rework P2.1 / B2)
 * =============================================================================
 * Dugmeleri sunucu karari belirler: can_manage yoksa salt okunur liste;
 * can_assign_lead yoksa "Lider" secenegi yok ve lead satiri dokunulmaz.
 * Ekle/cikar dogru uclara gider.
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const projectService = {
    listMembers: vi.fn(),
    addMember: vi.fn(),
    updateMember: vi.fn(),
    removeMember: vi.fn(),
}
const authService = {
    lookupUsers: vi.fn(),
}
vi.mock('../../services/api', () => ({ projectService }))
vi.mock('../../api/authApi', () => ({ authService }))

import { renderWithProviders } from '../utils'
const ProjectMembersDrawer = (await import('../../components/projects/ProjectMembersDrawer')).default

const USERS = [
    { id: 'u1', full_name: 'Ada Lovelace' },
    { id: 'u2', full_name: 'Grace Hopper' },
    { id: 'u3', full_name: 'Alan Turing' },
]
const members = (over = {}) => ({
    project_id: 'p1',
    can_manage: true,
    can_assign_lead: false,
    items: [
        { id: 'm1', user_id: 'u1', member_role: 'lead', is_active: true },
        { id: 'm2', user_id: 'u2', member_role: 'member', is_active: true },
    ],
    ...over,
})

beforeEach(() => {
    vi.clearAllMocks()
    authService.lookupUsers.mockResolvedValue(USERS)
    projectService.addMember.mockResolvedValue({})
    projectService.updateMember.mockResolvedValue({})
    projectService.removeMember.mockResolvedValue({})
})

const renderDrawer = () => renderWithProviders(
    <ProjectMembersDrawer open projectId="p1" projectName="ATM" onClose={() => {}} />
)

describe('proje uyeleri drawer (B2)', () => {
    it('uyeleri adlariyla listeler; lead satiri lead yetkisi olmayana kilitli', async () => {
        projectService.listMembers.mockResolvedValue(members())
        renderDrawer()
        expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
        expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
        // Lead satirinda rol etiketi sabit, cikarma dugmesi yok.
        expect(screen.getByText('Lead')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Remove member — Ada Lovelace' })).toBeNull()
        // Uye satiri duzenlenebilir.
        expect(screen.getByRole('button', { name: 'Remove member — Grace Hopper' })).toBeInTheDocument()
    })

    it('ekleme: secilen kullanici ve rol ile addMember cagrilir; lider secenegi yok', async () => {
        projectService.listMembers.mockResolvedValue(members())
        const user = userEvent.setup({ delay: null })
        renderDrawer()
        await screen.findByText('Ada Lovelace')
        await user.click(screen.getByRole('combobox', { name: 'Pick a user' }))
        // Zaten uye olanlar listede DEGIL.
        expect(screen.queryByTitle('Grace Hopper')).toBeNull()
        await user.click(await screen.findByTitle('Alan Turing'))
        await user.click(screen.getAllByRole('combobox', { name: 'Role' })[0])
        expect(await screen.findByTitle('Viewer')).toBeInTheDocument()
        expect(screen.queryByTitle('Lead')).toBeNull()
        await user.click(screen.getByTitle('Viewer'))
        await user.click(screen.getByRole('button', { name: /Add/ }))
        await waitFor(() => expect(projectService.addMember).toHaveBeenCalledWith(
            'p1', { user_id: 'u3', member_role: 'viewer' }
        ))
    })

    it('cikarma removeMember ile gider', async () => {
        projectService.listMembers.mockResolvedValue(members())
        const user = userEvent.setup({ delay: null })
        renderDrawer()
        await screen.findByText('Grace Hopper')
        await user.click(screen.getByRole('button', { name: 'Remove member — Grace Hopper' }))
        await waitFor(() => expect(projectService.removeMember).toHaveBeenCalledWith('p1', 'm2'))
    })

    it('yonetim yetkisi yoksa salt okunur: ekleme alani ve dugmeler yok', async () => {
        projectService.listMembers.mockResolvedValue(members({ can_manage: false }))
        renderDrawer()
        expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
        expect(screen.queryByRole('combobox', { name: 'Pick a user' })).toBeNull()
        expect(screen.queryByRole('button', { name: /Remove member/ })).toBeNull()
        expect(screen.getByText(/Only a project lead/)).toBeInTheDocument()
    })

    it('projects.manage: lider secenegi var, lead satiri duzenlenebilir', async () => {
        projectService.listMembers.mockResolvedValue(members({ can_assign_lead: true }))
        const user = userEvent.setup({ delay: null })
        renderDrawer()
        await screen.findByText('Ada Lovelace')
        expect(screen.getByRole('button', { name: 'Remove member — Ada Lovelace' })).toBeInTheDocument()
        await user.click(screen.getAllByRole('combobox', { name: 'Role' })[0])
        // Acilan listede "Lead" secenegi var (satirlardaki secili degerler de
        // 'Lead' basligi tasir; option rolu ile ayirt edilir).
        expect(await screen.findByRole('option', { name: 'Lead' })).toBeInTheDocument()
    })
})
