/**
 * =============================================================================
 * Sprint 5C+ — Board SURUKLE-BIRAK YASAM DONGUSU
 * =============================================================================
 * Yeni bir DnD sistemi URETILMEDI: mevcut @dnd-kit tabanli
 * `allowStatusDrag` sozlesmesi kaynak koddan cikarilip kilitlendi.
 *
 * KAYNAKTAN CIKARILAN SOZLESME:
 *   Bir kart SURUKLENEBILIR ⇔ allowStatusDrag (yalnizca "My Tasks"
 *   kapsami) VE kullanici o gorevin durumunu degistirebilir (admin VEYA
 *   atanan VEYA atayan). Ikisi de model/permissions.canDragTaskStatus'ta.
 *   Birakma yalnizca DORT gecerli status kolonuna yapilir ve status
 *   GERCEKTEN degisiyorsa mutation acilir. Atama surukleyerek
 *   DEGISTIRILEMEZ. 'completed' kolonuna birakmak Log Time davetini acar.
 *
 * Bu dosya gercek TasksPage'i mount eder ve gercek dnd-kit sensor →
 * aktivasyon kisiti → closestCorners → handleDragEnd → mutation
 * zincirini surer. jsdom'un vermedigi iki sey (PointerEvent sinifi ve
 * eleman geometrisi) harness'te ORTAM duzeyinde saglanir; urun kodu
 * degismez. Gercek pointer fizigi ayrica Chromium'da olculur.
 * =============================================================================
 */
import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'

vi.mock('../../services/api', async () => await import('./apiMock'))
import { PERMS_ADMIN, mkTask, resetTasksApi, taskService } from './apiMock'
import {
    columnOf, consumeDragClickSuppressor, dragCardTo, draggableFor,
    installBoardGeometry, inCard, invalidatedFamilies, renderTasksPage, taskCard,
    restoreBoardGeometry, setupUser, usedLegacyInvalidation,
} from './harness'
import { resetAuthStore } from '../utils'

// Ada (u1) = atanan. Kendi "My Tasks" gorunumunde surukleyebilir.
const MINE = mkTask({
    id: 't1', task_code: 'TASK-1', title: 'Surukletilecek gorev',
    status: 'pending', assignee_user_id: 'u1', assigner_user_id: 'u2',
})
// Ne atanan ne atayan → Ada bu gorevin durumunu DEGISTIREMEZ.
const FOREIGN = mkTask({
    id: 't2', task_code: 'TASK-2', title: 'Yabanci gorev',
    status: 'pending', assignee_user_id: 'u3', assigner_user_id: 'u2',
})

