/**
 * =============================================================================
 * Sprint 5C — KAPI 3: Tarih ve timezone SINIRLARI
 * =============================================================================
 * Calendar gorunumu URUNDE YOK — burada Calendar testi/UI'i URETILMEZ.
 * Test edilen, gercekten var olan tarih modelleridir:
 *
 *  - Weekly aralik penceresi (ISO hafta, DUE DATE ile pencerelenir),
 *  - hizli filtrelerin tarih parametreleri,
 *  - scheduled/due tarih alanlarinin API ↔ UI donusumu,
 *  - date-only degerlerin bir onceki/sonraki GUNE KAYMAMASI.
 *
 * Ortam saati `vi.setSystemTime` ile (yalniz Date sahte — setTimeout
 * gercek kalir ki userEvent calissin), zaman dilimi `process.env.TZ` ile
 * degistirilir; ikisi de her testten sonra geri alinir.
 *
 * KRITIK TUZAK (kilitlenen): `new Date('2026-03-01')` UTC gece yarisi
 * olarak parse edilir ve NEGATIF offset'te bir onceki gune duser. Uygulama
 * gun anahtarlarini YEREL gun olarak isler; asagidaki testler bunu +14,
 * +3, 0 ve -5 offsetlerinde dogrular.
 * =============================================================================
 */
import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider } from 'antd'

vi.mock('../../services/api', async () => await import('./apiMock'))
import { mkTask, resetTasksApi, taskService, workLogService } from './apiMock'
import { renderTasksPage, setupUser } from './harness'
import { makeTestQueryClient, resetAuthStore } from '../utils'
import { TaskDueBadge } from '../../components/tasks/TaskCard'
// Saf yardimci artik kendi modulunde (fast-refresh sozlesmesi).
import { taskDueState } from '../../features/tasks/model/taskDueState'

const ORIGINAL_TZ = process.env.TZ

/** Zaman dilimini calisma aninda degistirir (Node tzset). */
const setTZ = (tz) => { process.env.TZ = tz }

/** Sahte SAAT — yalniz Date; timer'lar gercek kalir (userEvent icin). */
const freezeAt = (iso) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(iso))
}

beforeEach(() => {
    resetAuthStore()
    resetTasksApi({ tasks: [] })
})

afterEach(() => {
    vi.useRealTimers()
    process.env.TZ = ORIGINAL_TZ
})

/** Weekly moda gecer ve son liste cagrisinin parametrelerini doner. */
const weeklyParams = async () => {
    const user = setupUser()
    renderTasksPage()
    await user.click(await screen.findByRole('tab', { name: 'Weekly' }))
    await waitFor(() => {
        const last = taskService.list.mock.calls.at(-1)?.[0]
        expect(last?.due_from).toBeTruthy()
    })
    return taskService.list.mock.calls.at(-1)[0]
}

