/**
 * =============================================================================
 * Sprint 5C — KAPI 2: CRUD, validation ve KESIN query invalidation
 * =============================================================================
 * Gercek TasksPage mount edilir. Invalidation testleri "invalidateQueries
 * cagrildi" seviyesinde KALMAZ: her mutasyon icin hangi key ailesinin
 * vuruldugu ve hangilerinin VURULMADIGI ayri ayri dogrulanir.
 *
 * MEVCUT URUN SOZLESMESI (koddan cikarildi, tahmin degil):
 *  - Create YALNIZCA "Assigned by Me" kapsaminda gorunur: gorev
 *    olusturmak = birine atamak; "My Tasks" size ATANANLARI gosterir.
 *  - Create her zaman BULK ucunu kullanir (coklu atanan destegi).
 *  - Kart GOVDESINE tiklamak — completed dahil — DETAY PANELINI acar.
 *    Log Time'in kendi aksiyon dugmesi vardir. (TaskCard bu karari
 *    kodda yorumla belgeliyor; Sprint 5C onu testle KILITLER.)
 *  - Pending gorev dogrudan tamamlanamaz: ilk aksiyon KABUL eder
 *    (→ In Progress), tamamlama sonraki aksiyondur.
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'

vi.mock('../../services/api', async () => await import('./apiMock'))
import {
    PERMS_ADMIN, PERMS_NO_ASSIGN, mkTask, resetTasksApi, taskService,
} from './apiMock'
import {
    inCard, invalidatedFamilies, renderTasksPage, setupUser, taskCard,
    usedLegacyInvalidation,
} from './harness'
import { resetAuthStore } from '../utils'

// Ada (u1) hem atanan hem ATAYAN → kartta Edit/Delete gorunur.
const MINE = mkTask({
    id: 't1', task_code: 'TASK-1', title: 'Gorev basligi',
    assignee_user_id: 'u1', assigner_user_id: 'u1', status: 'in_progress',
})
// Baskasinin atadigi gorev → Ada duzenleyemez/silemez.
const FOREIGN = mkTask({
    id: 't2', task_code: 'TASK-2', title: 'Yabanci gorev',
    assignee_user_id: 'u1', assigner_user_id: 'u2',
})

const deferred = () => {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

const pickOption = async (user, labelText, optionTitle) => {
    await user.click(screen.getByLabelText(labelText))
    await user.click(await screen.findByTitle(optionTitle))
}

/** "Assigned by Me" kapsamina gecer — Create YALNIZ orada gorunur. */
const switchToAssignedByMe = async (user) => {
    await user.click(await screen.findByRole('tab', { name: 'Assigned by Me' }))
}

const openCreateModal = async (user) => {
    await switchToAssignedByMe(user)
    await user.click(
        await screen.findByRole('button', { name: 'New work item' })
    )
    await user.click(await screen.findByRole('menuitem', { name: 'New Task' }))
    return await screen.findByRole('dialog', { name: 'Create Task' })
}

/** Create formunu gecerli hale getirir. */
const fillCreateForm = async (user, { title = 'Yeni gorev' } = {}) => {
    await pickOption(user, 'Customer', 'Vakko')
    await pickOption(user, 'Project', 'ATM Yenileme')
    await pickOption(user, 'Assignees', 'Grace Hopper')
    await user.type(screen.getByLabelText('Task Title'), title)
    await user.type(screen.getByLabelText('Description'), 'Aciklama metni')
}

beforeEach(() => {
    resetAuthStore()
    resetTasksApi({ tasks: [MINE, FOREIGN] })
})

