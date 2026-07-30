/**
 * =============================================================================
 * Sprint 6B.2 completion — Roles (RBAC rol yonetimi)
 * =============================================================================
 * Once KARAKTERIZASYON: gercek yuzey mount edilir, mevcut sozlesme
 * (system rol kilidi, code'un yalniz olusturmada gorunmesi, pasifleştirme
 * akisi) testle sabitlenir. Sonra eksik davranislar kapatilir.
 *
 * Bu yuzeyde bulunan gercek kusurlar:
 *   1. Edit A → Edit B: `setFieldsValue` oncesinde resetFields YOKTU.
 *      Alanlar moda gore KOSULLU cizildigi icin (code yalniz create'te,
 *      is_active yalniz edit-ve-system-degil) bu, bir rolun degerinin
 *      digerinin formunda kalmasina yol aciyordu.
 *   2. Ne kaydetmede ne pasifleştirmede pending kilidi vardi.
 *   3. Hata mesaji `|| 'Hata'` idi: sunucunun catisma aciklamasi (orn.
 *      "kullanimda olan rol") ve alan hatalari kayboluyordu.
 *   4. Duzenle ikonunun erisilebilir adi YOKTU.
 *   5. Liste hatasinda retry / bos durum sunumu YOKTU.
 *
 * RBAC iş kurallari (subset, son-admin, system kilidi) DEGISTIRILMEDI —
 * bunlar backend sozlesmesidir; burada yalnizca dogru sunulup sunulmadigi
 * dogrulanir.
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'

const rbacService = {
    listRoles: vi.fn(),
    getPermissionCatalog: vi.fn(),
    createRole: vi.fn(),
    updateRole: vi.fn(),
    deactivateRole: vi.fn(),
}

vi.mock('../../services/api', () => ({ rbacService }))

const RolesTab = (await import('../../pages/admin/RolesTab')).default
const { makeTestQueryClient } = await import('../utils')

const ROLES = [
    {
        id: 'r1', code: 'system-admin', name: 'System Admin',
        description: 'Full access', permissions: ['users.manage', 'roles.manage'],
        is_active: true, is_system: true, member_count: 2,
    },
    {
        id: 'r2', code: 'report-viewer', name: 'Report Viewer',
        description: 'Reads reports', permissions: ['reports.view'],
        is_active: true, is_system: false, member_count: 5,
    },
    {
        // `description` BILEREK YOK: eksik alan bayat deger birakiyor mu?
        id: 'r3', code: 'planner', name: 'Planner',
        permissions: [], is_active: true, is_system: false, member_count: 0,
    },
]

const CATALOG = {
    permissions: [
        { code: 'users.manage' }, { code: 'roles.manage' },
        { code: 'reports.view' }, { code: 'plans.manage' },
    ],
}

const setupUser = () => userEvent.setup({ delay: null })
const deferred = () => {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}
const httpError = (status, data) => ({ response: { status, data } })

const renderRoles = () =>
    render(
        <QueryClientProvider client={makeTestQueryClient()}>
            <RolesTab />
        </QueryClientProvider>
    )

const roleDialog = () => screen.getByRole('dialog', { name: /Role|Rol/i })
const inDialog = (label) => within(roleDialog()).getByRole('button', { name: label })

const openEdit = async (user, roleName) => {
    await user.click(await screen.findByRole('button', { name: `Edit ${roleName}` }))
    return roleDialog()
}

beforeEach(() => {
    vi.clearAllMocks()
    rbacService.listRoles.mockResolvedValue({ roles: ROLES.map((r) => ({ ...r })) })
    rbacService.getPermissionCatalog.mockResolvedValue(CATALOG)
    rbacService.createRole.mockResolvedValue({ id: 'new' })
    rbacService.updateRole.mockResolvedValue({})
    rbacService.deactivateRole.mockResolvedValue({})
})

describe('KARAKTERIZASYON — mevcut RBAC sozlesmesi', () => {
    it('roller ve uye sayilari listelenir', async () => {
        renderRoles()
        expect(await screen.findByText('System Admin')).toBeInTheDocument()
        expect(screen.getByText('Report Viewer')).toBeInTheDocument()
        // Izin sayisi ozeti (izin listesi degil) gosterilir.
        expect(screen.getByText('2 izin')).toBeInTheDocument()
    })

    it('pasif/aktif roller include_inactive ile cekilir', async () => {
        renderRoles()
        await screen.findByText('System Admin')
        expect(rbacService.listRoles).toHaveBeenCalledWith(true)
    })

    it('SYSTEM rolu UI’da da kilitlidir — ad ve izinler disabled', async () => {
        const user = setupUser()
        renderRoles()
        const d = await openEdit(user, 'System Admin')
        expect(within(d).getByText(/Sistem rolü kilitlidir/)).toBeInTheDocument()
        expect(within(d).getByLabelText('Name')).toBeDisabled()
    })

    it('`code` YALNIZCA olusturmada gorunur (kalici alan)', async () => {
        const user = setupUser()
        renderRoles()
        const edit = await openEdit(user, 'Report Viewer')
        expect(within(edit).queryByLabelText(/^Code/)).not.toBeInTheDocument()
        await user.click(inDialog('Cancel'))
        await user.click(screen.getByRole('button', { name: /New Role/ }))
        expect(within(roleDialog()).getByLabelText(/^Code/)).toBeInTheDocument()
    })

    it('SYSTEM rolde yalnizca aciklama gonderilir', async () => {
        const user = setupUser()
        renderRoles()
        const d = await openEdit(user, 'System Admin')
        await user.clear(within(d).getByLabelText('Description'))
        await user.type(within(d).getByLabelText('Description'), 'yeni aciklama')
        await user.click(inDialog('Update'))
        await waitFor(() => expect(rbacService.updateRole).toHaveBeenCalled())
        const [, payload] = rbacService.updateRole.mock.calls[0]
        expect(payload).toEqual({ description: 'yeni aciklama' })
        expect(payload).not.toHaveProperty('permissions')
    })

    it('SYSTEM rol pasifleştirilemez — aksiyon SUNULMAZ', async () => {
        renderRoles()
        await screen.findByText('System Admin')
        expect(
            screen.queryByRole('button', { name: /Deactivate System Admin/ })
        ).not.toBeInTheDocument()
        expect(
            screen.getByRole('button', { name: /Deactivate Report Viewer/ })
        ).toBeInTheDocument()
    })
})

describe('erisilebilir satir aksiyonlari', () => {
    it('ikon-only butonlar hangi rolu hedefledigini SOYLER', async () => {
        renderRoles()
        expect(await screen.findByRole('button', { name: 'Edit Report Viewer' }))
            .toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Deactivate Report Viewer' }))
            .toBeInTheDocument()
    })
})

describe('modal lifecycle — bayat deger YOK', () => {
    it('Edit A → Edit B: A’nin aciklamasi B’ye TASINMAZ', async () => {
        const user = setupUser()
        renderRoles()
        let d = await openEdit(user, 'Report Viewer')
        expect(within(d).getByLabelText('Description')).toHaveValue('Reads reports')
        await user.click(inDialog('Cancel'))

        // Planner'da `description` HIC YOK → eski davranista 'Reads reports' kalirdi.
        d = await openEdit(user, 'Planner')
        expect(within(d).getByLabelText('Name')).toHaveValue('Planner')
        expect(within(d).getByLabelText('Description')).toHaveValue('')
    })

    it('Edit → Create temiz defaultlarla acilir', async () => {
        const user = setupUser()
        renderRoles()
        const d = await openEdit(user, 'Report Viewer')
        await user.click(inDialog('Cancel'))
        await user.click(screen.getByRole('button', { name: /New Role/ }))
        const create = roleDialog()
        expect(within(create).getByLabelText('Name')).toHaveValue('')
        expect(within(create).getByLabelText('Description')).toHaveValue('')
        expect(within(create).getByLabelText(/^Code/)).toHaveValue('')
    })

    it('SYSTEM rolden normal role geciste kilit UYARISI kalmaz', async () => {
        const user = setupUser()
        renderRoles()
        let d = await openEdit(user, 'System Admin')
        expect(within(d).getByText(/Sistem rolü kilitlidir/)).toBeInTheDocument()
        await user.click(inDialog('Cancel'))
        d = await openEdit(user, 'Report Viewer')
        expect(within(d).queryByText(/Sistem rolü kilitlidir/)).not.toBeInTheDocument()
        expect(within(d).getByLabelText('Name')).toBeEnabled()
    })
})

describe('cift gonderim kilitleri', () => {
    it('PENDING iken ikinci kaydetme YENI istek ACMAZ', async () => {
        const gate = deferred()
        rbacService.updateRole.mockImplementationOnce(() => gate.promise)
        const user = setupUser()
        renderRoles()
        await openEdit(user, 'Report Viewer')
        const submit = inDialog('Update')
        await user.click(submit)
        await waitFor(() => expect(rbacService.updateRole).toHaveBeenCalledTimes(1))
        await user.click(submit)
        await user.click(submit)
        expect(rbacService.updateRole).toHaveBeenCalledTimes(1)
        gate.resolve({})
    })

    it('PENDING iken pasifleştirme tekrar tetiklenemez', async () => {
        const gate = deferred()
        rbacService.deactivateRole.mockImplementationOnce(() => gate.promise)
        const user = setupUser()
        renderRoles()
        await user.click(
            await screen.findByRole('button', { name: 'Deactivate Report Viewer' })
        )
        const confirm = await screen.findByRole('button', { name: 'Archive' })
        await user.click(confirm)
        await waitFor(() => expect(rbacService.deactivateRole).toHaveBeenCalledTimes(1))
        await user.click(confirm)
        await user.click(confirm)
        expect(rbacService.deactivateRole).toHaveBeenCalledTimes(1)
        gate.resolve({})
    })
})

describe('hata sunumu', () => {
    it('KULLANIMDAKI rol catismasi kullaniciya ANLASILIR gelir', async () => {
        rbacService.deactivateRole.mockRejectedValueOnce(
            httpError(409, { detail: 'Role is assigned to 5 users.' })
        )
        const user = setupUser()
        renderRoles()
        await user.click(
            await screen.findByRole('button', { name: 'Deactivate Report Viewer' })
        )
        await user.click(await screen.findByRole('button', { name: 'Archive' }))
        expect(await screen.findByText('Role is assigned to 5 users.'))
            .toBeInTheDocument()
    })

    it('SON ADMIN kilidi (409) sunucunun mesajiyla gosterilir', async () => {
        rbacService.updateRole.mockRejectedValueOnce(
            httpError(409, { detail: 'Cannot deactivate the last system admin role.' })
        )
        const user = setupUser()
        renderRoles()
        await openEdit(user, 'Report Viewer')
        await user.click(inDialog('Update'))
        expect(await screen.findByText(/last system admin/)).toBeInTheDocument()
    })

    it('duplicate code (409) FORM seviyesinde gosterilir, girdi KORUNUR', async () => {
        rbacService.createRole.mockRejectedValueOnce(
            httpError(409, { detail: 'A role with this code already exists.' })
        )
        const user = setupUser()
        renderRoles()
        await screen.findByText('System Admin')
        await user.click(screen.getByRole('button', { name: /New Role/ }))
        const d = roleDialog()
        await user.type(within(d).getByLabelText(/^Code/), 'report-viewer')
        await user.type(within(d).getByLabelText('Name'), 'Kopya')
        await user.click(inDialog('Create'))
        expect(await screen.findByText('A role with this code already exists.'))
            .toBeInTheDocument()
        // Modal ACIK ve girdiler yerinde.
        expect(within(roleDialog()).getByLabelText('Name')).toHaveValue('Kopya')
    })

    it('422 alan hatasi ILGILI ALANA baglanir', async () => {
        rbacService.createRole.mockRejectedValueOnce(httpError(422, {
            detail: [{ loc: ['body', 'code'], msg: 'code must be kebab-case' }],
        }))
        const user = setupUser()
        renderRoles()
        await screen.findByText('System Admin')
        await user.click(screen.getByRole('button', { name: /New Role/ }))
        const d = roleDialog()
        await user.type(within(d).getByLabelText(/^Code/), 'abc')
        await user.type(within(d).getByLabelText('Name'), 'X')
        await user.click(inDialog('Create'))
        expect(await screen.findByText('code must be kebab-case')).toBeInTheDocument()
    })

    it('teknik 5xx govdesi kullaniciya SIZMAZ', async () => {
        rbacService.updateRole.mockRejectedValueOnce(
            httpError(500, { detail: 'sqlalchemy.exc.IntegrityError: dup key' })
        )
        const user = setupUser()
        renderRoles()
        await openEdit(user, 'Report Viewer')
        await user.click(inDialog('Update'))
        expect(await screen.findByText(/server had a problem/i)).toBeInTheDocument()
        expect(screen.queryByText(/sqlalchemy/)).not.toBeInTheDocument()
    })
})

describe('liste durumlari', () => {
    it('liste hatasinda RETRY sunulur ve yeniden cagrilir', async () => {
        rbacService.listRoles.mockRejectedValueOnce(httpError(503, {}))
        const user = setupUser()
        renderRoles()
        const retry = await screen.findByRole('button', { name: 'Retry' })
        rbacService.listRoles.mockResolvedValue({ roles: ROLES })
        await user.click(retry)
        expect(await screen.findByText('System Admin')).toBeInTheDocument()
    })

    it('rol yoksa ANLAMLI bos durum gosterilir', async () => {
        rbacService.listRoles.mockResolvedValue({ roles: [] })
        renderRoles()
        expect(await screen.findByText(/No roles/i)).toBeInTheDocument()
    })
})

describe('cache etkisi', () => {
    it('rol kaydi kullanici ve gorunurluk cache’lerini de tazeler', async () => {
        const user = setupUser()
        renderRoles()
        await openEdit(user, 'Report Viewer')
        await user.click(inDialog('Update'))
        await waitFor(() => expect(rbacService.updateRole).toHaveBeenCalled())
        // Rol izinleri degisti: rol listesi YENIDEN cekilir. (Kullanici
        // rolleri ve mevcut kullanicinin izinleri ayri anahtarlardadir;
        // onlarin invalidasyonu UsersPage tarafinda test edilir.)
        await waitFor(() =>
            expect(rbacService.listRoles.mock.calls.length).toBeGreaterThan(1)
        )
    })
})
