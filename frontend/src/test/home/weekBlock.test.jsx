/**
 * =============================================================================
 * PM rework P3.2 — "Takvimim" blogu (D4)
 * =============================================================================
 *   1. Iki kaynak tek seritte: toplanti, termin — ayni gun kolonunda
 *      (Plan Time 29.09'da kaldirildi).
 *   2. Tiklama ilgili kaydi acar: /meetings?date= · /time-entry?week= ·
 *      /work/KEY.
 *   3. TEK GUN (CTO 29.09): gun cipleri secilir, varsayilan bugun; altta
 *      yalniz secili gun. Bugun bos ise "Nothing planned"; bugun bu
 *      haftada degil ve hafta bossa tek satir.
 *   4. Bugun satiri isaretli; termin satiri tek renkli sinyal tasir.
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'

const homeService = { week: vi.fn() }
vi.mock('../../services/api', () => ({ homeService }))

import { renderWithProviders } from '../utils'
import { weekDaysToShow } from '../../features/home/model/home'
const WeekBlock = (await import('../../features/home/components/WeekBlock')).default

const day = (date, over = {}) => ({ date, is_today: false, meetings: [], items: [], ...over })
const WEEK = {
    today: '2026-09-16', week_start: '2026-09-14', week_end: '2026-09-20',
    days: [
        day('2026-09-14'),
        day('2026-09-15', {
            meetings: [{ id: 'm0', subject: 'Vakko · ATM kickoff', start_datetime: '2026-09-15T06:00:00Z', end_datetime: '2026-09-15T07:00:00Z', is_online_meeting: true, join_url: null }],
        }),
        day('2026-09-16', {
            is_today: true,
            meetings: [{ id: 'm1', subject: 'Standup', start_datetime: '2026-09-16T06:30:00Z', end_datetime: '2026-09-16T07:00:00Z', is_online_meeting: true, join_url: null }],
            items: [{ id: 'wi1', item_key: 'TASK-7', title: 'Sertifika yenile', item_type: 'task', priority: 'high', due_date: '2026-09-16', state_name: 'Pending', state_category: 'todo', project_id: 'p1', is_owner: true }],
        }),
        day('2026-09-17'),
        day('2026-09-18'),
        day('2026-09-19'),
        day('2026-09-20', {
            items: [{ id: 'wi2', item_key: 'TASK-9', title: 'Pazar isi', item_type: 'task', priority: 'low', due_date: '2026-09-20', state_name: 'Pending', state_category: 'todo', project_id: 'p1', is_owner: true }],
        }),
    ],
}

beforeEach(() => {
    vi.clearAllMocks()
})

describe('Takvimim blogu', () => {
    it('gun kolonlari, iki kaynak ve baglantilar', async () => {
        homeService.week.mockResolvedValue(WEEK)
        renderWithProviders(<WeekBlock />)
        expect(screen.getByText('My calendar')).toBeInTheDocument()
        expect(await screen.findByText('14 Sep – 20 Sep')).toBeInTheDocument()

        // Cipler: hafta ici + icerikli hafta sonu (Paz); bos Cmt yok.
        const chips = [...document.querySelectorAll('.home-week__chip')]
        expect(chips.map((c) => c.dataset.date)).toEqual([
            '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-20',
        ])
        // Varsayilan: yalniz bugun (Car) gosterilir ve secili.
        let days = document.querySelectorAll('.home-week__day')
        expect([...days].map((d) => d.dataset.date)).toEqual(['2026-09-16'])
        expect(days[0].className).toContain('home-week__day--today')
        expect(chips[2]).toHaveAttribute('aria-pressed', 'true')
        expect(screen.queryByText('Nothing planned')).toBeNull()
        const wed = within(days[0])
        expect(wed.getByRole('link', { name: /Standup/ })).toHaveAttribute('href', '/meetings?date=2026-09-16')
        const item = wed.getByRole('link', { name: /Sertifika yenile/ })
        expect(item).toHaveAttribute('href', '/work/TASK-7')
        expect(item.closest('[data-due-tone]').dataset.dueTone).toBe('today')
        expect([...days[0].querySelectorAll('[data-entry]')].map((e) => e.dataset.entry)).toEqual(['meeting', 'item'])
        expect(screen.queryByRole('link', { name: /Vakko · ATM kickoff/ })).toBeNull()
        // Sal cipi → yalniz Sal.
        fireEvent.click(chips[1])
        days = document.querySelectorAll('.home-week__day')
        expect([...days].map((d) => d.dataset.date)).toEqual(['2026-09-15'])
        expect(chips[1]).toHaveAttribute('aria-pressed', 'true')
        expect(within(days[0]).getByRole('link', { name: /Vakko · ATM kickoff/ })).toHaveAttribute('href', '/meetings?date=2026-09-15')
        expect(screen.queryByRole('link', { name: /Standup/ })).toBeNull()
        // Bos gun secilirse "Nothing planned".
        fireEvent.click(chips[3])
        expect(screen.getByText('Nothing planned')).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Meetings' })).toHaveAttribute('href', '/meetings')
        expect(document.querySelector('.ant-modal')).toBeNull()
    })

    it('uc hatasinda blok basligi kalir, satir sessiz', async () => {
        homeService.week.mockRejectedValue(new Error('boom'))
        renderWithProviders(<WeekBlock />)
        expect(await screen.findByText('This block could not be loaded.')).toBeInTheDocument()
        expect(document.querySelectorAll('.home-week__day')).toHaveLength(0)
    })

    it('weekDaysToShow: yalniz dolu gunler + bugun', () => {
        expect(weekDaysToShow(null)).toEqual([])
        const out = weekDaysToShow({ days: [
            day('2026-09-17', { is_today: true }), day('2026-09-18'), day('2026-09-19'),
            day('2026-09-20', { meetings: [{ id: 'x' }] }),
        ] })
        expect(out.map((d) => d.date)).toEqual(['2026-09-17', '2026-09-20'])
    })

    it('bugun bos: "Nothing planned"; haftada hicbir sey yok: tek satir', async () => {
        homeService.week.mockResolvedValue({ ...WEEK, days: [day('2026-09-14'), day('2026-09-16', { is_today: true })] })
        renderWithProviders(<WeekBlock />)
        expect(await screen.findByText('Nothing planned')).toBeInTheDocument()
        expect(document.querySelectorAll('.home-week__day')).toHaveLength(1)
        cleanup()
        homeService.week.mockResolvedValue({ ...WEEK, days: [day('2026-09-14'), day('2026-09-15')] })
        renderWithProviders(<WeekBlock />)
        expect(await screen.findByText('Nothing planned this week.')).toBeInTheDocument()
        expect(document.querySelectorAll('.home-week__day')).toHaveLength(0)
    })
})
