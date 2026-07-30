/**
 * =============================================================================
 * Sprint 6B.2 completion — Assignment Hierarchy
 * =============================================================================
 * ATAMA SEMANTIGI DEGISTIRILMEDI. Bu yuzeyin is kurali (bir assigner'in
 * hangi kullanici/gruplara atama yapabilecegi, 409'un "zaten esli"
 * anlamina gelmesi, grup kurallarinin task aninda uyelere fan-out
 * etmesi) oldugu gibi korundu ve testle SABITLENDI. Kapatilan seyler
 * yalnizca UX/guvenilirlik katmani:
 *
 *   1. Kurallar IKI sorgudan gelir. Biri basarisiz olursa geri kalan
 *      kartlar EKSIK bir hiyerarsiyi TAM gibi gosteriyordu — yetki
 *      verisinde bu yaniltici. Hata + retry eklendi.
 *   2. Ne kural ekleme ne kural kaldirma pending kilidi tasiyordu.
 *   3. `|| 'Failed to ...'`: teknik govdeler sizabiliyordu.
 *   4. Bir karttan on-secili assigner ile acilan modal kapandiktan
 *      sonra genel butondan acildiginda ESKI assigner kaliyordu
 *      (`initialValues` yalniz mount'ta uygulanir, `afterClose`
 *      resetFields o anki initial degerlere doner).
 *   5. Ikon-only kaldirma butonlarinin erisilebilir adi yoktu.
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'

const authService = { lookupUsers: vi.fn() }
const userGroupService = { list: vi.fn() }
const taskAssignmentService = { list: vi.fn(), create: vi.fn(), delete: vi.fn() }
const taskAssignmentGroupService = { list: vi.fn(), create: vi.fn(), delete: vi.fn() }

vi.mock('../../services/api', () => ({
    authService, userGroupService, taskAssignmentService, taskAssignmentGroupService,
}))

const AssignmentHierarchyTab =
    (await import('../../pages/admin/AssignmentHierarchyTab')).default
const { makeTestQueryClient } = await import('../utils')

const USERS = [
    { id: 'u1', full_name: 'Ada Lovelace', email: 'ada@x.com', is_active: true },
    { id: 'u2', full_name: 'Bob Bit', email: 'bob@x.com', is_active: true },
    { id: 'u3', full_name: 'Cleo Cache', email: 'cleo@x.com', is_active: true },
]
const GROUPS = [
    { id: 'g1', name: 'Technical Team', is_active: true, member_count: 3 },
    { id: 'g2', name: 'Support', is_active: true, member_count: 1 },
]
const USER_RELS = [{ id: 'ur1', assigner_user_id: 'u1', assignee_user_id: 'u2', scope: 'task' }]
const GROUP_RELS = [{ id: 'gr1', assigner_user_id: 'u1', assignee_group_id: 'g1', scope: 'task' }]

const setupUser = () => userEvent.setup({ delay: null })
const deferred = () => {
    let resolve
    const promise = new Promise((res) => { resolve = res })
    return { promise, resolve }
}
const httpError = (status, data) => ({ response: { status, data } })

const renderTab = (scope = 'task') =>
    render(
        <QueryClientProvider client={makeTestQueryClient()}>
            <AssignmentHierarchyTab scope={scope} />
        </QueryClientProvider>
    )

const confirmDialog = (nameRe) => screen.findByRole('dialog', { name: nameRe })

/**
 * AddRuleModal `destroyOnHidden` kullanir, yani kapanip yeniden acilir.
 * Diyalog BASLIK METNI uzerinden bulunur: rc-util `useId` NODE_ENV=test
 * altinda SABIT "test-id" dondurdugu icin ust uste acilan diyaloglarda
 * erisilebilir ad cozumu IKINCI acilista bozulabiliyor (test ortami
 * artefakti; gercek tarayicida id'ler benzersiz).
 */
const dialogByTitle = async (titleRe) => {
    const title = await screen.findByText(titleRe, { selector: '.ant-modal-title' })
    return title.closest('[role="dialog"]')
}

const awaitDialogGone = async () => {
    await waitFor(() =>
        expect(document.querySelector('.ant-modal-content')).toBeNull()
    )
}

/** Assigner kartini genisletir. */
const expandAssigner = async (user, label) => {
    const el = await screen.findByText(label)
    await user.click(el)
}

beforeEach(() => {
    vi.clearAllMocks()
    authService.lookupUsers.mockResolvedValue(USERS.map((u) => ({ ...u })))
    userGroupService.list.mockResolvedValue(GROUPS.map((g) => ({ ...g })))
    taskAssignmentService.list.mockResolvedValue(USER_RELS.map((r) => ({ ...r })))
    taskAssignmentGroupService.list.mockResolvedValue(GROUP_RELS.map((r) => ({ ...r })))
    taskAssignmentService.create.mockResolvedValue({})
    taskAssignmentGroupService.create.mockResolvedValue({})
    taskAssignmentService.delete.mockResolvedValue({})
    taskAssignmentGroupService.delete.mockResolvedValue({})
})

