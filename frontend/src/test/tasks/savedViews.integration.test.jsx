/**
 * =============================================================================
 * PM rework P3.5 — gorunum kaydet / uc eksen entegrasyonu (E1, E2, E5)
 * =============================================================================
 * Gercek TasksPage + router + mock servisler:
 *   1. Kontrol cubugunda yalniz iki eksen: yerlesim (Board/List/Calendar)
 *      ve gruplama; kapsam/tip/zaman/hizli filtre kontrolleri YOK.
 *   2. Filtre degisince "Modified" isareti; "Save as view" kayitli gorunumu
 *      dogru filter_json ile yazar ve yeni gorunume gecer (URL ?view=).
 *   3. Kayitli gorunum sol kolonda listelenir ve secilince kendi
 *      yerlesimiyle acilir.
 *   4. Takvim yerlesimi ayni sorguyu kullanir (parametre degismez).
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'

vi.mock('../../services/api', async () => await import('./apiMock'))
import { mockState, resetTasksApi, savedViewService, taskService } from './apiMock'
import { renderTasksPage, setupUser } from './harness'

const lastListParams = () => taskService.list.mock.calls.at(-1)?.[0]

beforeEach(() => {
    resetTasksApi()
})

describe('uc eksen (E1)', () => {
    it('kontrol cubugu: yalniz yerlesim + gruplama; eski eksen kontrolleri yok', async () => {
        renderTasksPage()
        await screen.findByRole('tab', { name: 'My work items' })
        expect(screen.getByRole('group', { name: 'Layout' })).toBeInTheDocument()
        expect(screen.getByRole('group', { name: 'Group' })).toBeInTheDocument()
        expect(screen.queryByRole('tab', { name: 'Weekly' })).toBeNull()
        expect(screen.queryByRole('tablist', { name: 'Work item type' })).toBeNull()
        expect(screen.queryByRole('tablist', { name: 'Task scope' })).toBeNull()
        expect(screen.queryByRole('toolbar', { name: 'Quick task filters' })).toBeNull()
    })

    it('takvim yerlesimi sorguyu DEGISTIRMEZ ve gun izgarasi cizer', async () => {
        const user = setupUser()
        renderTasksPage()
        await screen.findByRole('tab', { name: 'My work items' })
        await waitFor(() => expect(taskService.list).toHaveBeenCalled())
        const before = lastListParams()
        await user.click(screen.getByRole('button', { name: 'Calendar' }))
        expect(await screen.findByTestId('tasks-calendar')).toBeInTheDocument()
        expect(document.querySelectorAll('.tv-cal__day')).toHaveLength(7)
        expect(lastListParams()).toEqual(before)
        // Takvimde gruplama ekseni yok.
        expect(screen.queryByRole('group', { name: 'Group' })).toBeNull()
    })
})

describe('gorunum kaydet (E2)', () => {
    it('filtre degisince Modified; kaydedince filter_json dogru ve yeni gorunume gecilir', async () => {
        const user = setupUser()
        renderTasksPage()
        await screen.findByRole('tab', { name: 'My work items' })
        expect(screen.queryByText('Modified')).toBeNull()

        // Gecikmis gorunumu + liste + proje gruplama + oncelik filtresi.
        await user.click(screen.getByRole('tab', { name: 'Overdue' }))
        await user.click(screen.getByRole('button', { name: 'List' }))
        await user.click(screen.getByRole('button', { name: /Filters/ }))
        await user.click(await screen.findByRole('combobox', { name: 'Filter by priority' }))
        await user.click(await screen.findByTitle('High'))
        expect(await screen.findByText('Modified')).toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: 'Save as view' }))
        // Test ortaminda antd modal basliklari ayni sahte id'yi paylasir
        // (aria-labelledby ilk esleseni bulur); dialog basligindan bulunur.
        const dialog = (await screen.findByText('Save view')).closest('[role="dialog"]')
        await user.type(within(dialog).getByLabelText('Name'), 'Acil gecikmisler')
        await user.click(within(dialog).getByRole('radio', { name: 'Everyone with work access' }))
        await user.click(within(dialog).getByRole('button', { name: 'Save' }))

        await waitFor(() => expect(savedViewService.create).toHaveBeenCalledTimes(1))
        expect(savedViewService.create.mock.calls[0][0]).toEqual({
            name: 'Acil gecikmisler', scope: 'shared', layout: 'list',
            filter_json: { scope: 'my-tasks', due: 'overdue', priority: 'high', group_by: 'project' },
        })
        expect(await screen.findByText('View saved')).toBeInTheDocument()
    })

    it('kayitli gorunum sol kolonda; secilince kendi yerlesimi ve filtresi', async () => {
        mockState.savedViews = { items: [{
            id: 'v-9', name: 'Vakko gecikmis', scope: 'personal', layout: 'list', can_edit: true,
            filter_json: { scope: 'my-tasks', due: 'overdue', customer_id: 'c1', group_by: 'owner' },
        }] }
        const user = setupUser()
        renderTasksPage()
        const tab = await screen.findByRole('tab', { name: 'Vakko gecikmis' })
        expect(screen.getByText('My views')).toBeInTheDocument()
        await user.click(tab)
        await waitFor(() => expect(lastListParams().customer_id).toBe('c1'))
        expect(lastListParams().status_exclude).toEqual(['completed'])
        expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByRole('button', { name: 'Owner' })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.queryByText('Modified')).toBeNull()
        expect(screen.getByRole('button', { name: 'Delete view — Vakko gecikmis' })).toBeInTheDocument()
    })
})
