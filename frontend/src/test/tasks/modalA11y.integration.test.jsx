/**
 * =============================================================================
 * Sprint 5C — KAPI 4: Modal focus / klavye erisilebilirligi (jsdom katmani)
 * =============================================================================
 * Bu dosya JSDOM'un GUVENILIR bicimde kanitlayabildiklerini kilitler:
 * erisilebilir diyalog adi, acilista makul ilk focus, Escape ile kapanma,
 * pending'te kapanma kilidi, pending'te submit dugmesinin durumu,
 * kapanista focus'un GERCEK tetikleyiciye donmesi, ikon dugmelerinin
 * erisilebilir adi, modal govdesinde ic ice interaktif eleman
 * bulunmamasi ve Tasks yuzeyinde GLOBAL kisayol OLMAMASI.
 *
 * JSDOM'un kanitlayamadiklari — Tab/Shift+Tab focus TUZAGI ve arka plan
 * icerigin gercekten tiklanamiyor olmasi — tarayici motoru gerektirir ve
 * `scripts/qa/tasks-a11y-qa.mjs` (gercek Chromium) tarafindan olculur.
 * Ayrica jsdom'da rc-util `useId` sabit "test-id" dondugu icin AYNI ANDA
 * iki diyalog acikken erisilebilir ad karisir; bu yuzden her ad testi
 * TEK modal senaryosunda yapilir.
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'

vi.mock('../../services/api', async () => await import('./apiMock'))
import { mkTask, resetTasksApi, taskService, workLogService } from './apiMock'
import { inCard, renderTasksPage, setupUser } from './harness'
import { resetAuthStore } from '../utils'

const MINE = mkTask({
    id: 't1', task_code: 'TASK-1', title: 'Gorev basligi',
    assignee_user_id: 'u1', assigner_user_id: 'u1', status: 'in_progress',
})
const DONE = mkTask({
    id: 't3', task_code: 'TASK-3', title: 'Biten gorev', status: 'completed',
    assignee_user_id: 'u1', assigner_user_id: 'u1',
})

const deferred = () => {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

const INTERACTIVE =
    'a[href], button, input, select, textarea, [role="button"], [role="combobox"]'

/** Modal GOVDESI + footer'inda ic ice interaktif eleman var mi? */
const nestedInteractive = (modalEl) => {
    const regions = modalEl.querySelectorAll(
        '.ant-modal-body, .ant-modal-footer'
    )
    const offenders = []
    for (const region of regions) {
        for (const el of region.querySelectorAll(INTERACTIVE)) {
            if (el.querySelector(INTERACTIVE)) {
                offenders.push(`${el.tagName}.${el.className}`)
            }
        }
    }
    return offenders
}

/**
 * Escape'i rc-dialog'un BEKLEDIGI bicimde gonderir.
 *
 * NEDEN fireEvent: rc-dialog eski `e.keyCode === 27` kontrolunu yapar;
 * userEvent'in klavye haritasi jsdom'da `keyCode` DOLDURMAZ (gercek
 * tarayicilar doldurur). Bu bir JSDOM/userEvent bosludur, urun kusuru
 * degil — gercek Escape davranisi ayrica Chromium QA'sinda olculur
 * (scripts/qa/tasks-a11y-qa.mjs).
 */
const pressEscape = (modalEl) =>
    fireEvent.keyDown(modalEl || document.activeElement || document.body, {
        key: 'Escape', code: 'Escape', keyCode: 27, which: 27,
    })

const modalContaining = (text) =>
    Array.from(document.querySelectorAll('.ant-modal')).find((m) =>
        m.textContent.includes(text)
    )

/**
 * Create modali iki adimda acilir: "New work item" → dropdown → "New Task".
 * FOCUS'UN DONECEGI GERCEK TETIKLEYICI, modal acilmadan hemen once odakli
 * olan MENU OGESIDIR; donen deger odur.
 */
const openCreate = async (user) => {
    await user.click(await screen.findByRole('tab', { name: 'Assigned by Me' }))
    await user.click(await screen.findByRole('button', { name: 'New work item' }))
    const item = await screen.findByRole('menuitem', { name: 'New Task' })
    await user.click(item)
    await screen.findByRole('dialog', { name: 'Create Task' })
    return item
}

const openEdit = async (user) => {
    await screen.findByText('Gorev basligi')
    const trigger = inCard('TASK-1').getByRole('button', {
        name: 'Edit — Gorev basligi',
    })
    await user.click(trigger)
    await screen.findByRole('dialog', { name: 'Edit Task' })
    return trigger
}

