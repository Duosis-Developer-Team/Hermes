/**
 * =============================================================================
 * Sprint 6B.2 completion — User Groups + Group Members
 * =============================================================================
 * Once KARAKTERIZASYON: sanal (built-in) gruplarin salt-okunur olmasi,
 * uye panelinin gruba gore izole olmasi ve gercek deactivate sozlesmesi
 * testle sabitlenir. Sonra eksik davranislar kapatilir.
 *
 * Bu yuzeyde bulunan EN CIDDI kusur, kod okunurken degil test yazilirken
 * ortaya cikti: `UserGroupMemberModal` icindeki `noCandidates` bir
 * BOOLEAN degil, ters kurulmus bir ternary'nin dondurdugu STRING'di:
 *
 *   const noCandidates = !isEditing && candidateUsers.length === 0
 *       ? 'Save Changes'
 *       : `Add Member...`
 *
 * Her iki dal da dolu bir string dondurdugu icin deger HER ZAMAN
 * truthy'di. Sonuc: `okButtonProps={{ disabled: noCandidates }}` yuzunden
 * onay butonu HER DURUMDA disabled ve "All users are already members"
 * bilgi kutusu HER DURUMDA gorunuyordu — yani gruba uye eklemek ve uye
 * basligini duzenlemek TAMAMEN calismaz durumdaydi.
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'

const authService = { lookupUsers: vi.fn() }
const userGroupService = {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deactivate: vi.fn(),
    listMembers: vi.fn(),
    addMember: vi.fn(),
    updateMember: vi.fn(),
    removeMember: vi.fn(),
}

vi.mock('../../services/api', () => ({ authService, userGroupService }))

const UserGroupsTab = (await import('../../pages/admin/UserGroupsTab')).default
const { makeTestQueryClient } = await import('../utils')

const USERS = [
    { id: 'u1', full_name: 'Ada Lovelace', email: 'ada@x.com', is_admin: true, is_active: true },
    { id: 'u2', full_name: 'Bob Bit', email: 'bob@x.com', is_admin: false, is_active: true },
    { id: 'u3', full_name: 'Cleo Cache', email: 'cleo@x.com', is_admin: false, is_active: true },
]
const GROUPS = [
    { id: 'g1', name: 'Technical Team', description: 'Builds things', is_active: true, member_count: 1 },
    // `description` BILEREK YOK: bayat deger kontrolu icin.
    { id: 'g2', name: 'Support', is_active: true, member_count: 0 },
]
const MEMBERS_G1 = [{ id: 'm1', user_id: 'u2', title: 'Senior Developer' }]

const setupUser = () => userEvent.setup({ delay: null })
const deferred = () => {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}
const httpError = (status, data) => ({ response: { status, data } })

const renderGroups = () =>
    render(
        <QueryClientProvider client={makeTestQueryClient()}>
            <UserGroupsTab />
        </QueryClientProvider>
    )

const groupDialog = () => screen.getByRole('dialog')
const dlgButton = (name) => within(groupDialog()).getByRole('button', { name })

/**
 * Onay diyaloglari: `DangerConfirmModal` basligi BILEREK iki kez cizer —
 * biri gorsel, biri rc-dialog'a ad veren gorsel-gizli baslik (Sprint 5C
 * a11y karari). Bu yuzden metin degil DIYALOG ADI aranir.
 */
const confirmDialog = (nameRe) => screen.findByRole('dialog', { name: nameRe })
/**
 * AntD ikonlari `role="img" aria-label="delete"` cizer ve bu, butonun
 * erisilebilir adina KATILIR ("delete Remove"). Bu yuzden onay butonlari
 * diyalog KAPSAMINDA ve capasiz desenle aranir.
 */
const confirmButton = (dialog, re) =>
    within(dialog).getByRole('button', { name: re })