describe('KARAKTERIZASYON — atama semantigi', () => {
    it('assigner basina TEK kart, kullanici ve grup sayilariyla', async () => {
        renderTab()
        expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
        expect(screen.getByText('1 user')).toBeInTheDocument()
        expect(screen.getByText('1 group')).toBeInTheDocument()
    })

    it('scope sorgulara AYNEN gecirilir', async () => {
        renderTab('issue')
        await waitFor(() =>
            expect(taskAssignmentService.list).toHaveBeenCalledWith('issue')
        )
        expect(taskAssignmentGroupService.list).toHaveBeenCalledWith('issue')
    })

    it('kullanici ve grup kurallari AYRI uclara yazilir', async () => {
        const user = setupUser()
        renderTab()
        await screen.findByText('Ada Lovelace')
        await user.click(screen.getByRole('button', { name: 'Add assignment rule for Ada Lovelace' }))
        const dialog = await dialogByTitle(/Add Assignment Rules/)

        // Assigner on-secili geldi (kart butonundan acildi).
        const combos = within(dialog).getAllByRole('combobox')
        await user.click(combos[1]) // Assignee Users
        await user.click(await screen.findByTitle('Cleo Cache'))
        await user.click(combos[2]) // Assignee Groups
        await user.click(await screen.findByTitle('Support'))
        await user.click(within(dialog).getByRole('button', { name: /Save/ }))

        await waitFor(() => expect(taskAssignmentService.create).toHaveBeenCalled())
        expect(taskAssignmentService.create).toHaveBeenCalledWith({
            assigner_user_id: 'u1', assignee_user_ids: ['u3'], scope: 'task',
        })
        expect(taskAssignmentGroupService.create).toHaveBeenCalledWith({
            assigner_user_id: 'u1', assignee_group_id: 'g2', scope: 'task',
        })
    })

    it('409 "zaten esli" HATA SAYILMAZ (grup kurallarinda)', async () => {
        taskAssignmentGroupService.create.mockRejectedValueOnce(
            httpError(409, { detail: 'already mapped' })
        )
        const user = setupUser()
        renderTab()
        await screen.findByText('Ada Lovelace')
        await user.click(screen.getByRole('button', { name: 'Add assignment rule for Ada Lovelace' }))
        const dialog = await dialogByTitle(/Add Assignment Rules/)
        const combos = within(dialog).getAllByRole('combobox')
        await user.click(combos[2])
        await user.click(await screen.findByTitle('Support'))
        await user.click(within(dialog).getByRole('button', { name: /Save/ }))
        // Basari mesaji verilir; 409 sessiz no-op'tur.
        expect(await screen.findByText('Assignment rules added.')).toBeInTheDocument()
    })

    it('409 DISI hata gercek basarisizliktir', async () => {
        taskAssignmentGroupService.create.mockRejectedValueOnce(
            httpError(400, { detail: 'Assigner cannot assign to this group.' })
        )
        const user = setupUser()
        renderTab()
        await screen.findByText('Ada Lovelace')
        await user.click(screen.getByRole('button', { name: 'Add assignment rule for Ada Lovelace' }))
        const dialog = await dialogByTitle(/Add Assignment Rules/)
        const combos = within(dialog).getAllByRole('combobox')
        await user.click(combos[2])
        await user.click(await screen.findByTitle('Support'))
        await user.click(within(dialog).getByRole('button', { name: /Save/ }))
        expect(await screen.findByText(/Assigner cannot assign to this group/))
            .toBeInTheDocument()
    })
})

describe('bayat secim TASINMAZ', () => {
    it('on-secili assigner ile acildiktan sonra GENEL acilis TEMIZDIR', async () => {
        const user = setupUser()
        renderTab()
        await screen.findByText('Ada Lovelace')

        // 1) Karttan ac: assigner on-secili.
        await user.click(screen.getByRole('button', { name: 'Add assignment rule for Ada Lovelace' }))
        let dialog = await dialogByTitle(/Add Assignment Rules/)
        expect(within(dialog).getByTitle('Ada Lovelace')).toBeInTheDocument()
        await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
        await awaitDialogGone()

        // 2) Ust butondan ac: eski assigner KALMAZ.
        await user.click(screen.getByRole('button', { name: 'Add assignment rule' }))
        dialog = await dialogByTitle(/Add Assignment Rules/)
        expect(within(dialog).queryByTitle('Ada Lovelace')).not.toBeInTheDocument()
        expect(within(dialog).getByText('Select assigner')).toBeInTheDocument()
    })

    it('secilen assignee’ler bir sonraki acilista KALMAZ', async () => {
        const user = setupUser()
        renderTab()
        await screen.findByText('Ada Lovelace')
        await user.click(screen.getByRole('button', { name: 'Add assignment rule for Ada Lovelace' }))
        let dialog = await dialogByTitle(/Add Assignment Rules/)
        const combos = within(dialog).getAllByRole('combobox')
        await user.click(combos[1])
        await user.click(await screen.findByTitle('Cleo Cache'))
        await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
        await awaitDialogGone()

        await user.click(screen.getByRole('button', { name: 'Add assignment rule for Ada Lovelace' }))
        dialog = await dialogByTitle(/Add Assignment Rules/)
        // Onceki secim etiket olarak KALMAZ.
        expect(within(dialog).queryByTitle('Cleo Cache')).not.toBeInTheDocument()
    })
})

