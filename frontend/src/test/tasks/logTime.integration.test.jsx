/**
 * =============================================================================
 * Sprint 5C — KAPI 1: Completed task → Log Time ENTEGRASYONU
 * =============================================================================
 * Saf helper testi DEGIL: gercek TasksPage mount edilir ve zincirin TAMAMI
 * kullanici etkilesiminden baslar —
 *
 *   etkilesim → modal → prefill → payload → mutation → invalidation →
 *   focus donusu
 *
 * Kilitlenen sozlesme (CTO Sprint 5C §3):
 *  1. Completed gorev ana etkilesimle Log Time'i acar.
 *  2. Customer/Project prefill edilir; SUB-PROJECT AKTARILMAZ (mevcut
 *     urun kurali — Time Entry'nin kendi work-line/platform taksonomisi
 *     vardir).
 *  3. Description = "<Tur>: <baslik>\n\n<aciklama>" birlesimi.
 *  4. Ayni anda TEK mutation; pending'te ikinci submit ENGELLENIR.
 *  5. API basarili DONMEDEN modal KAPANMAZ.
 *  6. Basaridan sonra work-log + period-status + task-activity aileleri
 *     invalidate edilir; ILGISIZ aileler (tasks/customers/projects)
 *     EDILMEZ.
 *  7. API hatasinda modal ACIK kalir ve girilen degerler KORUNUR.
 *  8. Kapanista focus akisi baslatan tetikleyiciye doner.
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'

vi.mock('../../services/api', async () => await import('./apiMock'))
import {
    mkTask, mockState, resetTasksApi, taskService, workLogService,
} from './apiMock'
import {
    inCard, invalidatedFamilies, logTimeDialog, renderTasksPage, setupUser,
    usedLegacyInvalidation,
} from './harness'
import { resetAuthStore } from '../utils'

// Ada (u1) atanan; Grace (u2) atayan. My Tasks kapsaminda Ada durum
// degistirebilir → checkbox aktif, Log Time akisi acilir.
const DONE = mkTask({
    id: 't-done',
    task_code: 'TASK-9',
    title: 'Bitmis gorev',
    description: 'Aylik rapor hazirlandi',
    status: 'completed',
    sub_project_id: 'sp1',
    sub_project_name: 'Faz 1',
    scheduled_date: '2026-07-27',
})
const RUNNING = mkTask({
    id: 't-run',
    task_code: 'TASK-8',
    title: 'Devam eden gorev',
    description: 'Sprint calismasi',
    status: 'in_progress',
})

/** Deferred promise — pending durumunu deterministik tutar. */
const deferred = () => {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

/** AntD Select'i gercek kullanici gibi doldurur. */
const pickOption = async (user, labelText, optionTitle) => {
    await user.click(screen.getByLabelText(labelText))
    await user.click(await screen.findByTitle(optionTitle))
}

/** Log Time formunu gecerli hale getirir (sure + zorunlu taksonomi). */
const fillLogTimeForm = async (user, { hours = '2' } = {}) => {
    const dialog = screen.getByRole('dialog', { name: 'Log time' })
    const hoursInput = within(dialog).getByLabelText('Hours')
    await user.clear(hoursInput)
    await user.type(hoursInput, hours)
    await pickOption(user, 'Work Type', 'Development')
    await pickOption(user, 'Activity Type', 'Coding')
    await pickOption(user, 'Platform', 'Backend')
}

const openLogTimeFromCompletedCard = async (user) => {
    const trigger = await screen.findByRole('button', {
        name: 'Log time — Bitmis gorev',
    })
    await user.click(trigger)
    await screen.findByRole('dialog', { name: 'Log time' })
    return trigger
}

beforeEach(() => {
    resetAuthStore()
    resetTasksApi({ tasks: [DONE, RUNNING] })
})

describe('completed gorev → Log Time acilisi', () => {
    it('completed kartin ana Log Time aksiyonu modali acar', async () => {
        const user = setupUser()
        renderTasksPage()
        await openLogTimeFromCompletedCard(user)
        expect(
            screen.getByRole('dialog', { name: 'Log time' })
        ).toBeInTheDocument()
    })

    it('in_progress gorev tamamlaninca Log Time OTOMATIK acilir', async () => {
        const user = setupUser()
        renderTasksPage()
        await screen.findByText('Devam eden gorev')
        // Kart checkbox'i → onay modali → tamamla → Log Time
        await user.click(inCard('TASK-8').getByRole('checkbox'))
        await user.click(
            // NOT: AntD ikonlari role="img" + aria-label ile render
            // olur, bu yuzden butonun erisilebilir adi ikon adini da
            // icerir ("check-circle Mark as Completed") — etiket yine
            // adin PARCASIDIR.
            await screen.findByRole('button', { name: /Mark as Completed/ })
        )
        await waitFor(() =>
            expect(taskService.setCompleted).toHaveBeenCalledWith('t-run', true)
        )
        // Tamamlama → invalidate → refetch zinciri jsdom'da yavas;
        // waitFor varsayilani (1 sn) davranisi degil, agirligi olcerdi.
        // Diyalog SINIFLA aranir: onay modali kapanma animasyonundayken
        // iki modal ust uste durur ve jsdom'da ariaId'ler cakisir
        // (bkz. harness.logTimeDialog).
        await waitFor(() => expect(logTimeDialog()).toBeTruthy(), {
            timeout: 8000,
        })
        expect(
            within(logTimeDialog()).getByLabelText('Description')
        ).toHaveValue('Task: Devam eden gorev\n\nSprint calismasi')
    })

    it('completed gorevi yeniden acmak Log Time ACMAZ', async () => {
        const user = setupUser()
        renderTasksPage()
        await screen.findByText('Bitmis gorev')
        await user.click(inCard('TASK-9').getByRole('checkbox'))
        await user.click(await screen.findByRole('button', { name: /Reopen/ }))
        await waitFor(() =>
            expect(taskService.setCompleted).toHaveBeenCalledWith('t-done', false)
        )
        expect(
            screen.queryByRole('dialog', { name: 'Log time' })
        ).not.toBeInTheDocument()
    })
})

describe('prefill sozlesmesi', () => {
    it('customer ve project gorev kaydindan gelir', async () => {
        const user = setupUser()
        renderTasksPage()
        await openLogTimeFromCompletedCard(user)
        const dialog = screen.getByRole('dialog', { name: 'Log time' })
        // Adim 2 basligi secili proje + musteri kodunu gosterir.
        expect(within(dialog).getByText('ATM Yenileme')).toBeInTheDocument()
        expect(within(dialog).getByText('VAK')).toBeInTheDocument()
    })

    it('SUB-PROJECT aktarilmaz (mevcut urun kurali)', async () => {
        const user = setupUser()
        renderTasksPage()
        await openLogTimeFromCompletedCard(user)
        const dialog = screen.getByRole('dialog', { name: 'Log time' })
        expect(within(dialog).queryByText(/Faz 1/)).not.toBeInTheDocument()
        expect(within(dialog).queryByText(/Sub Project/i)).not.toBeInTheDocument()
    })

    it('description = "<Tur>: <baslik>" + bos satir + aciklama', async () => {
        const user = setupUser()
        renderTasksPage()
        await openLogTimeFromCompletedCard(user)
        expect(screen.getByLabelText('Description')).toHaveValue(
            'Task: Bitmis gorev\n\nAylik rapor hazirlandi'
        )
    })

    it('aciklamasi olmayan gorevde yalniz "<Tur>: <baslik>" kalir', async () => {
        resetTasksApi({
            tasks: [{ ...DONE, description: '' }],
        })
        const user = setupUser()
        renderTasksPage()
        await openLogTimeFromCompletedCard(user)
        expect(screen.getByLabelText('Description')).toHaveValue(
            'Task: Bitmis gorev'
        )
    })

    it('tarih gorevin scheduled_date degeridir', async () => {
        const user = setupUser()
        renderTasksPage()
        await openLogTimeFromCompletedCard(user)
        await fillLogTimeForm(user)
        await user.click(screen.getByRole('button', { name: 'Log time' }))
        await waitFor(() => expect(workLogService.create).toHaveBeenCalled())
        expect(workLogService.create.mock.calls[0][0].date_worked)
            .toBe('2026-07-27')
    })
})

describe('gonderim: payload, tek mutation, invalidation', () => {
    it('payload gorev baglamini tasir ve sub_project TASIMAZ', async () => {
        const user = setupUser()
        renderTasksPage()
        await openLogTimeFromCompletedCard(user)
        await fillLogTimeForm(user, { hours: '3' })
        await user.click(screen.getByRole('button', { name: 'Log time' }))

        await waitFor(() => expect(workLogService.create).toHaveBeenCalledTimes(1))
        const [payload, targetUserId] = workLogService.create.mock.calls[0]
        expect(payload).toMatchObject({
            customer_id: 'c1',
            project_id: 'p1',
            work_type_id: 'w1',
            activity_type_id: 'a1',
            platform_id: 'pf1',
            date_worked: '2026-07-27',
            duration_hours: 3,
            description: 'Task: Bitmis gorev\n\nAylik rapor hazirlandi',
            task_id: 't-done',
        })
        expect(payload).not.toHaveProperty('sub_project_id')
        // Kayit gorevin ATANANINA yazilir (isi onun isiydi), sayfanin
        // admin "view-as" secimine DEGIL.
        expect(targetUserId).toBe('u1')
    })

    it('pending sirasinda ikinci submit YENI mutation ACMAZ', async () => {
        const gate = deferred()
        workLogService.create.mockImplementationOnce(() => gate.promise)
        const user = setupUser()
        renderTasksPage()
        await openLogTimeFromCompletedCard(user)
        await fillLogTimeForm(user)

        const submit = screen.getByRole('button', { name: 'Log time' })
        await user.click(submit)
        await waitFor(() => expect(workLogService.create).toHaveBeenCalledTimes(1))
        // Pending: buton loading → tiklama etkisiz.
        await user.click(submit)
        await user.click(submit)
        expect(workLogService.create).toHaveBeenCalledTimes(1)

        gate.resolve({ id: 'wl-1' })
        await waitFor(() =>
            expect(
                screen.queryByRole('dialog', { name: 'Log time' })
            ).not.toBeInTheDocument()
        )
    })

    it('API cevabi GELMEDEN modal KAPANMAZ', async () => {
        const gate = deferred()
        workLogService.create.mockImplementationOnce(() => gate.promise)
        const user = setupUser()
        renderTasksPage()
        await openLogTimeFromCompletedCard(user)
        await fillLogTimeForm(user)
        await user.click(screen.getByRole('button', { name: 'Log time' }))

        await waitFor(() => expect(workLogService.create).toHaveBeenCalled())
        expect(
            screen.getByRole('dialog', { name: 'Log time' })
        ).toBeInTheDocument()

        gate.resolve({ id: 'wl-1' })
        await waitFor(() =>
            expect(
                screen.queryByRole('dialog', { name: 'Log time' })
            ).not.toBeInTheDocument()
        )
    })

    it('basaridan sonra YALNIZ work-log/period-status/task-activity invalidate olur', async () => {
        const user = setupUser()
        const { invalidateSpy } = renderTasksPage()
        await openLogTimeFromCompletedCard(user)
        // Acilis sirasindaki (varsa) cagrilari disarida birak: yalniz
        // gonderimden SONRAKI aileleri olcuyoruz.
        invalidateSpy.mockClear()
        await fillLogTimeForm(user)
        await user.click(screen.getByRole('button', { name: 'Log time' }))
        await waitFor(() => expect(workLogService.create).toHaveBeenCalled())

        await waitFor(() =>
            expect(invalidatedFamilies(invalidateSpy)).toEqual([
                'periodStatus', 'task-activity', 'workLogs',
            ])
        )
        const families = invalidatedFamilies(invalidateSpy)
        // Log Time gorev listesini DEGISTIRMEZ → tasks ailesi ve
        // referans veri aileleri BOSUNA invalidate EDILMEZ.
        expect(families).not.toContain('tasks')
        expect(families).not.toContain('customers')
        expect(families).not.toContain('projects')
        expect(families).not.toContain('task-permissions')
        expect(families).not.toContain('auth-users-lookup')
        // v5 object syntax disi cagri = tum cache'i invalid eden eski bug.
        expect(usedLegacyInvalidation(invalidateSpy)).toBe(false)
    })
})

describe('hata yolu', () => {
    it('API hatasinda modal ACIK kalir ve girilen degerler KORUNUR', async () => {
        workLogService.create.mockRejectedValueOnce({
            response: { data: { detail: 'Period is locked.' } },
        })
        const user = setupUser()
        const { invalidateSpy } = renderTasksPage()
        await openLogTimeFromCompletedCard(user)
        invalidateSpy.mockClear()
        await fillLogTimeForm(user, { hours: '4' })
        const dialog = screen.getByRole('dialog', { name: 'Log time' })
        await user.clear(within(dialog).getByLabelText('Description'))
        await user.type(
            within(dialog).getByLabelText('Description'),
            'Elle yazilmis aciklama'
        )
        await user.click(screen.getByRole('button', { name: 'Log time' }))

        await waitFor(() => expect(workLogService.create).toHaveBeenCalled())
        // Sunucu mesaji kullaniciya gosterilir.
        expect(await screen.findByText('Period is locked.')).toBeInTheDocument()
        // Modal ACIK ve TUM degerler yerinde.
        const stillOpen = screen.getByRole('dialog', { name: 'Log time' })
        expect(stillOpen).toBeInTheDocument()
        expect(within(stillOpen).getByLabelText('Hours')).toHaveValue('4')
        expect(within(stillOpen).getByLabelText('Description')).toHaveValue(
            'Elle yazilmis aciklama'
        )
        // Hatali gonderim hicbir cache ailesini tazelemez.
        expect(invalidatedFamilies(invalidateSpy)).toEqual([])
    })

    it('hatadan sonra tekrar deneme AYNI modalda calisir', async () => {
        workLogService.create.mockRejectedValueOnce({
            response: { data: { detail: 'Gecici hata' } },
        })
        const user = setupUser()
        renderTasksPage()
        await openLogTimeFromCompletedCard(user)
        await fillLogTimeForm(user)
        await user.click(screen.getByRole('button', { name: 'Log time' }))
        await waitFor(() => expect(workLogService.create).toHaveBeenCalledTimes(1))

        await user.click(screen.getByRole('button', { name: 'Log time' }))
        await waitFor(() => expect(workLogService.create).toHaveBeenCalledTimes(2))
        await waitFor(() =>
            expect(
                screen.queryByRole('dialog', { name: 'Log time' })
            ).not.toBeInTheDocument()
        )
    })
})

describe('focus donusu', () => {
    it('modal kapaninca focus akisi acan aksiyona doner', async () => {
        const user = setupUser()
        renderTasksPage()
        const trigger = await openLogTimeFromCompletedCard(user)
        await fillLogTimeForm(user)
        await user.click(screen.getByRole('button', { name: 'Log time' }))
        await waitFor(() =>
            expect(
                screen.queryByRole('dialog', { name: 'Log time' })
            ).not.toBeInTheDocument()
        )
        await waitFor(() => expect(document.activeElement).toBe(trigger))
    })

    it('Cancel ile kapanista da focus tetikleyiciye doner', async () => {
        const user = setupUser()
        renderTasksPage()
        const trigger = await openLogTimeFromCompletedCard(user)
        await user.click(screen.getByRole('button', { name: 'Cancel' }))
        await waitFor(() =>
            expect(
                screen.queryByRole('dialog', { name: 'Log time' })
            ).not.toBeInTheDocument()
        )
        await waitFor(() => expect(document.activeElement).toBe(trigger))
        expect(workLogService.create).not.toHaveBeenCalled()
        expect(mockState.tasks).toHaveLength(2)
    })
})