// ─────────────────────────────────────────────────────────────────────────
describe('CREATE — validation', () => {
    it('bos formda title ve description zorunlulugu bildirilir', async () => {
        const user = setupUser()
        renderTasksPage()
        await openCreateModal(user)
        await user.click(screen.getByRole('button', { name: /Create Task/ }))

        expect(await screen.findByText('Customer is required.')).toBeInTheDocument()
        expect(screen.getByText('Task title is required.')).toBeInTheDocument()
        expect(screen.getByText('Description is required.')).toBeInTheDocument()
        expect(taskService.createBulk).not.toHaveBeenCalled()
    })

    it('YALNIZCA BOSLUK iceren baslik/aciklama gecersizdir', async () => {
        const user = setupUser()
        renderTasksPage()
        await openCreateModal(user)
        await pickOption(user, 'Customer', 'Vakko')
        await pickOption(user, 'Project', 'ATM Yenileme')
        await pickOption(user, 'Assignees', 'Grace Hopper')
        await user.type(screen.getByLabelText('Task Title'), '   ')
        await user.type(screen.getByLabelText('Description'), '   ')
        await user.click(screen.getByRole('button', { name: /Create Task/ }))

        // Description kurali OZEL bir validator (Promise) — mesaji
        // baslik kuralindan bir tik SONRA render olur.
        expect(await screen.findByText('Task title is required.')).toBeInTheDocument()
        expect(await screen.findByText('Description is required.')).toBeInTheDocument()
        expect(taskService.createBulk).not.toHaveBeenCalled()
    })

    it('assignee secenekleri IZIN listesinden gelir (Ada kendini goremez)', async () => {
        const user = setupUser()
        renderTasksPage()
        await openCreateModal(user)
        await user.click(screen.getByLabelText('Assignees'))
        // assignable_user_ids = ['u2','u3']
        expect(await screen.findByTitle('Grace Hopper')).toBeInTheDocument()
        expect(screen.getByTitle('Alan Turing')).toBeInTheDocument()
        expect(screen.queryByTitle('Ada Lovelace')).not.toBeInTheDocument()
    })
})

describe('CREATE — payload, tek mutation, invalidation', () => {
    it('dogru payload ile BULK ucuna gider; opsiyonel alanlar null', async () => {
        const user = setupUser()
        renderTasksPage()
        await openCreateModal(user)
        await fillCreateForm(user)
        await user.click(screen.getByRole('button', { name: /Create Task/ }))

        await waitFor(() => expect(taskService.createBulk).toHaveBeenCalledTimes(1))
        const payload = taskService.createBulk.mock.calls[0][0]
        expect(payload).toMatchObject({
            customer_id: 'c1',
            project_id: 'p1',
            sub_project_id: null,      // opsiyonel — bos birakildi
            due_date: null,            // opsiyonel — bos birakildi
            title: 'Yeni gorev',
            description: 'Aciklama metni',
            priority: 'medium',        // varsayilan korunur
            task_type: 'task',
            assignee_user_ids: ['u2'],
            assignee_group_ids: [],
        })
        expect(typeof payload.scheduled_date).toBe('string')
    })

    it('opsiyonel alanlar DOLDURULURSA payload tasir', async () => {
        const user = setupUser()
        renderTasksPage()
        await openCreateModal(user)
        await fillCreateForm(user)
        await pickOption(user, 'Sub Project', 'Faz 1')
        await pickOption(user, 'Priority', 'Urgent')
        await user.click(screen.getByRole('button', { name: /Create Task/ }))

        await waitFor(() => expect(taskService.createBulk).toHaveBeenCalled())
        expect(taskService.createBulk.mock.calls[0][0]).toMatchObject({
            sub_project_id: 'sp1',
            priority: 'urgent',
        })
    })

    it('pending iken ikinci submit YENI mutation ACMAZ, modal KAPANMAZ', async () => {
        const gate = deferred()
        taskService.createBulk.mockImplementationOnce(() => gate.promise)
        const user = setupUser()
        renderTasksPage()
        await openCreateModal(user)
        await fillCreateForm(user)

        const ok = screen.getByRole('button', { name: /Create Task/ })
        await user.click(ok)
        await waitFor(() => expect(taskService.createBulk).toHaveBeenCalledTimes(1))
        await user.click(ok)
        await user.click(ok)
        expect(taskService.createBulk).toHaveBeenCalledTimes(1)
        // Cevap gelmeden modal ACIK.
        expect(
            screen.getByRole('dialog', { name: 'Create Task' })
        ).toBeInTheDocument()

        gate.resolve([{ id: 't-new' }])
        await waitFor(() =>
            expect(
                screen.queryByRole('dialog', { name: 'Create Task' })
            ).not.toBeInTheDocument()
        )
    })

    it('API hatasinda modal ACIK kalir ve form degerleri KORUNUR', async () => {
        taskService.createBulk.mockRejectedValueOnce({
            response: { data: { detail: 'Assignee not permitted.' } },
        })
        const user = setupUser()
        const { invalidateSpy } = renderTasksPage()
        await openCreateModal(user)
        invalidateSpy.mockClear()
        await fillCreateForm(user, { title: 'Korunacak baslik' })
        await user.click(screen.getByRole('button', { name: /Create Task/ }))

        expect(await screen.findByText('Assignee not permitted.')).toBeInTheDocument()
        const dialog = screen.getByRole('dialog', { name: 'Create Task' })
        expect(within(dialog).getByLabelText('Task Title'))
            .toHaveValue('Korunacak baslik')
        expect(within(dialog).getByLabelText('Description'))
            .toHaveValue('Aciklama metni')
        expect(invalidatedFamilies(invalidateSpy)).toEqual([])
    })

    it('basarida YALNIZ tasks + task-activity invalidate olur', async () => {
        const user = setupUser()
        const { invalidateSpy } = renderTasksPage()
        await openCreateModal(user)
        await fillCreateForm(user)
        invalidateSpy.mockClear()
        await user.click(screen.getByRole('button', { name: /Create Task/ }))

        await waitFor(() => expect(taskService.createBulk).toHaveBeenCalled())
        await waitFor(() =>
            expect(invalidatedFamilies(invalidateSpy))
                .toEqual(['task-activity', 'tasks'])
        )
        const families = invalidatedFamilies(invalidateSpy)
        for (const foreign of [
            'workLogs', 'periodStatus', 'customers', 'projects',
            'task-permissions', 'auth-users-lookup', 'task-sub-projects',
        ]) {
            expect(families).not.toContain(foreign)
        }
        expect(usedLegacyInvalidation(invalidateSpy)).toBe(false)
    })
})

