/**
 * =============================================================================
 * Sprint 6B.2 — Users yuzeyi: form yasam dongusu ve asenkron yaris
 * =============================================================================
 * Bu yuzeyde iki kusur vardi; SIDDETLERI FARKLI ve oldugu gibi yazilir:
 *
 *   1. ASENKRON YARIS (CIDDI): modal acilisi `getUserRoles` bekliyordu.
 *      Edit A acilip hemen Edit B acildiginda A'nin GECIKEN rol yaniti
 *      B'nin formuna yaziliyordu — yani kaydedilirse B'ye A'nin rolleri
 *      atanabiliyordu. Yetki verisi yanlis kullaniciya gidiyor.
 *
 *   2. BAYAT DEGER (DAR): duzenleme oncesi resetFields yapilmadan
 *      `form.setFieldsValue(record)` cagriliyordu ve bu SIG birlestirir.
 *      Her kullanici kaydi ayni alanlari tasidigi surece gorunmez; ama
 *      API kaydinda bir alan EKSIKSE (orn. `full_name` hic yok) onceki
 *      kullanicinin degeri formda KALIR.
 *
 * NOT (dogrulandi, varsayilmadi): `password` alani YALNIZCA olusturma
 * modunda cizilir; duzenlemede hic yoktur. Bu yuzden "parola bir sonraki
 * kullaniciya sizar" diye bir senaryo YOK — kayit formunda kalan parola
 * da `resetFields` ile temizlenir.
 *
 * Ikisi de yalnizca gecis SIRASI ile ortaya cikar; bu yuzden testler
 * gercek yuzeyi mount edip gecisleri surer.
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'

const authService = {
    getUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
}
const rbacService = {
    listRoles: vi.fn(),
    getUserRoles: vi.fn(),
    setUserRoles: vi.fn(),
}

vi.mock('../../services/api', () => ({ authService, rbacService }))

const { UsersTab } = await import('../../pages/admin/UsersPage')
const { makeTestQueryClient } = await import('../utils')

const USERS = [
    { id: 'u1', email: 'ada@x.com', full_name: 'Ada', is_active: true },
    { id: 'u2', email: 'bob@x.com', full_name: 'Bob', is_active: true },
    // `full_name` BILEREK YOK: bayat deger kusuru tam olarak burada
    // gorunur hale gelir.
    { id: 'u3', email: 'cleo@x.com', is_active: true },
]
const ROLES = [
    { id: 'r1', code: 'system-admin', name: 'System Admin' },
    { id: 'r2', code: 'reporter', name: 'Reporter' },
]

const setupUser = () => userEvent.setup({ delay: null })
const deferred = () => {
    let resolve
    const promise = new Promise((res) => { resolve = res })
    return { promise, resolve }
}

const renderUsers = () =>
    render(
        <QueryClientProvider client={makeTestQueryClient()}>
            <UsersTab />
        </QueryClientProvider>
    )

const dialog = () => screen.getByRole('dialog')
const openEdit = async (user, email) => {
    /*
     * CI FLAKE DUZELTMESI (Sprint 7 final turunda yakalandi, urun
     * degismedi): AntD, sorgu yuklenirken tabloyu `.ant-spin-blur` ile
     * ortup `pointer-events: none` uygular. Hizli makinede buton
     * gorunur gorunmez blur da kalkmis oluyor; YAVAS CI kosucusunda
     * tiklama blur hala uzerindeyken gelip "pointer-events: none" ile
     * patliyordu. Tiklamadan once yukleme ortusunun KALKMASI beklenir
     * (userGroups.test'teki 6B.2 cozumuyle ayni sinif).
     */
    await screen.findByRole('button', { name: `Edit ${email}` })
    await waitFor(() =>
        expect(document.querySelector('.ant-spin-blur, .ant-spin-spinning'))
            .toBeNull()
    )
    await user.click(screen.getByRole('button', { name: `Edit ${email}` }))
    return dialog()
}

beforeEach(() => {
    vi.clearAllMocks()
    // DIKKAT: bu uc nokta axios ZARFI dondurur (`usersData?.data`),
    // Tasks uclarindaki ciplak dizi degil. Sadik mock sarttir.
    authService.getUsers.mockResolvedValue({ data: USERS.map((u) => ({ ...u })) })
    authService.updateUser.mockResolvedValue({})
    authService.createUser.mockResolvedValue({ id: 'new' })
    authService.deleteUser.mockResolvedValue({})
    rbacService.listRoles.mockResolvedValue({ roles: ROLES })
    rbacService.getUserRoles.mockResolvedValue({ roles: [] })
    rbacService.setUserRoles.mockResolvedValue({})
})

