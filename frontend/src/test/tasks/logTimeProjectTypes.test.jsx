/**
 * Efor girisi proje adimi (CTO 05.10): musteri secilince projeler TURE
 * gore alt basliklar altinda; tursuzler en sonda. Musterinin hic turlu
 * projesi yoksa baslik cizilmez (eski tek liste).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../services/api', async () => await import('./apiMock'))
import { mockState, resetTasksApi } from './apiMock'
import { renderWithProviders } from '../utils'
import LogTimeModal from '../../components/modals/LogTimeModal'

beforeEach(() => {
    resetTasksApi()
})

const open = async () => {
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 })
    renderWithProviders(<LogTimeModal open onClose={() => {}} onSubmit={vi.fn()} initialDate="2026-09-22" />)
    await user.click(await screen.findByRole('button', { name: /^Vakko/ }))
    return user
}

describe('efor girisi: projeler ture gore', () => {
    it('turlu projeler alt basliklar altinda, tursuzler en sonda', async () => {
        mockState.projects = [
            { id: 'p1', customer_id: 'c1', name: 'ATM Yenileme', is_active: true },
            { id: 'p3', customer_id: 'c1', name: 'L2 Destek', is_active: true, project_type_id: 't1', project_type_name: 'Destek', project_type_color: 'blue', logo_glyph: 'lv2' },
            { id: 'p4', customer_id: 'c1', name: 'CMS Talep', is_active: true, project_type_id: 't2', project_type_name: 'Talep', project_type_color: 'amber' },
        ]
        await open()
        const groups = await screen.findAllByTestId('log-time-type-group')
        expect(groups).toHaveLength(3)
        expect(within(groups[0]).getByRole('button', { name: /^L2 Destek/ })).toBeInTheDocument()
        expect(groups[0]).toHaveTextContent('Destek')
        expect(groups[1]).toHaveTextContent('Talep')
        expect(within(groups[2]).getByRole('button', { name: /^ATM Yenileme/ })).toBeInTheDocument()
        expect(groups[2]).toHaveTextContent('No type')
        // Jenerik logolu proje kartinda logo var.
        expect(within(groups[0]).getByRole('button', { name: /^L2 Destek/ }).querySelector('img')).toBeTruthy()
    })

    it('hic turlu proje yoksa baslik yok', async () => {
        await open()
        await screen.findByRole('button', { name: /^ATM Yenileme/ })
        expect(screen.queryAllByTestId('log-time-type-group')).toHaveLength(0)
    })
})