// ─────────────────────────────────────────────────────────────────────────
describe('EDIT', () => {
    const openEdit = async (user) => {
        await screen.findByText('Gorev basligi')
        await user.click(inCard('TASK-1').getByRole('button', {
            name: 'Edit — Gorev basligi',
        }))
        return await screen.findByRole('dialog', { name: 'Edit Task' })
    }

    it('initial degerler gorevden gelir ve assignee HAM ID DEGIL AD gosterir', async () => {
        const user = setupUser()
        renderTasksPage()
        const dialog = await openEdit(user)
        expect(within(dialog).getByLabelText('Task Title'))
            .toHaveValue('Gorev basligi')
        expect(within(dialog).getByLabelText('Description'))
            .toHaveValue('Gorev aciklamasi')
        // Assignee alani okunabilir ad tasir; UUID SIZMAZ.
        expect(within(dialog).getByTitle('Ada Lovelace')).toBeInTheDocument()
        expect(dialog.textContent).not.toContain('u1')
    })

    it('degisen alanlar update payload’ina donusur', async () => {
        const user = setupUser()
        renderTasksPage()
        const dialog = await openEdit(user)
        const title = within(dialog).getByLabelText('Task Title')
        await user.clear(title)
        await user.type(title, 'Guncellenmis baslik')
        await user.click(screen.getByRole('button', { name: /Save Changes/ }))

        await waitFor(() => expect(taskService.update).toHaveBeenCalledTimes(1))
        const [taskId, payload] = taskService.update.mock.calls[0]
        expect(taskId).toBe('t1')
        expect(payload).toMatchObject({
            title: 'Guncellenmis baslik',
            description: 'Gorev aciklamasi',
            customer_id: 'c1',
            project_id: 'p1',
            assignee_user_id: 'u1',
            task_type: 'task',
        })
    })

    it('pending iken ikinci submit YENI mutation ACMAZ, modal KAPANMAZ', async () => {
        const gate = deferred()
        taskService.update.mockImplementationOnce(() => gate.promise)
        const user = setupUser()
        renderTasksPage()
        await openEdit(user)
        const save = screen.getByRole('button', { name: /Save Changes/ })
        await user.click(save)
        await waitFor(() => expect(taskService.update).toHaveBeenCalledTimes(1))
        await user.click(save)
        expect(taskService.update).toHaveBeenCalledTimes(1)
        expect(
            screen.getByRole('dialog', { name: 'Edit Task' })
        ).toBeInTheDocument()

        gate.resolve({ id: 't1' })
        await waitFor(() =>
            expect(
                screen.queryByRole('dialog', { name: 'Edit Task' })
            ).not.toBeInTheDocument()
        )
    })

    it('API hatasinda modal ACIK kalir ve degerler KORUNUR', async () => {
        taskService.update.mockRejectedValueOnce({
            response: { data: { detail: 'Not allowed.' } },
        })
        const user = setupUser()
        const { invalidateSpy } = renderTasksPage()
        const dialog = await openEdit(user)
        const title = within(dialog).getByLabelText('Task Title')
        await user.clear(title)
        await user.type(title, 'Kaybolmamali')
        invalidateSpy.mockClear()
        await user.click(screen.getByRole('button', { name: /Save Changes/ }))

        expect(await screen.findByText('Not allowed.')).toBeInTheDocument()
        expect(
            within(screen.getByRole('dialog', { name: 'Edit Task' }))
                .getByLabelText('Task Title')
        ).toHaveValue('Kaybolmamali')
        expect(invalidatedFamilies(invalidateSpy)).toEqual([])
    })

    it('basarida YALNIZ tasks + task-activity invalidate olur', async () => {
        const user = setupUser()
        const { invalidateSpy } = renderTasksPage()
        await openEdit(user)
        invalidateSpy.mockClear()
        await user.click(screen.getByRole('button', { name: /Save Changes/ }))
        await waitFor(() => expect(taskService.update).toHaveBeenCalled())
        await waitFor(() =>
            expect(invalidatedFamilies(invalidateSpy))
                .toEqual(['task-activity', 'tasks'])
        )
        expect(usedLegacyInvalidation(invalidateSpy)).toBe(false)
    })
})