/**
 * Grup satirini genisletir (uye paneli acilir) — satirin KENDISI tiklanir.
 * ONCE tablonun yuklenmesi beklenir: AntD yuklenirken tabloyu bulanik
 * yapar ve `pointer-events: none` uygular, yani sanal satirlar gorunse
 * bile TIKLANAMAZ.
 */
const expandGroup = async (user, name) => {
    await screen.findByText('Technical Team')
    const cell = await screen.findByText(name)
    const row = cell.closest('tr')
    await user.click(row)
    return row
}
/** Genisletilmis satirin uye panelini dondurur. */
const memberPanel = (name) => {
    const row = screen.getByText(name).closest('tr')
    return row.nextElementSibling
}

beforeEach(() => {
    vi.clearAllMocks()
    authService.lookupUsers.mockResolvedValue(USERS.map((u) => ({ ...u })))
    userGroupService.list.mockResolvedValue(GROUPS.map((g) => ({ ...g })))
    userGroupService.listMembers.mockImplementation((gid) =>
        Promise.resolve(gid === 'g1' ? MEMBERS_G1.map((m) => ({ ...m })) : [])
    )
    userGroupService.create.mockResolvedValue({ id: 'gnew' })
    userGroupService.update.mockResolvedValue({})
    userGroupService.deactivate.mockResolvedValue({})
    userGroupService.addMember.mockResolvedValue({})
    userGroupService.updateMember.mockResolvedValue({})
    userGroupService.removeMember.mockResolvedValue({})
})

describe('KARAKTERIZASYON — built-in gruplar ve liste', () => {
    it('sanal gruplar EN USTTE ve salt-okunur gosterilir', async () => {
        renderGroups()
        expect(await screen.findByText('Admins')).toBeInTheDocument()
        expect(screen.getByText('General Users')).toBeInTheDocument()
        expect(screen.getAllByText('Built-in').length).toBe(2)
        // Salt-okunur: duzenle/sil aksiyonu SUNULMAZ.
        expect(screen.queryByRole('button', { name: /Edit Admins/ })).not.toBeInTheDocument()
    })

    it('sanal grup uyeligi kullanici rolunden TURETILIR', async () => {
        const user = setupUser()
        renderGroups()
        await expandGroup(user, 'Admins')
        // is_admin=true olan tek kullanici.
        expect(await screen.findByText(/membership is automatic/)).toBeInTheDocument()
        const panel = memberPanel('Admins')
        expect(within(panel).getByText('ada@x.com')).toBeInTheDocument()
        // Admin olmayan kullanici bu panelde YOK.
        expect(within(panel).queryByText('bob@x.com')).not.toBeInTheDocument()
    })

    it('gercek gruplar sanal gruplardan SONRA gelir', async () => {
        renderGroups()
        await screen.findByText('Technical Team')
        const names = screen.getAllByRole('row').map((r) => r.textContent)
        const iAdmins = names.findIndex((t) => t?.includes('Admins'))
        const iReal = names.findIndex((t) => t?.includes('Technical Team'))
        expect(iAdmins).toBeGreaterThan(-1)
        expect(iReal).toBeGreaterThan(iAdmins)
    })
})

describe('erisilebilir satir aksiyonlari', () => {
    it('grup aksiyonlari HANGI grubu hedefledigini SOYLER', async () => {
        renderGroups()
        expect(await screen.findByRole('button', { name: 'Edit Technical Team' }))
            .toBeInTheDocument()
        // Backend gercekten DEACTIVATE eder (soft) — etiket bunu soyler.
        expect(screen.getByRole('button', { name: 'Archive Technical Team' }))
            .toBeInTheDocument()
    })

    it('uye aksiyonlari HANGI uyeyi hedefledigini SOYLER', async () => {
        const user = setupUser()
        renderGroups()
        await expandGroup(user, 'Technical Team')
        expect(await screen.findByRole('button', { name: /Edit title for Bob Bit/ }))
            .toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Remove Bob Bit from group/ }))
            .toBeInTheDocument()
    })
})

