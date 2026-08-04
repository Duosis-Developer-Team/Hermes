/**
 * =============================================================================
 * Sprint 5C — KAPI 3b: Board / List GORUNUM ESITLIGI
 * =============================================================================
 * MEVCUT URUNDE Calendar YOK. Iki gorunum vardir ve sozlesmeleri koddan
 * cikarilmistir:
 *
 *   Board — durum kanban'i (Pending / In Progress / Completed / Rejected).
 *           Kartlar dnd-kit ile SURUKLENEBILIR, ancak yalnizca "My Tasks"
 *           kapsaminda (allowStatusDrag); "Assigned by Me" salt izleme.
 *   List  — ayni gorev kumesinin AntD tablosu; ayni aksiyonlar, ayni
 *           izin kurali.
 *
 * IKISI DE UST KATMANDAN GELEN AYNI `tasks` DIZISINI tuketir: kapsam,
 * hizli filtre, capraz filtreler ve admin kullanici secimi gorunum
 * DEGISIMINDEN ETKILENMEZ. Bu dosya bunu DOM seviyesinde kanitlar.
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'

vi.mock('../../services/api', async () => await import('./apiMock'))
import { PERMS_ADMIN, mkTask, resetTasksApi, taskService } from './apiMock'
import { inCard, renderTasksPage, setupUser } from './harness'
import { resetAuthStore } from '../utils'

const TASKS = [
    mkTask({
        id: 't1', task_code: 'TASK-1', title: 'Bekleyen gorev',
        status: 'pending', priority: 'urgent',
        assignee_user_id: 'u1', assigner_user_id: 'u1',
    }),
    mkTask({
        id: 't2', task_code: 'TASK-2', title: 'Devam eden gorev',
        status: 'in_progress', priority: 'low',
        assignee_user_id: 'u1', assigner_user_id: 'u2',
    }),
    mkTask({
        id: 't3', task_code: 'TASK-3', title: 'Biten gorev',
        status: 'completed', priority: 'high',
        assignee_user_id: 'u1', assigner_user_id: 'u1',
    }),
]

const toList = async (user) => user.click(await screen.findByText('List'))
const toBoard = async (user) => user.click(await screen.findByText('Board'))

/** Board'da render edilen gorev kodlari. */
const boardCodes = () =>
    Array.from(document.querySelectorAll('.task-card-code'))
        .map((e) => e.textContent)
        .sort()

/** List tablosunda render edilen gorev kodlari. */
const listCodes = () =>
    Array.from(document.querySelectorAll('.ant-table-tbody tr[data-row-key]'))
        .map((tr) => tr.querySelector('td')?.parentElement?.textContent || '')
        .map((t) => (t.match(/TASK-\d+/) || [null])[0])
        .filter(Boolean)
        .sort()

const lastListParams = () => taskService.list.mock.calls.at(-1)[0]

beforeEach(() => {
    resetAuthStore()
    resetTasksApi({ tasks: TASKS })
})

describe('ayni filtrelerde AYNI gorev kumesi', () => {
    it('Board ve List ayni TASK kimlik kumesini gosterir', async () => {
        const user = setupUser()
        renderTasksPage()
        await screen.findByText('Bekleyen gorev')
        const onBoard = boardCodes()
        expect(onBoard).toEqual(['TASK-1', 'TASK-2', 'TASK-3'])

        await toList(user)
        await waitFor(() => expect(listCodes()).toHaveLength(3))
        expect(listCodes()).toEqual(onBoard)
    })

    it('gorunum degisimi YENI istek ACMAZ (cache yeniden yuklenmez)', async () => {
        const user = setupUser()
        renderTasksPage()
        await screen.findByText('Bekleyen gorev')
        const before = taskService.list.mock.calls.length
        await toList(user)
        await waitFor(() => expect(listCodes()).toHaveLength(3))
        await toBoard(user)
        await screen.findByText('Bekleyen gorev')
        expect(taskService.list.mock.calls.length).toBe(before)
    })
})

