/**
 * =============================================================================
 * PM rework P3.3 — "Ekibim" + "Dikkat gerektirenler" (D5)
 * =============================================================================
 *   1. eligible=false → blok HIC cizilmez (403 degil, sessiz).
 *   2. Kisi satirlari sunucu sirasinda (bekleyen ise gore); kirmizi yalniz
 *      gecikmede; efor girmemis kisi sari isaretli.
 *   3. Dikkat: sahipsiz (notr sayac), termini gecmis (kirmizi), efor
 *      girmemis (sari); hepsi bos ise blok yok.
 *   4. Kimlikler ada cevrilir; satirlar /work/KEY.
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { screen, within } from '@testing-library/react'

const homeService = { team: vi.fn() }
const authService = { lookupUsers: vi.fn() }
vi.mock('../../services/api', () => ({ homeService, authService }))

import { renderWithProviders } from '../utils'
const TeamBlock = (await import('../../features/home/components/TeamBlock')).default

const USERS = [
    { id: 'u2', full_name: 'Grace Hopper', email: 'grace@x.com' },
    { id: 'u3', full_name: 'Alan Turing', email: 'alan@x.com' },
]
const item = (over) => ({
    id: 'wi1', item_key: 'TASK-7', title: 'Sertifika yenile', item_type: 'task', priority: 'high',
    due_date: '2026-09-10', state_name: 'Pending', state_category: 'todo', project_id: 'p1',
    is_owner: false, owner_user_id: 'u3', customer_name: 'Vakko', project_name: 'ATM', days_overdue: 6, ...over,
})
const TEAM = {
    eligible: true, today: '2026-09-16', week_start: '2026-09-14', week_end: '2026-09-20',
    members: [
        { user_id: 'u3', open_count: 3, overdue_count: 2, logged_hours: '0', expected_hours: '40', missing_days: 2 },
        { user_id: 'u2', open_count: 2, overdue_count: 0, logged_hours: '8', expected_hours: '40', missing_days: 1 },
    ],
    attention: {
        unassigned_count: 1,
        unassigned: [item({ id: 'wi9', item_key: 'TASK-9', title: 'Sahipsiz is', owner_user_id: null, due_date: '2026-09-25', days_overdue: 0 })],
        overdue_count: 2,
        overdue: [item(), item({ id: 'wi2', item_key: 'ISSUE-3', title: 'Giris hatasi', owner_user_id: 'u2', days_overdue: 1 })],
        no_effort_user_ids: ['u3'],
    },
}

beforeEach(() => {
    vi.clearAllMocks()
    authService.lookupUsers.mockResolvedValue(USERS)
})

describe('Ekibim blogu', () => {
    it('eligible=false → hicbir sey cizilmez', async () => {
        homeService.team.mockResolvedValue({ ...TEAM, eligible: false, members: [] })
        const { container } = renderWithProviders(<TeamBlock />)
        await vi.waitFor(() => expect(homeService.team).toHaveBeenCalledTimes(1))
        await new Promise((r) => setTimeout(r, 20))
        expect(container.querySelector('[data-testid="home-team"]')).toBeNull()
    })

    it('kisi kuyrugu, isaretler ve dikkat gruplari', async () => {
        homeService.team.mockResolvedValue(TEAM)
        renderWithProviders(<TeamBlock />)
        expect(await screen.findByText('My team')).toBeInTheDocument()
        expect((await screen.findAllByText('Alan Turing')).length).toBeGreaterThan(0)

        const rows = document.querySelectorAll('.home-team__member')
        expect([...rows].map((r) => r.dataset.userId)).toEqual(['u3', 'u2'])   // sunucu sirasi korunur
        expect(rows[0].dataset.noEffort).toBe('true')
        expect(rows[1].dataset.noEffort).toBeUndefined()
        expect(rows[0].querySelector('.home-team__stat--danger')).toBeTruthy()
        expect(rows[1].querySelector('.home-team__stat--danger')).toBeNull()   // kirmizi yalniz gecikmede
        expect(within(rows[1]).getByText('8')).toBeInTheDocument()
        expect(within(rows[1]).getByText('/ 40h')).toBeInTheDocument()

        const attention = screen.getByTestId('home-attention')
        const unassigned = attention.querySelector('[data-attention="unassigned"]')
        expect(within(unassigned).getByRole('link', { name: /Sahipsiz is/ })).toHaveAttribute('href', '/work/TASK-9')
        expect(unassigned.querySelector('.h-badge--neutral')).toHaveTextContent('1')
        const overdue = attention.querySelector('[data-attention="overdue"]')
        expect(overdue.querySelector('.h-badge--danger')).toHaveTextContent('2')
        expect(within(overdue).getByText(/Vakko · ATM · Alan Turing · 6 days late/)).toBeInTheDocument()
        const noEffort = attention.querySelector('[data-attention="no-effort"]')
        expect(within(noEffort).getByText('Alan Turing')).toBeInTheDocument()
        expect(document.querySelector('.ant-modal')).toBeNull()
    })

    it('dikkat gerektiren yoksa ikinci blok yok; ekip bos ise sessiz satir', async () => {
        homeService.team.mockResolvedValue({
            ...TEAM, members: [],
            attention: { unassigned_count: 0, unassigned: [], overdue_count: 0, overdue: [], no_effort_user_ids: [] },
        })
        renderWithProviders(<TeamBlock />)
        expect(await screen.findByText('No one is routed to you yet.')).toBeInTheDocument()
        expect(screen.queryByTestId('home-attention')).toBeNull()
    })
})