describe('KUSUR — uye ekleme onay butonu HER ZAMAN disabled’di', () => {
    it('aday kullanici VARKEN onay butonu ETKINDIR', async () => {
        const user = setupUser()
        renderGroups()
        await expandGroup(user, 'Technical Team')
        await user.click(await screen.findByRole('button', { name: /Add Member/ }))
        const dialog = await screen.findByRole('dialog', { name: /Add Members/ })
        // Eski davranista bu buton disabled'di → uye HIC eklenemiyordu.
        expect(within(dialog).getByRole('button', { name: /^Add Members$/ }))
            .toBeEnabled()
    })

    it('aday kullanici VARKEN "hepsi uye" uyarisi GOSTERILMEZ', async () => {
        const user = setupUser()
        renderGroups()
        await expandGroup(user, 'Technical Team')
        await user.click(await screen.findByRole('button', { name: /Add Member/ }))
        expect(
            screen.queryByText(/All users are already members/)
        ).not.toBeInTheDocument()
    })

    it('GERCEKTEN aday yoksa uyari gosterilir ve onay kapatilir', async () => {
        // Grubun uyeleri tum aktif kullanicilari kapsiyor.
        userGroupService.listMembers.mockResolvedValue([
            { id: 'm1', user_id: 'u1', title: null },
            { id: 'm2', user_id: 'u2', title: null },
            { id: 'm3', user_id: 'u3', title: null },
        ])
        const user = setupUser()
        renderGroups()
        await expandGroup(user, 'Technical Team')
        await user.click(await screen.findByRole('button', { name: /Add Member/ }))
        const dialog = await screen.findByRole('dialog', { name: /Add Members/ })
        expect(within(dialog).getByText(/All users are already members/))
            .toBeInTheDocument()
        expect(within(dialog).getByRole('button', { name: /^Add Members$/ }))
            .toBeDisabled()
    })

    it('uye basligi duzenleme onayi ETKINDIR', async () => {
        const user = setupUser()
        renderGroups()
        await expandGroup(user, 'Technical Team')
        await user.click(
            await screen.findByRole('button', { name: /Edit title for Bob Bit/ })
        )
        const dialog = await screen.findByRole('dialog', { name: /Edit Member Title/ })
        expect(within(dialog).getByRole('button', { name: /Save Changes/ }))
            .toBeEnabled()
        // Kimlik ham UUID olarak GOSTERILMEZ (salt-okunur alan, bu yuzden
        // label baglantisi yok — goruntulenen DEGER uzerinden dogrulanir).
        expect(within(dialog).getByDisplayValue('Bob Bit')).toBeInTheDocument()
        expect(within(dialog).queryByDisplayValue('u2')).not.toBeInTheDocument()
    })
})