describe('gorunum degisiminde baglam KORUNUR', () => {
    it('durum filtresi ve hizli filtre gorunum degisimini asar', async () => {
        const user = setupUser()
        renderTasksPage()
        await screen.findByText('Bekleyen gorev')

        // Premium redesign: gelismis filtreler drawer'a tasindi —
        // once "Filters" aksiyonu acilir (davranis sozlesmesi ayni).
        await user.click(screen.getByRole('button', { name: /Filters/ }))
        // Capraz filtre: Status = In Progress
        await user.click(
            await screen.findByRole('combobox', { name: 'Filter by status' })
        )
        await user.click(await screen.findByTitle('In Progress'))
        // Ikincil filtre: Overdue
        await user.click(screen.getByRole('button', { name: 'Overdue' }))
        await waitFor(() => expect(lastListParams().status).toBe('in_progress'))
        const paramsOnBoard = lastListParams()

        await toList(user)
        await waitFor(() => expect(listCodes()).toHaveLength(3))
        // Ayni parametreler — gorunum sorguyu DEGISTIRMEZ.
        expect(lastListParams()).toEqual(paramsOnBoard)
        // Kontroller de secili kalir.
        expect(
            screen.getByRole('button', { name: 'Overdue' })
        ).toHaveAttribute('aria-pressed', 'true')
    })

    it('kapsam (Assigned by Me) gorunum degisimini asar', async () => {
        const user = setupUser()
        renderTasksPage()
        await user.click(await screen.findByRole('tab', { name: 'Assigned by Me' }))
        await waitFor(() =>
            expect(lastListParams().assigner_user_id).toBe('u1')
        )
        await toList(user)
        await waitFor(() => expect(listCodes()).toHaveLength(3))
        expect(lastListParams().assigner_user_id).toBe('u1')
        expect(lastListParams().assignee_user_id).toBeUndefined()
        expect(
            screen.getByRole('tab', { name: 'Assigned by Me' })
        ).toHaveAttribute('aria-selected', 'true')
    })

    it('ADMIN tarafindan secilen kullanici gorunum degisimini asar', async () => {
        resetTasksApi({ tasks: TASKS, perms: PERMS_ADMIN })
        const user = setupUser()
        renderTasksPage()
        await screen.findByText('Bekleyen gorev')
        await user.click(screen.getByRole('combobox', { name: 'Viewed user' }))
        await user.click(await screen.findByTitle('Grace Hopper'))
        await waitFor(() => expect(lastListParams().assignee_user_id).toBe('u2'))

        await toList(user)
        await waitFor(() => expect(listCodes()).toHaveLength(3))
        expect(lastListParams().assignee_user_id).toBe('u2')
        // Secici hala Grace'i gosterir.
        expect(
            document.querySelector('.tasks-user-header-left').textContent
        ).toContain('Grace Hopper')
    })
})

describe('ayni gorev — iki gorunumde AYNI anlam', () => {
    it('durum ve oncelik iki gorunumde de ayni degeri tasir', async () => {
        const user = setupUser()
        renderTasksPage()
        await screen.findByText('Devam eden gorev')
        const card = inCard('TASK-2')
        expect(card.getByText('in progress')).toBeInTheDocument()
        expect(card.getByText('low')).toBeInTheDocument()

        await toList(user)
        await waitFor(() => expect(listCodes()).toHaveLength(3))
        const row = Array.from(
            document.querySelectorAll('.ant-table-tbody tr[data-row-key]')
        ).find((tr) => tr.textContent.includes('TASK-2'))
        expect(within(row).getByText('in progress')).toBeInTheDocument()
        expect(within(row).getByText('low')).toBeInTheDocument()
    })

    it('RBAC iki gorunumde de AYNI kurala dayanir (atayan → Edit/Delete)', async () => {
        const user = setupUser()
        renderTasksPage()
        await screen.findByText('Bekleyen gorev')
        // Board: kendi atadigi TASK-1 duzenlenebilir, TASK-2 degil.
        expect(
            inCard('TASK-1').getByRole('button', { name: /^Edit — / })
        ).toBeInTheDocument()
        expect(
            inCard('TASK-2').queryByRole('button', { name: /^Edit — / })
        ).toBeNull()

        await toList(user)
        await waitFor(() => expect(listCodes()).toHaveLength(3))
        const rowOf = (code) =>
            Array.from(
                document.querySelectorAll('.ant-table-tbody tr[data-row-key]')
            ).find((tr) => tr.textContent.includes(code))
        // List: AYNI sonuc, ayni erisilebilir adlar.
        expect(
            within(rowOf('TASK-1')).getByRole('button', { name: /^Edit — / })
        ).toBeInTheDocument()
        expect(
            within(rowOf('TASK-2')).queryByRole('button', { name: /^Edit — / })
        ).toBeNull()
    })

    it('Log Time aksiyonu YALNIZ tamamlanan gorevde, iki gorunumde de', async () => {
        const user = setupUser()
        renderTasksPage()
        await screen.findByText('Biten gorev')
        expect(
            inCard('TASK-3').getByRole('button', { name: 'Log time — Biten gorev' })
        ).toBeInTheDocument()
        expect(
            inCard('TASK-1').queryByRole('button', { name: /^Log time — / })
        ).toBeNull()

        await toList(user)
        await waitFor(() => expect(listCodes()).toHaveLength(3))
        expect(
            screen.getByRole('button', { name: 'Log time — Biten gorev' })
        ).toBeInTheDocument()
        expect(
            screen.queryByRole('button', { name: 'Log time — Bekleyen gorev' })
        ).toBeNull()
    })

    it('List gorunumunden acilan Log Time ayni prefill sozlesmesini kullanir', async () => {
        const user = setupUser()
        renderTasksPage()
        await toList(user)
        await waitFor(() => expect(listCodes()).toHaveLength(3))
        await user.click(
            screen.getByRole('button', { name: 'Log time — Biten gorev' })
        )
        const dialog = await screen.findByRole('dialog', { name: 'Log time' })
        expect(within(dialog).getByLabelText('Description'))
            .toHaveValue('Task: Biten gorev\n\nGorev aciklamasi')
        expect(within(dialog).getByText('ATM Yenileme')).toBeInTheDocument()
    })
})