// ─────────────────────────────────────────────────────────────────────────
describe('Weekly penceresi — takvim sinirlari', () => {
    it('AY SONU: hafta eylul ayina tasarken pencere kirilmaz', async () => {
        setTZ('UTC')
        freezeAt('2026-08-31T09:00:00Z') // Pazartesi
        const p = await weeklyParams()
        expect(p.due_from).toBe('2026-08-31')
        expect(p.due_to).toBe('2026-09-06')
    })

    it('YIL GECISI: hafta 2026 → 2027 gecerken pencere kirilmaz', async () => {
        setTZ('UTC')
        freezeAt('2026-12-30T09:00:00Z') // Carsamba
        const p = await weeklyParams()
        expect(p.due_from).toBe('2026-12-28')
        expect(p.due_to).toBe('2027-01-03')
    })

    it('ARTIK GUN: 29 Subat 2028 iceren hafta dogru pencerelenir', async () => {
        setTZ('UTC')
        freezeAt('2028-02-29T09:00:00Z') // Sali, artik gun
        const p = await weeklyParams()
        expect(p.due_from).toBe('2028-02-28')
        expect(p.due_to).toBe('2028-03-05')
    })

    it('UTC GECE YARISI: gun sinirinda pencere kaymaz', async () => {
        setTZ('UTC')
        freezeAt('2026-07-27T00:00:00Z')
        const p = await weeklyParams()
        expect(p.due_from).toBe('2026-07-27')
        expect(p.due_to).toBe('2026-08-02')
    })

    it('POZITIF OFFSET (Europe/Istanbul, +03): YEREL gun esas alinir', async () => {
        // UTC'de hala 26 Temmuz 22:00; Istanbul'da 27 Temmuz 01:00.
        // Uygulama YEREL gunu kullandigi icin pencere 27'nin haftasidir.
        setTZ('Europe/Istanbul')
        freezeAt('2026-07-26T22:00:00Z')
        const p = await weeklyParams()
        expect(p.due_from).toBe('2026-07-27')
        expect(p.due_to).toBe('2026-08-02')
    })

    it('NEGATIF OFFSET (America/New_York, -04): gun kaymasi olusmaz', async () => {
        // UTC'de 27 Temmuz 02:00; New York'ta hala 26 Temmuz 22:00.
        // Pencere ONCEKI haftadir — UTC'ye gore hesaplansaydi yanlis
        // hafta acilirdi.
        setTZ('America/New_York')
        freezeAt('2026-07-27T02:00:00Z')
        const p = await weeklyParams()
        expect(p.due_from).toBe('2026-07-20')
        expect(p.due_to).toBe('2026-07-26')
    })

    it('COK POZITIF OFFSET (+14): pencere yine YEREL haftadir', async () => {
        setTZ('Pacific/Kiritimati')
        freezeAt('2026-08-30T12:00:00Z') // yerelde 31 Agustos 02:00
        const p = await weeklyParams()
        expect(p.due_from).toBe('2026-08-31')
        expect(p.due_to).toBe('2026-09-06')
    })
})

// ─────────────────────────────────────────────────────────────────────────
describe('hizli filtrelerin tarih parametreleri', () => {
    const clickChip = async (label) => {
        const user = setupUser()
        renderTasksPage()
        await user.click(await screen.findByRole('button', { name: label }))
        await waitFor(() => {
            const last = taskService.list.mock.calls.at(-1)?.[0]
            expect(last?.due_to || last?.completed_to).toBeTruthy()
        })
        return taskService.list.mock.calls.at(-1)[0]
    }

    it('Overdue: due_to = DUN (yerel), tamamlananlar haric', async () => {
        setTZ('Europe/Istanbul')
        freezeAt('2026-03-01T00:30:00Z') // Istanbul'da 01 Mart 03:30
        const p = await clickChip('Overdue')
        expect(p.due_to).toBe('2026-02-28')
        expect(p.status_exclude).toEqual(['completed'])
        expect(p.due_from).toBeUndefined()
    })

    it('Overdue: ARTIK YILDA dun 29 Subat olur', async () => {
        setTZ('UTC')
        freezeAt('2028-03-01T10:00:00Z')
        const p = await clickChip('Overdue')
        expect(p.due_to).toBe('2028-02-29')
    })

    it('Due This Week: pencere ISO haftasidir', async () => {
        setTZ('UTC')
        freezeAt('2026-12-31T10:00:00Z')
        const p = await clickChip('Due This Week')
        expect(p.due_from).toBe('2026-12-28')
        expect(p.due_to).toBe('2027-01-03')
    })

    it('Completed This Week: completed_* penceresi + statuses', async () => {
        setTZ('UTC')
        freezeAt('2026-08-31T10:00:00Z')
        const p = await clickChip('Completed This Week')
        expect(p.completed_from).toBe('2026-08-31')
        expect(p.completed_to).toBe('2026-09-06')
        expect(p.statuses).toEqual(['completed'])
    })
})