const deferred = () => {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

const onBoard = async (code = 'TASK-1') => {
    await screen.findByText(
        code === 'TASK-1' ? 'Surukletilecek gorev' : 'Yabanci gorev'
    )
}

beforeEach(() => {
    resetAuthStore()
    resetTasksApi({ tasks: [MINE] })
    installBoardGeometry()
})
afterEach(async () => {
    // Reddedilen/gec cozulen mutation'larin React guncellemeleri test
    // BITMEDEN insin: aksi halde bir sonraki testin act kuyruguna
    // dusup "Should not already be working" zinciri baslatiyorlar.
    await new Promise((r) => setTimeout(r, 40))
    restoreBoardGeometry()
})

// ─────────────────────────────────────────────────────────────────────────
describe('BASARILI surukleme', () => {
    it('kart hedef kolona tasinir, TEK mutation acilir, payload API sozlesmesiyle eslesir', async () => {
        renderTasksPage()
        await onBoard()
        expect(columnOf('TASK-1')).toBe('pending')

        await dragCardTo('TASK-1', 'in_progress')

        await waitFor(() =>
            expect(taskService.updateStatus).toHaveBeenCalledTimes(1)
        )
        // Payload: (taskId, hedefStatus) — updateStatus sozlesmesi.
        expect(taskService.updateStatus).toHaveBeenCalledWith('t1', 'in_progress')
        // Reconcile sonrasi kart hedef kolonda KALIR.
        await waitFor(() => expect(columnOf('TASK-1')).toBe('in_progress'))
    })

    it('OPTIMISTIC gorunum kart daha sunucudan donmeden hedef kolonu gosterir', async () => {
        const gate = deferred()
        taskService.updateStatus.mockImplementationOnce(() => gate.promise)
        renderTasksPage()
        await onBoard()

        await dragCardTo('TASK-1', 'completed')
        await waitFor(() => expect(taskService.updateStatus).toHaveBeenCalled())
        // Cevap HENUZ gelmedi ama kart hedef kolonda.
        await waitFor(() => expect(columnOf('TASK-1')).toBe('completed'))
        // Ve tek bir yerde duruyor.
        expect(document.querySelectorAll('.task-card').length).toBe(1)

        gate.resolve({ id: 't1', status: 'completed' })
    })

    it('basari sonrasi YALNIZ tasks + task-activity reconcile edilir', async () => {
        const { invalidateSpy } = renderTasksPage()
        await onBoard()
        invalidateSpy.mockClear()

        await dragCardTo('TASK-1', 'in_progress')
        await waitFor(() => expect(taskService.updateStatus).toHaveBeenCalled())
        await waitFor(() =>
            expect(invalidatedFamilies(invalidateSpy))
                .toEqual(['task-activity', 'tasks'])
        )
        for (const foreign of [
            'workLogs', 'periodStatus', 'customers', 'projects',
            'task-permissions', 'auth-users-lookup', 'task-sub-projects',
        ]) {
            expect(invalidatedFamilies(invalidateSpy)).not.toContain(foreign)
        }
        expect(usedLegacyInvalidation(invalidateSpy)).toBe(false)
    })

    it('yeni status LIST gorunumunde de AYNIDIR', async () => {
        const user = setupUser()
        renderTasksPage()
        await onBoard()
        await dragCardTo('TASK-1', 'in_progress')
        await waitFor(() => expect(taskService.updateStatus).toHaveBeenCalled())

        // Sunucu artik guncel kaydi doner → refetch sonrasi tutarlilik.
        await waitFor(() => expect(columnOf('TASK-1')).toBe('in_progress'))
        await consumeDragClickSuppressor(user)
        await user.click(await screen.findByText('List'))
        await waitFor(
            () =>
                expect(
                    document.querySelectorAll('.ant-table-tbody tr[data-row-key]')
                        .length
                ).toBe(1),
            { timeout: 5000 }
        )
        const row = document.querySelector('.ant-table-tbody tr[data-row-key]')
        expect(row.textContent).toContain('in progress')
    })

    it('AYNI kolona birakmak mutation ACMAZ', async () => {
        renderTasksPage()
        await onBoard()
        await dragCardTo('TASK-1', 'pending')
        await new Promise((r) => setTimeout(r, 150))
        expect(taskService.updateStatus).not.toHaveBeenCalled()
        expect(columnOf('TASK-1')).toBe('pending')
    })

    it("'completed' kolonuna birakmak Log Time davetini acar", async () => {
        renderTasksPage()
        await onBoard()
        await dragCardTo('TASK-1', 'completed')
        await waitFor(() =>
            expect(taskService.updateStatus)
                .toHaveBeenCalledWith('t1', 'completed')
        )
        await waitFor(() =>
            expect(document.querySelector('.log-time-modal')).toBeTruthy()
        )
    })
})

// ─────────────────────────────────────────────────────────────────────────
describe('KLAVYE ile acma (dnd sensoru yaninda)', () => {
    it('baslik butonunda Enter, panel ACAR — dnd KeyboardSensor yutmaz', async () => {
        /*
         * GERCEK REGRESYON (Sprint 7 final tarayici QA'sinin bulgusu):
         * board'da kart, dnd-kit sarmalayicisinin icindedir ve
         * KeyboardSensor Enter/Space keydown'unu suruklemeyi baslatmak
         * icin yakalayip preventDefault yapar — native butonun click'i
         * iptal olur ve acma yutulurdu. Baslik butonu artik Enter/Space
         * keydown'unu sarmalayiciya CIKARMAZ; klavye sürüklemesi
         * sarmalayicinin KENDI odagindan calismaya devam eder.
         */
        const user = setupUser()
        renderTasksPage()
        await onBoard()

        const opener = taskCard('TASK-1').querySelector('.task-card-open')
        opener.focus()
        await user.keyboard('{Enter}')

        // Detay paneli (TaskDetailPanel) acilir; surukleme BASLAMAZ.
        await waitFor(() => {
            expect(document.querySelector('.task-detail-panel, .tdp-tab-body'))
                .not.toBeNull()
        })
        expect(document.querySelector('.tasks-board-drag-overlay')).toBeNull()
        expect(taskService.updateStatus).not.toHaveBeenCalled()
    })
})

describe('API HATASI → rollback', () => {
    it('kart ONCEKI kolonuna doner, kaybolmaz, iki kolonda birden gorunmez', async () => {
        const gate = deferred()
        taskService.updateStatus.mockImplementationOnce(() => gate.promise)
        renderTasksPage()
        await onBoard()

        await dragCardTo('TASK-1', 'completed')
        // Once optimistic degisim GORUNUR.
        await waitFor(() => expect(columnOf('TASK-1')).toBe('completed'))

        gate.reject({ response: { data: { detail: 'Status change refused.' } } })

        // Sonra tam olarak eski kolonuna doner.
        await waitFor(() => expect(columnOf('TASK-1')).toBe('pending'))
        // Tek kart, tek kolon — cift gorunum veya kayip yok.
        expect(document.querySelectorAll('.task-card').length).toBe(1)
        expect(screen.getByText('Surukletilecek gorev')).toBeInTheDocument()
    })

    it('kullaniciya tasarim sistemine uygun hata bildirimi gosterilir', async () => {
        taskService.updateStatus.mockRejectedValueOnce({
            response: { data: { detail: 'Status change refused.' } },
        })
        renderTasksPage()
        await onBoard()
        await dragCardTo('TASK-1', 'in_progress')

        const toasts = await screen.findAllByText('Status change refused.')
        expect(toasts.length).toBeGreaterThan(0)
        // AntD message katmani — Time Entry/Tasks ile ayni bildirim yuzeyi.
        expect(toasts[0].closest('.ant-message-notice')).toBeTruthy()
    })

    it('rollback sonrasi Board ve List AYNI statusu gosterir', async () => {
        taskService.updateStatus.mockRejectedValueOnce({
            response: { data: { detail: 'Nope.' } },
        })
        const user = setupUser()
        renderTasksPage()
        await onBoard()
        await dragCardTo('TASK-1', 'completed')
        await waitFor(() => expect(columnOf('TASK-1')).toBe('pending'))

        await consumeDragClickSuppressor(user)
        await user.click(await screen.findByText('List'))
        await waitFor(
            () =>
                expect(
                    document.querySelectorAll('.ant-table-tbody tr[data-row-key]')
                        .length
                ).toBe(1),
            { timeout: 5000 }
        )
        expect(
            document.querySelector('.ant-table-tbody tr[data-row-key]').textContent
        ).toContain('pending')
    })

    it('hata yolu GEREKSIZ query invalidation uretmez', async () => {
        taskService.updateStatus.mockRejectedValueOnce({
            response: { data: { detail: 'Nope.' } },
        })
        const { invalidateSpy } = renderTasksPage()
        await onBoard()
        invalidateSpy.mockClear()

        await dragCardTo('TASK-1', 'in_progress')
        await waitFor(() => expect(columnOf('TASK-1')).toBe('pending'))
        // onSettled yalnizca gorev ailelerini tazeler — Time Entry ve
        // referans aileleri hata yolunda da EL DEGMEDEN kalir.
        await waitFor(() =>
            expect(invalidatedFamilies(invalidateSpy))
                .toEqual(['task-activity', 'tasks'])
        )
        for (const foreign of ['workLogs', 'periodStatus', 'customers', 'projects']) {
            expect(invalidatedFamilies(invalidateSpy)).not.toContain(foreign)
        }
    })

    it('hata yolunda unhandled rejection SIZMAZ', async () => {
        const unhandled = []
        const onUnhandled = (e) => { unhandled.push(e); e.preventDefault?.() }
        process.on('unhandledRejection', onUnhandled)
        taskService.updateStatus.mockRejectedValueOnce({
            response: { data: { detail: 'Nope.' } },
        })
        renderTasksPage()
        await onBoard()
        await dragCardTo('TASK-1', 'in_progress')
        await waitFor(() => expect(columnOf('TASK-1')).toBe('pending'))
        await new Promise((r) => setTimeout(r, 120))
        process.off('unhandledRejection', onUnhandled)
        expect(unhandled).toEqual([])
    })
})

// ─────────────────────────────────────────────────────────────────────────
describe('YETKISIZ surukleme', () => {
    it('allowStatusDrag=false ("Assigned by Me") → kart suruklenemez, mutation yok', async () => {
        renderTasksPage()
        await onBoard()
        fireEvent.click(await screen.findByRole('tab', { name: 'Assigned by Me' }))
        await waitFor(() => expect(document.querySelector('.task-card')).toBeTruthy())

        const node = draggableFor('TASK-1')
        // dnd-kit disabled iken listener/attribute BAGLAMAZ.
        expect(node.getAttribute('role')).toBeNull()
        expect(node.className).toContain('is-locked')

        await dragCardTo('TASK-1', 'in_progress')
        await new Promise((r) => setTimeout(r, 150))
        expect(taskService.updateStatus).not.toHaveBeenCalled()
        expect(columnOf('TASK-1')).toBe('pending')
    })

    it('atanan/atayan OLMAYAN kullanici surukleyemez, mutation yok', async () => {
        resetTasksApi({ tasks: [FOREIGN] })
        renderTasksPage()
        await onBoard('TASK-2')

        const node = draggableFor('TASK-2')
        expect(node.getAttribute('role')).toBeNull()
        expect(node.className).toContain('is-locked')

        await dragCardTo('TASK-2', 'completed')
        await new Promise((r) => setTimeout(r, 150))
        expect(taskService.updateStatus).not.toHaveBeenCalled()
        expect(columnOf('TASK-2')).toBe('pending')
        // Optimistic state de degismedi.
        expect(document.querySelectorAll('.task-card').length).toBe(1)
    })

    it('ADMIN yabanci gorevi surukleyebilir (kural admin’i kapsar)', async () => {
        resetTasksApi({ tasks: [FOREIGN], perms: PERMS_ADMIN })
        renderTasksPage()
        await onBoard('TASK-2')

        expect(draggableFor('TASK-2').getAttribute('role')).toBe('button')
        await dragCardTo('TASK-2', 'in_progress')
        await waitFor(() =>
            expect(taskService.updateStatus)
                .toHaveBeenCalledWith('t2', 'in_progress')
        )
    })

    it('yetkisiz kartin checkbox’i da kilitli (ayni kural, ayni kaynak)', async () => {
        resetTasksApi({ tasks: [FOREIGN] })
        renderTasksPage()
        await onBoard('TASK-2')
        expect(inCard('TASK-2').getByRole('checkbox')).toBeDisabled()
    })
})

// ─────────────────────────────────────────────────────────────────────────
describe('PENDING sirasinda tekrarli surukleme', () => {
    it('ilk mutation ucarken ikinci surukleme YENI istek ACMAZ', async () => {
        const gate = deferred()
        taskService.updateStatus.mockImplementationOnce(() => gate.promise)
        renderTasksPage()
        await onBoard()

        await dragCardTo('TASK-1', 'in_progress')
        await waitFor(() =>
            expect(taskService.updateStatus).toHaveBeenCalledTimes(1)
        )
        expect(columnOf('TASK-1')).toBe('in_progress')

        // Pending devam ederken iki kez daha surukle.
        await dragCardTo('TASK-1', 'completed')
        await dragCardTo('TASK-1', 'rejected')
        await new Promise((r) => setTimeout(r, 150))

        expect(taskService.updateStatus).toHaveBeenCalledTimes(1)
        // Celisen ikinci bir optimistic status UYGULANMADI.
        expect(columnOf('TASK-1')).toBe('in_progress')

        gate.resolve({ id: 't1', status: 'in_progress' })
        await waitFor(() => expect(columnOf('TASK-1')).toBe('in_progress'))
    })

    it('art arda HIZLI surukleme TEK istek uretir', async () => {
        const gate = deferred()
        taskService.updateStatus.mockImplementationOnce(() => gate.promise)
        renderTasksPage()
        await onBoard()

        // Kullanici kartlari birbiri ardina cekistiriyor; ilk istek
        // hala ucuyor. (Pointer olaylari tarayicida da SIRALIDIR —
        // es zamanli degil, art ardadir.)
        await dragCardTo('TASK-1', 'in_progress')
        await dragCardTo('TASK-1', 'completed')
        await dragCardTo('TASK-1', 'rejected')
        await new Promise((r) => setTimeout(r, 150))

        expect(taskService.updateStatus).toHaveBeenCalledTimes(1)
        expect(taskService.updateStatus).toHaveBeenCalledWith('t1', 'in_progress')

        gate.resolve({ id: 't1', status: 'in_progress' })
    })

    it('ilk mutation BASARIYLA biterse sonuc dogru kalir', async () => {
        const gate = deferred()
        taskService.updateStatus.mockImplementationOnce(() => gate.promise)
        renderTasksPage()
        await onBoard()

        await dragCardTo('TASK-1', 'completed')
        await waitFor(() => expect(taskService.updateStatus).toHaveBeenCalled())
        await dragCardTo('TASK-1', 'rejected')

        gate.resolve({ id: 't1', status: 'completed' })
        await waitFor(() => expect(columnOf('TASK-1')).toBe('completed'))
        expect(taskService.updateStatus).toHaveBeenCalledTimes(1)
    })

    it('ilk mutation HATA verirse ILK kaynak statusuna eksiksiz rollback', async () => {
        const gate = deferred()
        taskService.updateStatus.mockImplementationOnce(() => gate.promise)
        renderTasksPage()
        await onBoard()
        expect(columnOf('TASK-1')).toBe('pending')

        await dragCardTo('TASK-1', 'completed')
        await waitFor(() => expect(columnOf('TASK-1')).toBe('completed'))
        await dragCardTo('TASK-1', 'rejected')

        gate.reject({ response: { data: { detail: 'Refused.' } } })

        await waitFor(() => expect(columnOf('TASK-1')).toBe('pending'))
        expect(taskService.updateStatus).toHaveBeenCalledTimes(1)
        expect(document.querySelectorAll('.task-card').length).toBe(1)
    })
})