describe('uye ekleme / cikarma davranisi', () => {
    it('secilen kullanicilar icin addMember cagrilir', async () => {
        const user = setupUser()
        renderGroups()
        await expandGroup(user, 'Technical Team')
        await user.click(await screen.findByRole('button', { name: /Add Member/ }))
        const dialog = await screen.findByRole('dialog', { name: /Add Members/ })

        await user.click(within(dialog).getByRole('combobox'))
        await user.click(await screen.findByTitle('Cleo Cache'))
        await user.click(within(dialog).getByRole('button', { name: /^Add Members$/ }))

        await waitFor(() => expect(userGroupService.addMember).toHaveBeenCalled())
        expect(userGroupService.addMember).toHaveBeenCalledWith('g1', {
            user_id: 'u3', title: null,
        })
    })

    it('PENDING iken ikinci ekleme YENI istek ACMAZ', async () => {
        const gate = deferred()
        userGroupService.addMember.mockImplementationOnce(() => gate.promise)
        const user = setupUser()
        renderGroups()
        await expandGroup(user, 'Technical Team')
        await user.click(await screen.findByRole('button', { name: /Add Member/ }))
        const dialog = await screen.findByRole('dialog', { name: /Add Members/ })
        await user.click(within(dialog).getByRole('combobox'))
        await user.click(await screen.findByTitle('Cleo Cache'))
        const ok = within(dialog).getByRole('button', { name: /^Add Members$/ })
        await user.click(ok)
        await waitFor(() => expect(userGroupService.addMember).toHaveBeenCalledTimes(1))
        await user.click(ok)
        await user.click(ok)
        expect(userGroupService.addMember).toHaveBeenCalledTimes(1)
        gate.resolve({})
    })

    it('uye cikarma ONAY ister ve dogru uyeyi hedefler', async () => {
        const user = setupUser()
        renderGroups()
        await expandGroup(user, 'Technical Team')
        await user.click(
            await screen.findByRole('button', { name: /Remove Bob Bit from group/ })
        )
        const dialog = await confirmDialog(/Remove member from group\?/)
        await user.click(confirmButton(dialog, /Remove/))
        await waitFor(() =>
            expect(userGroupService.removeMember).toHaveBeenCalledWith('g1', 'm1')
        )
    })

    it('PENDING iken uye cikarma tekrar tetiklenemez', async () => {
        const gate = deferred()
        userGroupService.removeMember.mockImplementationOnce(() => gate.promise)
        const user = setupUser()
        renderGroups()
        await expandGroup(user, 'Technical Team')
        await user.click(
            await screen.findByRole('button', { name: /Remove Bob Bit from group/ })
        )
        const dialog = await confirmDialog(/Remove member from group\?/)
        const confirm = confirmButton(dialog, /Remove/)
        await user.click(confirm)
        await waitFor(() => expect(userGroupService.removeMember).toHaveBeenCalledTimes(1))
        await user.click(confirm)
        await user.click(confirm)
        expect(userGroupService.removeMember).toHaveBeenCalledTimes(1)
        gate.resolve({})
    })

    it('DUPLICATE uyelik anlasilir sekilde bildirilir', async () => {
        userGroupService.addMember.mockRejectedValueOnce(
            httpError(409, { detail: 'User is already a member of this group.' })
        )
        const user = setupUser()
        renderGroups()
        await expandGroup(user, 'Technical Team')
        await user.click(await screen.findByRole('button', { name: /Add Member/ }))
        const dialog = await screen.findByRole('dialog', { name: /Add Members/ })
        await user.click(within(dialog).getByRole('combobox'))
        await user.click(await screen.findByTitle('Cleo Cache'))
        await user.click(within(dialog).getByRole('button', { name: /^Add Members$/ }))
        expect(await screen.findByText(/already a member/)).toBeInTheDocument()
    })

    it('uye mutasyonu uyelik + grup + izin cache’lerini tazeler', async () => {
        const user = setupUser()
        renderGroups()
        await expandGroup(user, 'Technical Team')
        await user.click(
            await screen.findByRole('button', { name: /Remove Bob Bit from group/ })
        )
        const dialog = await confirmDialog(/Remove member from group\?/)
        await user.click(confirmButton(dialog, /Remove/))
        await waitFor(() => expect(userGroupService.removeMember).toHaveBeenCalled())
        // Uyelik degisti → uye listesi ve grup listesi yeniden cekilir.
        await waitFor(() =>
            expect(userGroupService.listMembers.mock.calls.length).toBeGreaterThan(1)
        )
        await waitFor(() =>
            expect(userGroupService.list.mock.calls.length).toBeGreaterThan(1)
        )
    })
})

