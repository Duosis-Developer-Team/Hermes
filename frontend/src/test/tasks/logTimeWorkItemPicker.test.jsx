/**
 * =============================================================================
 * PM rework A10 — Log Time'da istege bagli is kalemi secici
 * =============================================================================
 * Serbest giriste (Time Entry) proje secildikten sonra secici gorunur,
 * yalniz o projenin ACIK is kalemlerini listeler ve secim `task_id`
 * olarak payload'a girer. Gorevden acilan akista (prefillTask) secici
 * YOK — bag zaten cagirandan gelir.
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../services/api', async () => await import('./apiMock'))
import { mkTask, mockState, resetTasksApi, taskService } from './apiMock'
import { renderWithProviders } from '../utils'
import LogTimeModal from '../../components/modals/LogTimeModal'

const dialog = () => document.querySelector('.log-time-modal')

const pick = async (user, labelText, optionTitle) => {
    await user.click(screen.getByLabelText(labelText))
    await user.click(await screen.findByTitle(optionTitle))
}

/** Adim 0 → 1 → 2: musteri ve proje secimi (AntD Select). */
const reachForm = async (user) => {
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByTitle('Vakko'))
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByTitle('ATM Yenileme'))
    await waitFor(() => expect(within(dialog()).getByLabelText('Hours')).toBeInTheDocument())
}

beforeEach(() => {
    resetTasksApi()
    mockState.tasks = [
        mkTask({ id: 'wi-open', task_code: 'TASK-11', title: 'Acik is', project_id: 'p1', status: 'pending' }),
        mkTask({ id: 'wi-done', task_code: 'TASK-12', title: 'Bitmis is', project_id: 'p1', status: 'completed' }),
    ]
})

describe('A10 — is kalemi secici', () => {
    it('serbest giriste proje secilince gorunur; yalniz ACIK kalemler listelenir; secim task_id olur', async () => {
        const user = userEvent.setup({ delay: null })
        const onSubmit = vi.fn().mockResolvedValue({ id: 'wl-1' })
        renderWithProviders(
            <LogTimeModal open onClose={() => {}} onSubmit={onSubmit} initialDate="2026-09-22" />
        )
        await reachForm(user)

        // Secici gorunur ve o projenin kalemleri istenir.
        const picker = within(dialog()).getByLabelText('Work item (optional)')
        expect(picker).toBeInTheDocument()
        await waitFor(() => expect(taskService.list).toHaveBeenCalledWith(
            expect.objectContaining({ project_id: 'p1', archive_state: 'active' })
        ))

        await user.click(picker)
        expect(await screen.findByTitle('TASK-11 - Acik is')).toBeInTheDocument()
        expect(screen.queryByTitle('TASK-12 - Bitmis is')).toBeNull()
        await user.click(screen.getByTitle('TASK-11 - Acik is'))

        // Formu gecerli hale getir ve gonder.
        const hours = within(dialog()).getByLabelText('Hours')
        await user.clear(hours)
        await user.type(hours, '2')
        await pick(user, 'Work Type', 'Development')
        await pick(user, 'Activity Type', 'Coding')
        await pick(user, 'Platform', 'Backend')
        await user.type(within(dialog()).getByLabelText('Description'), 'calisma')
        await user.click(within(dialog()).getByRole('button', { name: 'Log time' }))

        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
        const [data] = onSubmit.mock.calls[0]
        expect(data.task_id).toBe('wi-open')
        expect(data.project_id).toBe('p1')
    })

    it('secim yapilmazsa task_id null gider', async () => {
        const user = userEvent.setup({ delay: null })
        const onSubmit = vi.fn().mockResolvedValue({ id: 'wl-1' })
        renderWithProviders(
            <LogTimeModal open onClose={() => {}} onSubmit={onSubmit} initialDate="2026-09-22" />
        )
        await reachForm(user)
        const hours = within(dialog()).getByLabelText('Hours')
        await user.clear(hours)
        await user.type(hours, '1')
        await pick(user, 'Work Type', 'Development')
        await pick(user, 'Activity Type', 'Coding')
        await pick(user, 'Platform', 'Backend')
        await user.type(within(dialog()).getByLabelText('Description'), 'calisma')
        await user.click(within(dialog()).getByRole('button', { name: 'Log time' }))
        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
        expect(onSubmit.mock.calls[0][0].task_id).toBeNull()
    })

    it('gorevden acilan akista (prefillTask) secici YOKTUR', async () => {
        renderWithProviders(
            <LogTimeModal
                open onClose={() => {}} onSubmit={vi.fn()}
                prefillTask={mkTask({ id: 't1', project_id: 'p1', customer_id: 'c1' })}
            />
        )
        await waitFor(() => expect(within(dialog()).getByLabelText('Hours')).toBeInTheDocument())
        expect(within(dialog()).queryByLabelText('Work item (optional)')).toBeNull()
        expect(taskService.list).not.toHaveBeenCalled()
    })
})