describe('cift tetikleme kilitleri', () => {
    it('PENDING iken ikinci kural ekleme YENI istek ACMAZ', async () => {
        const gate = deferred()
        taskAssignmentService.create.mockImplementationOnce(() => gate.promise)
        const user = setupUser()
        renderTab()
        await screen.findByText('Ada Lovelace')
        await user.click(screen.getByRole('button', { name: 'Add assignment rule for Ada Lovelace' }))
        const dialog = await dialogByTitle(/Add Assignment Rules/)
        const combos = within(dialog).getAllByRole('combobox')
        await user.click(combos[1])
        await user.click(await screen.findByTitle('Cleo Cache'))
        const save = within(dialog).getByRole('button', { name: /Save/ })
        await user.click(save)
        await waitFor(() => expect(taskAssignmentService.create).toHaveBeenCalledTimes(1))
        await user.click(save)
        await user.click(save)
        expect(taskAssignmentService.create).toHaveBeenCalledTimes(1)
        gate.resolve({})
    })

    it('PENDING iken kural kaldirma tekrar tetiklenemez', async () => {
        const gate = deferred()
        taskAssignmentService.delete.mockImplementationOnce(() => gate.promise)
        const user = setupUser()
        renderTab()
        await expandAssigner(user, 'Ada Lovelace')
        await user.click(
            await screen.findByRole('button', { name: /Remove Bob Bit from Ada Lovelace/ })
        )
        const dialog = await confirmDialog(/Remove assignment mapping\?/)
        const confirm = within(dialog).getByRole('button', { name: /Remove/ })
        await user.click(confirm)
        await waitFor(() => expect(taskAssignmentService.delete).toHaveBeenCalledTimes(1))
        await user.click(confirm)
        await user.click(confirm)
        expect(taskAssignmentService.delete).toHaveBeenCalledTimes(1)
        gate.resolve({})
    })
})

describe('erisilebilir aksiyon adlari', () => {
    it('kaldirma butonlari KIMI ve KIMDEN kaldirdigini soyler', async () => {
        const user = setupUser()
        renderTab()
        await expandAssigner(user, 'Ada Lovelace')
        expect(
            await screen.findByRole('button', { name: /Remove Bob Bit from Ada Lovelace/ })
        ).toBeInTheDocument()
        expect(
            screen.getByRole('button', {
                name: /Remove group Technical Team from Ada Lovelace/,
            })
        ).toBeInTheDocument()
    })

    it('arama girdisinin ERISILEBILIR ADI vardir', async () => {
        renderTab()
        await screen.findByText('Ada Lovelace')
        expect(screen.getByLabelText('Search assigner by name or email'))
            .toBeInTheDocument()
    })
})

describe('yukleme hatalari EKSIK hiyerarsiyi TAM gostermez', () => {
    it('kullanici kurallari sorgusu basarisiz olunca hata + RETRY', async () => {
        taskAssignmentService.list.mockRejectedValueOnce(httpError(503, {}))
        const user = setupUser()
        renderTab()
        const retry = await screen.findByRole('button', { name: 'Retry' })
        expect(screen.getByText(/server had a problem/i)).toBeInTheDocument()
        taskAssignmentService.list.mockResolvedValue(USER_RELS)
        await user.click(retry)
        expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
    })

    it('GRUP kurallari eksikse bu ACIKCA soylenir', async () => {
        taskAssignmentGroupService.list.mockRejectedValueOnce(httpError(500, {}))
        renderTab()
        expect(await screen.findByText(/Group rules are missing/)).toBeInTheDocument()
    })

    it('teknik govde kullaniciya SIZMAZ', async () => {
        taskAssignmentService.list.mockRejectedValueOnce(
            httpError(500, { detail: 'sqlalchemy.exc.ProgrammingError: boom' })
        )
        renderTab()
        await screen.findByRole('button', { name: 'Retry' })
        expect(screen.queryByText(/sqlalchemy/)).not.toBeInTheDocument()
    })
})

describe('bos durumlar', () => {
    it('hic kural yoksa ILK KULLANIM mesaji', async () => {
        taskAssignmentService.list.mockResolvedValue([])
        taskAssignmentGroupService.list.mockResolvedValue([])
        renderTab()
        expect(await screen.findByText(/No assignment rules yet/)).toBeInTheDocument()
    })

    it('arama sonucu yoksa FARKLI mesaj', async () => {
        const user = setupUser()
        renderTab()
        await screen.findByText('Ada Lovelace')
        await user.type(
            screen.getByLabelText('Search assigner by name or email'), 'zzzz'
        )
        expect(await screen.findByText(/No assigner matches your search/))
            .toBeInTheDocument()
    })
})