describe('erisilebilir satir aksiyonlari', () => {
    it('ikon-only butonlar kimi hedefledigini SOYLER', async () => {
        renderUsers()
        expect(await screen.findByRole('button', { name: 'Edit ada@x.com' }))
            .toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Archive bob@x.com' }))
            .toBeInTheDocument()
    })
})

describe('KUSUR 2 — EKSIK alan bayat deger BIRAKMAZ', () => {
    it('A’nin adi, alani EKSIK olan B’nin formuna TASINMAZ', async () => {
        const user = setupUser()
        renderUsers()

        let d = await openEdit(user, 'ada@x.com')
        expect(within(d).getByLabelText('Full Name')).toHaveValue('Ada')
        await user.click(within(d).getByRole('button', { name: 'Cancel' }))

        // Cleo kaydinda `full_name` HIC YOK → eski davranista 'Ada' kalirdi.
        d = await openEdit(user, 'cleo@x.com')
        expect(within(d).getByLabelText('Email')).toHaveValue('cleo@x.com')
        expect(within(d).getByLabelText('Full Name')).toHaveValue('')
    })

    it('B kaydedilirken A’nin adi GONDERILMEZ', async () => {
        const user = setupUser()
        renderUsers()

        let d = await openEdit(user, 'ada@x.com')
        await user.click(within(d).getByRole('button', { name: 'Cancel' }))
        d = await openEdit(user, 'cleo@x.com')
        await user.click(within(d).getByRole('button', { name: /Update/ }))

        await waitFor(() => expect(authService.updateUser).toHaveBeenCalled())
        const [id, payload] = authService.updateUser.mock.calls[0]
        expect(id).toBe('u3')
        expect(payload.full_name ?? '').toBe('')
        expect(JSON.stringify(payload)).not.toContain('Ada')
    })

    it('parola alani YALNIZCA olusturma modunda vardir', async () => {
        const user = setupUser()
        renderUsers()
        const edit = await openEdit(user, 'ada@x.com')
        expect(within(edit).queryByLabelText(/Password/i)).not.toBeInTheDocument()
        await user.click(within(edit).getByRole('button', { name: 'Cancel' }))
        await user.click(screen.getByRole('button', { name: /New User/ }))
        expect(within(dialog()).getByLabelText(/Password/i)).toBeInTheDocument()
    })

    it('Edit → Create gecisinde eski kullanicinin verisi KALMAZ', async () => {
        const user = setupUser()
        renderUsers()
        const d = await openEdit(user, 'ada@x.com')
        await user.click(within(d).getByRole('button', { name: 'Cancel' }))
        await user.click(screen.getByRole('button', { name: /New User/ }))
        const create = dialog()
        expect(within(create).getByLabelText('Email')).toHaveValue('')
        expect(within(create).getByLabelText('Full Name')).toHaveValue('')
    })
})

describe('KUSUR 1 — geciken rol yaniti YANLIS forma yazilmaz', () => {
    it('Edit A → Edit B: A’nin gec gelen rolleri B’ye ATANMAZ', async () => {
        const gateA = deferred()
        rbacService.getUserRoles.mockImplementation((id) =>
            id === 'u1' ? gateA.promise : Promise.resolve({ roles: [] })
        )
        const user = setupUser()
        renderUsers()

        // A acilir; rol yaniti HENUZ gelmedi.
        let d = await openEdit(user, 'ada@x.com')
        await user.click(within(d).getByRole('button', { name: 'Cancel' }))

        // B acilir (rolleri bos).
        d = await openEdit(user, 'bob@x.com')
        expect(within(d).getByLabelText('Email')).toHaveValue('bob@x.com')

        // A'nin yaniti SIMDI gelir — system-admin ile.
        gateA.resolve({ roles: [{ id: 'r1', code: 'system-admin' }] })
        await new Promise((r) => setTimeout(r, 0))

        // B kaydedilir: A'nin rolleri B'ye GITMEZ.
        await user.click(within(d).getByRole('button', { name: /Update/ }))
        await waitFor(() => expect(authService.updateUser).toHaveBeenCalled())
        expect(rbacService.setUserRoles).toHaveBeenCalledWith('u2', [])
    })

    it('yaris yoksa kullanicinin GERCEK rolleri yuklenir', async () => {
        rbacService.getUserRoles.mockResolvedValue({
            roles: [{ id: 'r2', code: 'reporter' }],
        })
        const user = setupUser()
        renderUsers()
        const d = await openEdit(user, 'ada@x.com')
        await user.click(within(d).getByRole('button', { name: /Update/ }))
        await waitFor(() => expect(rbacService.setUserRoles).toHaveBeenCalled())
        expect(rbacService.setUserRoles).toHaveBeenCalledWith('u1', ['r2'])
    })
})

