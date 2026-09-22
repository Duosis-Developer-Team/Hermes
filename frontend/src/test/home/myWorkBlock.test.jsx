/**
 * =============================================================================
 * PM rework P3.1 — "Islerim" blogu (D3)
 * =============================================================================
 * Kilitlenen sozlesmeler (04-roller §4.2, §7; 05 D3):
 *   1. Uc kova; bos gecikmis/bu hafta GORUNMEZ, bos bugun tek satir.
 *   2. Kova ici proje gruplu: `Musteri · Proje` + sayi.
 *   3. Gecikmis sayaci kirmizi rozet; banner/modal/toast YOK.
 *   4. Satir `/work/<KEY>` baglantisi; termin tonu satirda tek sinyal.
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { screen, within } from '@testing-library/react'

const homeService = { myWork: vi.fn() }
vi.mock('../../services/api', () => ({ homeService }))

import { renderWithProviders } from '../utils'
const MyWorkBlock = (await import('../../features/home/components/MyWorkBlock')).default

const item = (over) => ({
    id: 'wi1', item_key: 'TASK-7', title: 'Sertifika yenile', item_type: 'task',
    priority: 'high', due_date: '2026-09-10', state_name: 'Pending', state_category: 'todo',
    project_id: 'p1', is_owner: true, ...over,
})
const group = (over) => ({
    project_id: 'p1', project_name: 'ATM', customer_name: 'Vakko', count: 1, items: [item()], ...over,
})
const EMPTY = { count: 0, groups: [] }
const base = {
    today: '2026-09-16', week_start: '2026-09-14', week_end: '2026-09-20',
    overdue: EMPTY, due_today: EMPTY, this_week: EMPTY,
}

beforeEach(() => {
    vi.clearAllMocks()
})

describe('Islerim blogu', () => {
    it('hicbir is yokken yalnizca "bugun" satiri, gecikmis/bu hafta yok', async () => {
        homeService.myWork.mockResolvedValue(base)
        renderWithProviders(<MyWorkBlock />)
        expect(await screen.findByText('Nothing due today.')).toBeInTheDocument()
        expect(screen.queryByText('Overdue')).toBeNull()
        expect(screen.queryByText('Later this week')).toBeNull()
        expect(document.querySelector('.ant-modal')).toBeNull()
    })

    it('kovalar proje gruplu, gecikmis sayaci kirmizi, satir /work/KEY', async () => {
        homeService.myWork.mockResolvedValue({
            ...base,
            overdue: { count: 2, groups: [group({ count: 2, items: [item(), item({ id: 'wi2', item_key: 'TASK-9', title: 'Log rotasyonu', priority: 'low' })] })] },
            due_today: { count: 1, groups: [group({ project_id: 'p2', project_name: 'Portal', customer_name: 'Beymen', items: [item({ id: 'wi3', item_key: 'ISSUE-3', title: 'Giris hatasi', due_date: '2026-09-16' })] })] },
            this_week: { count: 1, groups: [group({ project_id: 'p3', project_name: 'Ic proje', customer_name: null, items: [item({ id: 'wi4', item_key: 'TASK-11', title: 'Sprint plani', due_date: '2026-09-18' })] })] },
        })
        renderWithProviders(<MyWorkBlock />)

        const overdue = (await screen.findByText('Overdue')).closest('[data-bucket]')
        expect(overdue.dataset.bucket).toBe('overdue')
        const badge = within(overdue).getByTestId('home-bucket-count-overdue')
        expect(badge).toHaveTextContent('2')
        expect(badge.className).toContain('h-badge--danger')
        expect(within(overdue).getByText('Vakko · ATM')).toBeInTheDocument()

        const rows = within(overdue).getAllByRole('link')
        expect(rows.map((a) => a.getAttribute('href'))).toEqual(['/work/TASK-7', '/work/TASK-9'])
        expect(rows[0].closest('[data-due-tone]').dataset.dueTone).toBe('overdue')

        const today = screen.getByText('Due today').closest('[data-bucket]')
        expect(within(today).getByText('Beymen · Portal')).toBeInTheDocument()
        expect(within(today).getByRole('link', { name: /Giris hatasi/ }).closest('[data-due-tone]').dataset.dueTone).toBe('today')
        expect(screen.queryByText('Nothing due today.')).toBeNull()

        const week = screen.getByText('Later this week').closest('[data-bucket]')
        // Musterisi olmayan proje: yalnizca proje adi.
        expect(within(week).getByText('Ic proje')).toBeInTheDocument()
        expect(within(week).getByRole('link', { name: /Sprint plani/ }).closest('[data-due-tone]').dataset.dueTone).toBe('neutral')

        // Tum isler baglantisi is yuzeyine gider.
        expect(screen.getByRole('link', { name: 'All work items' })).toHaveAttribute('href', '/project-management')
    })

    it('uc hatasinda blok icinde sessiz satir, sayfa kirilmaz', async () => {
        homeService.myWork.mockRejectedValue(new Error('boom'))
        renderWithProviders(<MyWorkBlock />)
        expect(await screen.findByText('This block could not be loaded.')).toBeInTheDocument()
        expect(screen.getByText('My work')).toBeInTheDocument()
    })
})