// ─────────────────────────────────────────────────────────────────────────
describe('DELETE', () => {
    /** Onay modalinin kendi Delete butonu (karttaki aksiyon DEGIL). */
    const confirmDeleteButton = () => {
        const modal = Array.from(document.querySelectorAll('.ant-modal')).find(
            (m) => m.textContent.includes('Archive this work item?')
        )
        return within(modal).getByRole('button', { name: /Archive/ })
    }

    const openDelete = async (user) => {
        await screen.findByText('Gorev basligi')
        await user.click(inCard('TASK-1').getByRole('button', {
            name: 'Archive — Gorev basligi',
        }))
        await screen.findByText(/Archive this work item\?/)
        return confirmDeleteButton()
    }

    it('dogru gorev kimligiyle silinir', async () => {
        const user = setupUser()
        renderTasksPage()
        await user.click(await openDelete(user))
        await waitFor(() => expect(taskService.delete).toHaveBeenCalledTimes(1))
        expect(taskService.delete).toHaveBeenCalledWith('t1')
    })

    it('pending iken ikinci silme ENGELLENIR', async () => {
        const gate = deferred()
        taskService.delete.mockImplementationOnce(() => gate.promise)
        const user = setupUser()
        renderTasksPage()
        const btn = await openDelete(user)
        await user.click(btn)
        await waitFor(() => expect(taskService.delete).toHaveBeenCalledTimes(1))
        await user.click(btn)
        await user.click(btn)
        expect(taskService.delete).toHaveBeenCalledTimes(1)
        gate.resolve({ ok: true })
    })

    it('API hatasinda onay modali ACIK kalir', async () => {
        taskService.delete.mockRejectedValueOnce({
            response: { data: { detail: 'Delete refused.' } },
        })
        const user = setupUser()
        const { invalidateSpy } = renderTasksPage()
        const btn = await openDelete(user)
        invalidateSpy.mockClear()
        await user.click(btn)
        expect(await screen.findByText('Delete refused.')).toBeInTheDocument()
        // Modal ACIK: kullanici tekrar deneyebilir.
        expect(
            screen.getByText(/Archive this work item\?/)
        ).toBeInTheDocument()
        expect(invalidatedFamilies(invalidateSpy)).toEqual([])
    })

    it('basarida YALNIZ tasks + task-activity invalidate olur', async () => {
        const user = setupUser()
        const { invalidateSpy } = renderTasksPage()
        const btn = await openDelete(user)
        invalidateSpy.mockClear()
        await user.click(btn)
        await waitFor(() => expect(taskService.delete).toHaveBeenCalled())
        await waitFor(() =>
            expect(invalidatedFamilies(invalidateSpy))
                .toEqual(['task-activity', 'tasks'])
        )
        expect(usedLegacyInvalidation(invalidateSpy)).toBe(false)
    })
})