describe('cift gonderim ve hata mesaji', () => {
    it('PENDING iken ikinci gonderim YENI istek ACMAZ', async () => {
        const gate = deferred()
        authService.updateUser.mockImplementationOnce(() => gate.promise)
        const user = setupUser()
        renderUsers()
        const d = await openEdit(user, 'ada@x.com')
        const submit = within(d).getByRole('button', { name: /Update/ })
        await user.click(submit)
        await waitFor(() => expect(authService.updateUser).toHaveBeenCalledTimes(1))
        await user.click(submit)
        await user.click(submit)
        expect(authService.updateUser).toHaveBeenCalledTimes(1)
        gate.resolve({})
    })

    it('rol uygulama KISMI basarisizligi kendi mesajini KORUR', async () => {
        // Yerel firlatilan domain hatasi (HTTP yaniti YOK) —
        // "sunucuya ulasilamiyor" diye EZILMEMELI.
        rbacService.setUserRoles.mockRejectedValueOnce({
            response: { status: 400, data: { detail: 'subset rule' } },
        })
        const user = setupUser()
        renderUsers()
        const d = await openEdit(user, 'ada@x.com')
        await user.click(within(d).getByRole('button', { name: /Update/ }))
        expect(await screen.findByText(/roles could not be applied/i)).toBeInTheDocument()
    })

    it('sunucu hatasi ANLAMLI metne cevrilir — "Error" degil', async () => {
        authService.updateUser.mockRejectedValueOnce({
            response: { status: 500, data: { detail: 'sqlalchemy boom' } },
        })
        const user = setupUser()
        renderUsers()
        const d = await openEdit(user, 'ada@x.com')
        await user.click(within(d).getByRole('button', { name: /Update/ }))
        expect(await screen.findByText(/server had a problem/i)).toBeInTheDocument()
        expect(screen.queryByText(/sqlalchemy/)).not.toBeInTheDocument()
    })
})

describe('liste durumu sozlesmesi', () => {
    it('arama girdisinin ERISILEBILIR ADI vardir ve listeyi daraltir', async () => {
        const user = setupUser()
        renderUsers()
        await screen.findByText('ada@x.com')
        await user.type(screen.getByLabelText('Search Users'), 'bob')
        await waitFor(() =>
            expect(screen.queryByText('ada@x.com')).not.toBeInTheDocument()
        )
        expect(screen.getByText('bob@x.com')).toBeInTheDocument()
    })

    it('FILTRE sonucu yoklugu ILK KULLANIM boslugundan AYRIDIR', async () => {
        const user = setupUser()
        renderUsers()
        await screen.findByText('ada@x.com')
        await user.type(screen.getByLabelText('Search Users'), 'zzzz')
        expect(await screen.findByText(/No users match “zzzz”/)).toBeInTheDocument()

        authService.getUsers.mockResolvedValue({ data: [] })
        renderUsers()
        expect(await screen.findByText(/No users yet/)).toBeInTheDocument()
    })

    it('liste hatasinda RETRY sunulur — sessiz bos tablo YOK', async () => {
        authService.getUsers.mockRejectedValueOnce({ response: { status: 503, data: {} } })
        const user = setupUser()
        renderUsers()
        const retry = await screen.findByRole('button', { name: 'Retry' })
        expect(screen.getByText(/server had a problem/i)).toBeInTheDocument()
        authService.getUsers.mockResolvedValue({ data: USERS })
        await user.click(retry)
        expect(await screen.findByText('ada@x.com')).toBeInTheDocument()
    })
})