describe('uye paneli gruba gore IZOLE', () => {
    it('her grubun paneli YALNIZ kendi uyelerini gosterir', async () => {
        const user = setupUser()
        renderGroups()
        await expandGroup(user, 'Technical Team')
        expect(await screen.findByText('Senior Developer')).toBeInTheDocument()

        await expandGroup(user, 'Support')
        await waitFor(() =>
            expect(userGroupService.listMembers).toHaveBeenCalledWith('g2')
        )
        // Support paneli BOS; Technical Team'in uyesi buraya sizmaz.
        const supportPanel = memberPanel('Support')
        expect(within(supportPanel).getByText('No members yet.')).toBeInTheDocument()
        expect(within(supportPanel).queryByText('Senior Developer'))
            .not.toBeInTheDocument()
    })

    it('grup kapatildiginda uye paneli GORUNMEZ olur', async () => {
        const user = setupUser()
        renderGroups()
        await expandGroup(user, 'Technical Team')
        const title = await screen.findByText('Senior Developer')
        expect(title).toBeVisible()
        await expandGroup(user, 'Technical Team')
        // rc-table kapanan satiri DOM'dan silmez, GIZLER — bu yuzden
        // varlik degil GORUNURLUK dogrulanir.
        await waitFor(() => expect(title).not.toBeVisible())
    })
})

describe('grup modal lifecycle', () => {
    it('Create temiz defaultlarla acilir', async () => {
        const user = setupUser()
        renderGroups()
        await screen.findByText('Technical Team')
        await user.click(screen.getByRole('button', { name: /Create Group/ }))
        const d = await screen.findByRole('dialog', { name: /Create Group/ })
        expect(within(d).getByLabelText('Group Name')).toHaveValue('')
        expect(within(d).getByLabelText('Description')).toHaveValue('')
    })

    it('Edit A → Edit B: A’nin aciklamasi B’ye TASINMAZ', async () => {
        const user = setupUser()
        renderGroups()
        await user.click(await screen.findByRole('button', { name: 'Edit Technical Team' }))
        let d = await screen.findByRole('dialog', { name: /Edit Group/ })
        expect(within(d).getByLabelText('Description')).toHaveValue('Builds things')
        await user.click(within(d).getByRole('button', { name: 'Cancel' }))

        await user.click(screen.getByRole('button', { name: 'Edit Support' }))
        d = await screen.findByRole('dialog', { name: /Edit Group/ })
        expect(within(d).getByLabelText('Group Name')).toHaveValue('Support')
        expect(within(d).getByLabelText('Description')).toHaveValue('')
    })

    it('Edit → Create gecisinde eski deger KALMAZ', async () => {
        const user = setupUser()
        renderGroups()
        await user.click(await screen.findByRole('button', { name: 'Edit Technical Team' }))
        await user.click(dlgButton('Cancel'))
        await user.click(screen.getByRole('button', { name: /Create Group/ }))
        const d = await screen.findByRole('dialog', { name: /Create Group/ })
        expect(within(d).getByLabelText('Group Name')).toHaveValue('')
    })

    it('yalniz BOSLUK isim gecersizdir — bos ad GONDERILMEZ', async () => {
        const user = setupUser()
        renderGroups()
        await screen.findByText('Technical Team')
        await user.click(screen.getByRole('button', { name: /Create Group/ }))
        const d = await screen.findByRole('dialog', { name: /Create Group/ })
        await user.type(within(d).getByLabelText('Group Name'), '   ')
        await user.click(within(d).getByRole('button', { name: /^Create Group$/ }))
        expect(await screen.findByText(/Group name is required/)).toBeInTheDocument()
        expect(userGroupService.create).not.toHaveBeenCalled()
    })

    it('PENDING iken ikinci grup gonderimi YENI istek ACMAZ', async () => {
        const gate = deferred()
        userGroupService.create.mockImplementationOnce(() => gate.promise)
        const user = setupUser()
        renderGroups()
        await screen.findByText('Technical Team')
        await user.click(screen.getByRole('button', { name: /Create Group/ }))
        const d = await screen.findByRole('dialog', { name: /Create Group/ })
        await user.type(within(d).getByLabelText('Group Name'), 'Yeni Grup')
        const ok = within(d).getByRole('button', { name: /^Create Group$/ })
        await user.click(ok)
        await waitFor(() => expect(userGroupService.create).toHaveBeenCalledTimes(1))
        await user.click(ok)
        await user.click(ok)
        expect(userGroupService.create).toHaveBeenCalledTimes(1)
        gate.resolve({})
    })

    it('DUPLICATE grup adi FORM seviyesinde gosterilir, girdi KORUNUR', async () => {
        userGroupService.create.mockRejectedValueOnce(
            httpError(409, { detail: 'A group with this name already exists.' })
        )
        const user = setupUser()
        renderGroups()
        await screen.findByText('Technical Team')
        await user.click(screen.getByRole('button', { name: /Create Group/ }))
        const d = await screen.findByRole('dialog', { name: /Create Group/ })
        await user.type(within(d).getByLabelText('Group Name'), 'Technical Team')
        await user.click(within(d).getByRole('button', { name: /^Create Group$/ }))
        expect(await screen.findByText('A group with this name already exists.'))
            .toBeInTheDocument()
        expect(within(screen.getByRole('dialog')).getByLabelText('Group Name'))
            .toHaveValue('Technical Team')
    })

    it('teknik 5xx govdesi kullaniciya SIZMAZ', async () => {
        userGroupService.create.mockRejectedValueOnce(
            httpError(500, { detail: 'sqlalchemy.exc.IntegrityError: dup' })
        )
        const user = setupUser()
        renderGroups()
        await screen.findByText('Technical Team')
        await user.click(screen.getByRole('button', { name: /Create Group/ }))
        const d = await screen.findByRole('dialog', { name: /Create Group/ })
        await user.type(within(d).getByLabelText('Group Name'), 'X')
        await user.click(within(d).getByRole('button', { name: /^Create Group$/ }))
        expect(await screen.findByText(/server had a problem/i)).toBeInTheDocument()
        expect(screen.queryByText(/sqlalchemy/)).not.toBeInTheDocument()
    })
})