const openDelete = async (user) => {
    await screen.findByText('Gorev basligi')
    const trigger = inCard('TASK-1').getByRole('button', {
        name: 'Delete — Gorev basligi',
    })
    await user.click(trigger)
    await screen.findByText('Are you sure you want to delete this task?')
    return trigger
}

const openLogTime = async (user) => {
    const trigger = await screen.findByRole('button', {
        name: 'Log time — Biten gorev',
    })
    await user.click(trigger)
    await screen.findByRole('dialog', { name: 'Log time' })
    return trigger
}

beforeEach(() => {
    resetAuthStore()
    resetTasksApi({ tasks: [MINE, DONE] })
})

// ─────────────────────────────────────────────────────────────────────────
describe('erisilebilir diyalog adi', () => {
    it('Create modali adlandirilmistir', async () => {
        const user = setupUser()
        renderTasksPage()
        await openCreate(user)
        expect(
            screen.getByRole('dialog', { name: 'Create Task' })
        ).toHaveAttribute('aria-modal', 'true')
    })

    it('Edit modali adlandirilmistir', async () => {
        const user = setupUser()
        renderTasksPage()
        await openEdit(user)
        expect(
            screen.getByRole('dialog', { name: 'Edit Task' })
        ).toBeInTheDocument()
    })

    it('Delete onay modali adlandirilmistir', async () => {
        const user = setupUser()
        renderTasksPage()
        await openDelete(user)
        // Ozel gorunumlu modal: gorunur baslik govdede, DIYALOG ADI ise
        // gorsel olarak gizli baslikla verilir (rc-dialog aria-* prop'u
        // gecirmez).
        const dialog = screen.getByRole('dialog', { name: /Delete Task/ })
        expect(dialog).toHaveAttribute('aria-modal', 'true')
    })

    it('Log Time modali adlandirilmistir', async () => {
        const user = setupUser()
        renderTasksPage()
        await openLogTime(user)
        expect(
            screen.getByRole('dialog', { name: 'Log time' })
        ).toHaveAttribute('aria-modal', 'true')
    })
})

// ─────────────────────────────────────────────────────────────────────────
describe('acilista makul ilk focus', () => {
    const focusIsInside = (modalEl) =>
        modalEl.contains(document.activeElement) ||
        modalEl === document.activeElement

    it.each([
        ['Create', openCreate, 'Create Task'],
        ['Edit', openEdit, 'Edit Task'],
        ['Log Time', openLogTime, 'Log time'],
    ])('%s modali acilinca focus modalin ICINE gecer', async (_n, open, text) => {
        const user = setupUser()
        renderTasksPage()
        await open(user)
        await waitFor(() =>
            expect(focusIsInside(modalContaining(text))).toBe(true)
        )
    })

    it('Delete onay modali acilinca focus modalin ICINE gecer', async () => {
        const user = setupUser()
        renderTasksPage()
        await openDelete(user)
        await waitFor(() =>
            expect(
                focusIsInside(
                    modalContaining('Are you sure you want to delete this task?')
                )
            ).toBe(true)
        )
    })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Escape ile kapanma ve PENDING kilidi', () => {
    it('Create modali Escape ile kapanir', async () => {
        const user = setupUser()
        renderTasksPage()
        await openCreate(user)
        pressEscape(modalContaining('Create Task'))
        await waitFor(() =>
            expect(
                screen.queryByRole('dialog', { name: 'Create Task' })
            ).not.toBeInTheDocument()
        )
        expect(taskService.createBulk).not.toHaveBeenCalled()
    })

    it('Log Time modali Escape ile kapanir', async () => {
        const user = setupUser()
        renderTasksPage()
        await openLogTime(user)
        pressEscape(modalContaining('Log time'))
        await waitFor(() =>
            expect(
                screen.queryByRole('dialog', { name: 'Log time' })
            ).not.toBeInTheDocument()
        )
        expect(workLogService.create).not.toHaveBeenCalled()
    })

    it('Delete onay modali Escape ile kapanir', async () => {
        const user = setupUser()
        renderTasksPage()
        await openDelete(user)
        pressEscape(
            modalContaining('Are you sure you want to delete this task?')
        )
        // Rol sorgusu GORUNURLUK bilir: bu modal kapaninca icerigini
        // DOM'dan sokmez (wrapper display:none olur), bu yuzden metin
        // sorgusu yanlis pozitif verir.
        await waitFor(() =>
            expect(
                screen.queryByRole('dialog', { name: /Delete Task/ })
            ).not.toBeInTheDocument()
        )
        expect(taskService.delete).not.toHaveBeenCalled()
    })

    it('PENDING iken Escape modali KAPATMAZ (silme)', async () => {
        const gate = deferred()
        taskService.delete.mockImplementationOnce(() => gate.promise)
        const user = setupUser()
        renderTasksPage()
        await openDelete(user)
        const modal = modalContaining('Are you sure you want to delete this task?')
        await user.click(within(modal).getByRole('button', { name: /Delete/ }))
        await waitFor(() => expect(taskService.delete).toHaveBeenCalled())

        pressEscape(modal)
        expect(
            screen.getByText('Are you sure you want to delete this task?')
        ).toBeInTheDocument()
        gate.resolve({ ok: true })
    })

    it('PENDING iken Escape modali KAPATMAZ (Log Time)', async () => {
        const gate = deferred()
        workLogService.create.mockImplementationOnce(() => gate.promise)
        const user = setupUser()
        renderTasksPage()
        await openLogTime(user)
        const dialog = screen.getByRole('dialog', { name: 'Log time' })
        const hours = within(dialog).getByLabelText('Hours')
        await user.clear(hours)
        await user.type(hours, '1')
        for (const [label, opt] of [
            ['Work Type', 'Development'],
            ['Activity Type', 'Coding'],
            ['Platform', 'Backend'],
        ]) {
            await user.click(screen.getByLabelText(label))
            await user.click(await screen.findByTitle(opt))
        }
        await user.click(screen.getByRole('button', { name: 'Log time' }))
        await waitFor(() => expect(workLogService.create).toHaveBeenCalled())

        pressEscape(modalContaining('Log time'))
        expect(
            screen.getByRole('dialog', { name: 'Log time' })
        ).toBeInTheDocument()
        gate.resolve({ id: 'wl-1' })
    })
})