// ─────────────────────────────────────────────────────────────────────────
describe('etkilesim cakismalari', () => {
    it('Edit tiklamasi kartin ANA tiklamasini (detay paneli) TETIKLEMEZ', async () => {
        const user = setupUser()
        renderTasksPage()
        await screen.findByText('Gorev basligi')
        await user.click(inCard('TASK-1').getByRole('button', {
            name: 'Edit — Gorev basligi',
        }))
        await screen.findByRole('dialog', { name: 'Edit Task' })
        expect(document.querySelector('.task-detail-panel')).toBeNull()
    })

    it('Delete tiklamasi kartin ANA tiklamasini TETIKLEMEZ', async () => {
        const user = setupUser()
        renderTasksPage()
        await screen.findByText('Gorev basligi')
        await user.click(inCard('TASK-1').getByRole('button', {
            name: 'Archive — Gorev basligi',
        }))
        await screen.findByText(/Archive this work item\?/)
        expect(document.querySelector('.task-detail-panel')).toBeNull()
        expect(taskService.delete).not.toHaveBeenCalled()
    })

    it('kart GOVDESINE tiklamak detay panelini acar (Log Time DEGIL)', async () => {
        const user = setupUser()
        renderTasksPage()
        await screen.findByText('Gorev basligi')
        await user.click(taskCard('TASK-1'))
        await waitFor(() =>
            expect(document.querySelector('.task-detail-panel')).toBeTruthy()
        )
        expect(document.querySelector('.log-time-modal')).toBeNull()
    })

    it('PENDING gorev dogrudan tamamlanmaz — once KABUL edilir', async () => {
        const user = setupUser()
        renderTasksPage()
        await screen.findByText('Yabanci gorev')
        await user.click(inCard('TASK-2').getByRole('checkbox'))
        await user.click(await screen.findByRole('button', { name: /Accept Task/ }))
        await waitFor(() =>
            expect(taskService.updateStatus)
                .toHaveBeenCalledWith('t2', 'in_progress')
        )
        expect(taskService.setCompleted).not.toHaveBeenCalled()
        expect(document.querySelector('.log-time-modal')).toBeNull()
    })
})

describe('izin gorunurlugu', () => {
    it('atayan olmayan kullanici Edit/Delete AKSIYONLARINI GORMEZ', async () => {
        const user = setupUser()
        renderTasksPage()
        await screen.findByText('Yabanci gorev')
        // TASK-2'nin atayani u2 → Ada duzenleyemez.
        expect(
            inCard('TASK-2').queryByRole('button', { name: /^Edit — / })
        ).toBeNull()
        expect(
            inCard('TASK-2').queryByRole('button', { name: /^Archive — / })
        ).toBeNull()
        // Kendi atadigi gorevde ise gorunur.
        expect(
            inCard('TASK-1').getByRole('button', { name: 'Edit — Gorev basligi' })
        ).toBeInTheDocument()
        expect(user).toBeTruthy()
    })

    it('atama yetkisi olmayan kullanici "Assigned by Me" ve Create GOREMEZ', async () => {
        resetTasksApi({ tasks: [FOREIGN], perms: PERMS_NO_ASSIGN })
        const user = setupUser()
        renderTasksPage()
        await screen.findByText('Yabanci gorev')
        expect(
            screen.queryByRole('tab', { name: 'Assigned by Me' })
        ).toBeNull()
        expect(
            screen.queryByRole('button', { name: 'New work item' })
        ).toBeNull()
        expect(user).toBeTruthy()
    })

    it('admin her gorevde Edit/Delete gorur (izin katmani TEK kaynak)', async () => {
        resetTasksApi({ tasks: [FOREIGN], perms: PERMS_ADMIN })
        const user = setupUser()
        renderTasksPage()
        await screen.findByText('Yabanci gorev')
        expect(
            inCard('TASK-2').getByRole('button', { name: /^Edit — / })
        ).toBeInTheDocument()
        expect(user).toBeTruthy()
    })
})