describe('grup arsivleme — gercek sozlesme SOFT’tur', () => {
    it('onay metni ARSIVLEME der ve deactivate cagrilir', async () => {
        const user = setupUser()
        renderGroups()
        await user.click(
            await screen.findByRole('button', { name: 'Archive Technical Team' })
        )
        // Backend `deactivate` cagirir; UI "kalici sil" DEMEZ.
        const dialog = await confirmDialog(/Archive group\?/)
        await user.click(confirmButton(dialog, /Archive Group/))
        await waitFor(() =>
            expect(userGroupService.deactivate).toHaveBeenCalledWith('g1')
        )
    })

    it('PENDING iken arsivleme tekrar tetiklenemez', async () => {
        const gate = deferred()
        userGroupService.deactivate.mockImplementationOnce(() => gate.promise)
        const user = setupUser()
        renderGroups()
        await user.click(
            await screen.findByRole('button', { name: 'Archive Technical Team' })
        )
        const dialog = await confirmDialog(/Archive group\?/)
        const confirm = confirmButton(dialog, /Archive Group/)
        await user.click(confirm)
        await waitFor(() => expect(userGroupService.deactivate).toHaveBeenCalledTimes(1))
        await user.click(confirm)
        expect(userGroupService.deactivate).toHaveBeenCalledTimes(1)
        gate.resolve({})
    })
})

describe('liste durumlari', () => {
    it('grup listesi hatasinda RETRY sunulur', async () => {
        userGroupService.list.mockRejectedValueOnce(httpError(503, {}))
        const user = setupUser()
        renderGroups()
        const retry = await screen.findByRole('button', { name: 'Retry' })
        userGroupService.list.mockResolvedValue(GROUPS)
        await user.click(retry)
        expect(await screen.findByText('Technical Team')).toBeInTheDocument()
    })
})