// ─────────────────────────────────────────────────────────────────────────
describe('PENDING sirasinda aksiyon dugmesinin durumu', () => {
    it('Create OK dugmesi pending’te loading gosterir ve tekrar gonderilemez', async () => {
        const gate = deferred()
        taskService.createBulk.mockImplementationOnce(() => gate.promise)
        const user = setupUser()
        renderTasksPage()
        await openCreate(user)
        await user.click(screen.getByLabelText('Customer'))
        await user.click(await screen.findByTitle('Vakko'))
        await user.click(screen.getByLabelText('Project'))
        await user.click(await screen.findByTitle('ATM Yenileme'))
        await user.click(screen.getByLabelText('Assignees'))
        await user.click(await screen.findByTitle('Grace Hopper'))
        await user.type(screen.getByLabelText('Task Title'), 'Baslik')
        await user.type(screen.getByLabelText('Description'), 'Aciklama')

        const ok = screen.getByRole('button', { name: /Create Task/ })
        await user.click(ok)
        await waitFor(() => expect(taskService.createBulk).toHaveBeenCalledTimes(1))
        await waitFor(() =>
            expect(ok.classList.contains('ant-btn-loading')).toBe(true)
        )
        await user.click(ok)
        expect(taskService.createBulk).toHaveBeenCalledTimes(1)
        gate.resolve([{ id: 't-new' }])
    })

    it('Delete dugmesi pending’te loading gosterir', async () => {
        const gate = deferred()
        taskService.delete.mockImplementationOnce(() => gate.promise)
        const user = setupUser()
        renderTasksPage()
        await openDelete(user)
        const modal = modalContaining('Are you sure you want to delete this task?')
        const btn = within(modal).getByRole('button', { name: /Delete/ })
        await user.click(btn)
        await waitFor(() => expect(taskService.delete).toHaveBeenCalled())
        await waitFor(() =>
            expect(btn.classList.contains('ant-btn-loading')).toBe(true)
        )
        gate.resolve({ ok: true })
    })
})

