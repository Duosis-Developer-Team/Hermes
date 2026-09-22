/**
 * =============================================================================
 * PM rework P3.2 — "Takvimim" blogu (D4)
 * =============================================================================
 *   1. Uc kaynak tek seritte: toplanti, plan, termin — ayni gun kolonunda.
 *   2. Tiklama ilgili kaydi acar: /meetings?date= · /time-entry?week= ·
 *      /work/KEY.
 *   3. Hafta sonu yalnizca icerigi varsa; bos gun sessiz "Nothing planned".
 *   4. Bugun kolonu isaretli; termin satiri tek renkli sinyal tasir.
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { screen, within } from '@testing-library/react'

const homeService = { week: vi.fn() }
vi.mock('../../services/api', () => ({ homeService }))

import { renderWithProviders } from '../utils'
import { weekDaysToShow } from '../../features/home/model/home'
const WeekBlock = (await import('../../features/home/components/WeekBlock')).default

const day = (date, over = {}) => ({ date, is_today: false, meetings: [], plans: [], items: [], ...over })
const WEEK = {
    today: '2026-09-16', week_start: '2026-09-14', week_end: '2026-09-20',
    days: [
        day('2026-09-14'),
        day('2026-09-15', {
            plans: [{ id: 'pl1', assignment_id: 'as1', customer_name: 'Vakko', project_name: 'ATM', start_time: '09:00', end_time: '11:00', recurrence: 'one_time', status: 'accepted' }],
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
    it('gun kolonlari, uc kaynak ve baglantilar', async () => {
        homeService.week.mockResolvedValue(WEEK)
        renderWithProviders(<WeekBlock />)
        expect(screen.getByText('My calendar')).toBeInTheDocument()
        expect(await screen.findByText('14 Sep – 20 Sep')).toBeInTheDocument()

        const days = document.querySelectorAll('.home-week__day')
        // Pzt–Cum hep; Cumartesi bos → yok; Pazar dolu → var.
        expect([...days].map((d) => d.dataset.date)).toEqual([
            '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-20',
        ])
        expect(days[2].className).toContain('home-week__day--today')
        expect(within(days[0]).getByText('Nothing planned')).toBeInTheDocument()

        const tue = within(days[1])
        expect(tue.getByRole('link', { name: /Vakko · ATM/ })).toHaveAttribute('href', '/time-entry?week=2026-09-15')
        expect(tue.getByText('09:00–11:00')).toBeInTheDocument()

        const wed = within(days[2])
        expect(wed.getByRole('link', { name: /Standup/ })).toHaveAttribute('href', '/meetings?date=2026-09-16')
        const item = wed.getByRole('link', { name: /Sertifika yenile/ })
        expect(item).toHaveAttribute('href', '/work/TASK-7')
        expect(item.closest('[data-due-tone]').dataset.dueTone).toBe('today')
        expect([...days[2].querySelectorAll('[data-entry]')].map((e) => e.dataset.entry)).toEqual(['meeting', 'item'])

        expect(screen.getByRole('link', { name: 'Meetings' })).toHaveAttribute('href', '/meetings')
        expect(document.querySelector('.ant-modal')).toBeNull()
    })

    it('uc hatasinda blok basligi kalir, satir sessiz', async () => {
        homeService.week.mockRejectedValue(new Error('boom'))
        renderWithProviders(<WeekBlock />)
        expect(await screen.findByText('This block could not be loaded.')).toBeInTheDocument()
        expect(document.querySelectorAll('.home-week__day')).toHaveLength(0)
    })

    it('weekDaysToShow: hafta ici hep, hafta sonu icerikle', () => {
        expect(weekDaysToShow(null)).toEqual([])
        const out = weekDaysToShow({ days: [day('2026-09-18'), day('2026-09-19'), day('2026-09-20', { meetings: [{ id: 'x' }] })] })
        expect(out.map((d) => d.date)).toEqual(['2026-09-18', '2026-09-20'])
    })
})