// ─────────────────────────────────────────────────────────────────────────
describe('date-only degerler GUN KAYDIRMAZ', () => {
    const DATED = mkTask({
        id: 't-date', task_code: 'TASK-D', title: 'Tarihli gorev',
        status: 'completed',
        scheduled_date: '2026-03-01', due_date: '2026-03-01',
    })

    it.each([
        ['UTC', 'UTC'],
        ['Europe/Istanbul (+03)', 'Europe/Istanbul'],
        ['America/New_York (-05)', 'America/New_York'],
        ['Pacific/Kiritimati (+14)', 'Pacific/Kiritimati'],
        ['Pacific/Midway (-11)', 'Pacific/Midway'],
    ])('%s: scheduled_date Log Time payload’ina AYNEN gider', async (_n, tz) => {
        setTZ(tz)
        resetTasksApi({ tasks: [DATED] })
        const user = setupUser()
        renderTasksPage()
        await user.click(
            await screen.findByRole('button', { name: 'Log time — Tarihli gorev' })
        )
        const dialog = await screen.findByRole('dialog', { name: 'Log time' })
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
        // Kaydin gunu, gorevin gunudur — bir onceki/sonraki gun DEGIL.
        expect(workLogService.create.mock.calls[0][0].date_worked)
            .toBe('2026-03-01')
    })

    it.each([
        ['UTC', 'UTC'],
        ['America/New_York (-05)', 'America/New_York'],
        ['Pacific/Kiritimati (+14)', 'Pacific/Kiritimati'],
    ])('%s: scheduled ve due tarihleri listede AYNEN gorunur', async (_n, tz) => {
        setTZ(tz)
        resetTasksApi({
            tasks: [mkTask({
                id: 't-l', task_code: 'TASK-L', title: 'Liste gorevi',
                scheduled_date: '2026-03-01', due_date: '2026-12-31',
            })],
        })
        const user = setupUser()
        renderTasksPage()
        await user.click(await screen.findByText('List'))
        expect(await screen.findByText('2026-03-01')).toBeInTheDocument()
        expect(screen.getByText('2026-12-31')).toBeInTheDocument()
    })
})

// ─────────────────────────────────────────────────────────────────────────
describe('due-date rozeti gun sinirinda dogru okur', () => {
    const renderBadge = (task) =>
        render(
            <QueryClientProvider client={makeTestQueryClient()}>
                <ConfigProvider><TaskDueBadge task={task} /></ConfigProvider>
            </QueryClientProvider>
        )

    it.each([
        ['UTC', 'UTC'],
        ['Europe/Istanbul (+03)', 'Europe/Istanbul'],
        ['America/New_York (-05)', 'America/New_York'],
        ['Pacific/Kiritimati (+14)', 'Pacific/Kiritimati'],
    ])('%s: BUGUN vadesi gelen gorev OVERDUE degildir', (_n, tz) => {
        setTZ(tz)
        // Her dilimde "yerel bugun" farkli bir UTC anina denk gelir;
        // rozet YEREL gune gore hesaplanmalidir.
        freezeAt('2026-03-01T12:00:00Z')
        const today = new Date()
        const local = `${today.getFullYear()}-${String(today.getMonth() + 1)
            .padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
        expect(taskDueState({ due_date: local, status: 'pending' }))
            .toBe('due_today')
        renderBadge({ due_date: local, status: 'pending' })
        expect(screen.getByText('DUE TODAY')).toBeInTheDocument()
    })

    it('DUN vadesi gecen gorev OVERDUE olur (artik gun sinirinda)', () => {
        setTZ('UTC')
        freezeAt('2028-03-01T12:00:00Z')
        expect(taskDueState({ due_date: '2028-02-29', status: 'pending' }))
            .toBe('overdue')
    })

    it('tamamlanmis gorev ASLA overdue gostermez', () => {
        setTZ('UTC')
        freezeAt('2026-03-01T12:00:00Z')
        expect(taskDueState({ due_date: '2026-01-01', status: 'completed' }))
            .toBeNull()
        // `rejected` urunden kaldirildi: gecmiste kalmis bir satir artik
        // ACIK is sayilir, dolayisiyla gecikmis rozetini HAK EDER.
        expect(taskDueState({ due_date: '2026-01-01', status: 'rejected' }))
            .toBe('overdue')
    })
})