// ─────────────────────────────────────────────────────────────────────────
describe('kapanista focus GERCEK tetikleyiciye doner', () => {
    it('Create modali: acan menu ogesine doner (focus KAYBOLMAZ)', async () => {
        const user = setupUser()
        renderTasksPage()
        const trigger = await openCreate(user)
        pressEscape(modalContaining('Create Task'))
        await waitFor(() =>
            expect(
                screen.queryByRole('dialog', { name: 'Create Task' })
            ).not.toBeInTheDocument()
        )
        await waitFor(() => expect(document.activeElement).toBe(trigger))
    })

    it('Edit modali: kartin Edit aksiyonuna doner', async () => {
        const user = setupUser()
        renderTasksPage()
        const trigger = await openEdit(user)
        pressEscape(modalContaining('Edit Task'))
        await waitFor(() =>
            expect(
                screen.queryByRole('dialog', { name: 'Edit Task' })
            ).not.toBeInTheDocument()
        )
        await waitFor(() => expect(document.activeElement).toBe(trigger))
    })

    it('Delete modali: kartin Delete aksiyonuna doner', async () => {
        const user = setupUser()
        renderTasksPage()
        const trigger = await openDelete(user)
        pressEscape(
            modalContaining('Are you sure you want to delete this task?')
        )
        // Rol sorgusu GORUNURLUK bilir: bu modal kapaninca icerigini
        // DOM'dan sokmez (wrapper display:none olur), bu yuzden metin
        // sorgusu yanlis pozitif verir.
        await waitFor(() =>
            expect(
                screen.queryByRole('dialog', { name: /Delete Task/ })
            ).not.toBeInTheDocument()
        )
        await waitFor(() => expect(document.activeElement).toBe(trigger))
    })
})

// ─────────────────────────────────────────────────────────────────────────
describe('yapisal erisilebilirlik', () => {
    it.each([
        ['Create', openCreate, 'Create Task'],
        ['Edit', openEdit, 'Edit Task'],
        ['Log Time', openLogTime, 'Log time'],
    ])('%s modalinin govdesinde IC ICE interaktif eleman yok', async (_n, open, text) => {
        const user = setupUser()
        renderTasksPage()
        await open(user)
        expect(nestedInteractive(modalContaining(text))).toEqual([])
    })

    it('Delete modalinin govdesinde IC ICE interaktif eleman yok', async () => {
        const user = setupUser()
        renderTasksPage()
        await openDelete(user)
        expect(
            nestedInteractive(
                modalContaining('Are you sure you want to delete this task?')
            )
        ).toEqual([])
    })

    it('kart uzerindeki TUM ikon dugmelerinin erisilebilir adi vardir', async () => {
        renderTasksPage()
        await screen.findByText('Gorev basligi')
        const buttons = Array.from(
            document.querySelectorAll('.task-card-action-btn')
        )
        expect(buttons.length).toBeGreaterThan(0)
        for (const b of buttons) {
            expect(b.getAttribute('aria-label')).toBeTruthy()
        }
    })
})

// ─────────────────────────────────────────────────────────────────────────
describe('kisayol izolasyonu', () => {
    it('Tasks yuzeyinde GLOBAL gorev kisayolu YOKTUR', async () => {
        const user = setupUser()
        renderTasksPage()
        await screen.findByText('Gorev basligi')
        // Time Entry'nin pano kisayollari Tasks'ta hicbir sey yapmaz:
        // ne modal acar ne mutation uretir. (Task copy/paste CTO
        // karariyla urun kapsami DISINDADIR — yerine bir sey konmadi.)
        await user.keyboard('{Control>}c{/Control}')
        await user.keyboard('{Control>}v{/Control}')
        await user.keyboard('{Meta>}c{/Meta}')
        await user.keyboard('{Meta>}v{/Meta}')
        await user.keyboard('n')
        await user.keyboard('{Delete}')

        expect(document.querySelector('.ant-modal')).toBeNull()
        expect(taskService.create).not.toHaveBeenCalled()
        expect(taskService.createBulk).not.toHaveBeenCalled()
        expect(taskService.delete).not.toHaveBeenCalled()
        expect(taskService.updateStatus).not.toHaveBeenCalled()
        expect(workLogService.create).not.toHaveBeenCalled()
    })

    it('Tasks modali ACIKKEN Time Entry kisayollari mutation URETMEZ', async () => {
        const user = setupUser()
        renderTasksPage()
        await openLogTime(user)
        await user.keyboard('{Control>}c{/Control}')
        await user.keyboard('{Control>}v{/Control}')
        expect(workLogService.create).not.toHaveBeenCalled()
        expect(taskService.createBulk).not.toHaveBeenCalled()
        // Modal da kendiliginden kapanmaz.
        expect(
            screen.getByRole('dialog', { name: 'Log time' })
        ).toBeInTheDocument()
    })
})
