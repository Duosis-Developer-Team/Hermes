/**
 * =============================================================================
 * PM rework P3.1 — ana sayfa efor seridi (04-roller §4.1, §7)
 * =============================================================================
 *   1. Haftalik dolum: girilen / beklenen + yuzde; progressbar.
 *   2. Yalnizca calisma gunu kutulari; eksik gun sari nokta; kutu o gune
 *      giris acan baglantidir (/time-entry?date=).
 *   3. >=2 bos gun tek sari satir; 1 bos gunde satir yok (nokta yeter).
 *   4. Kapasite yaniti yokken serit sessiz (ne uyari ne modal).
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { screen, within } from '@testing-library/react'

const capacityService = { getWeek: vi.fn() }
vi.mock('../../services/api', () => ({ capacityService }))

import { renderWithProviders } from '../utils'
const EffortStrip = (await import('../../features/home/components/EffortStrip')).default

const day = (over) => ({
    date: '2026-09-14', weekday: 1, is_working_day: true, is_holiday: false, holiday_name: null,
    is_absent: false, absence_type: null, absence_id: null, expected_hours: '8.00',
    logged_hours: '0', status: 'missing', ...over,
})
const week = (days, over = {}) => ({
    user_id: 'u1', week_start: '2026-09-14', week_end: '2026-09-20', today: '2026-09-17',
    daily_expected_hours: '8', working_days: [1, 2, 3, 4, 5], expected_total: '40',
    logged_total: '13.5', fill_percent: 34, missing_days: [], days, ...over,
})

beforeEach(() => {
    vi.clearAllMocks()
})

describe('efor seridi', () => {
    it('dolum, gun kutulari, eksik nokta ve iki gun satiri', async () => {
        capacityService.getWeek.mockResolvedValue(week([
            day({ date: '2026-09-14', status: 'complete', logged_hours: '8' }),
            day({ date: '2026-09-15', status: 'missing' }),
            day({ date: '2026-09-16', status: 'missing' }),
            day({ date: '2026-09-17', status: 'today', logged_hours: '5.5' }),
            day({ date: '2026-09-18', status: 'future' }),
            day({ date: '2026-09-19', status: 'off', is_working_day: false }),
            day({ date: '2026-09-20', status: 'off', is_working_day: false }),
        ]))
        renderWithProviders(<EffortStrip />)

        expect(await screen.findByText('13.5h of 40h logged')).toBeInTheDocument()
        expect(screen.getByText('34%')).toBeInTheDocument()
        expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '34')
        expect(capacityService.getWeek).toHaveBeenCalledWith({ start: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })

        const boxes = screen.getAllByRole('listitem')
        expect(boxes).toHaveLength(5) // hafta sonu kutusu yok
        expect(boxes.map((b) => b.dataset.dayStatus)).toEqual(['complete', 'missing', 'missing', 'today', 'future'])
        expect(within(boxes[1]).getByRole('link')).toHaveAttribute('href', '/time-entry?date=2026-09-15')
        expect(boxes[1].querySelector('.home-effort__dot')).toBeTruthy()
        expect(boxes[0].querySelector('.home-effort__dot')).toBeNull()
        expect(boxes[3].querySelector('.home-effort__dot')).toBeNull() // bugun asla eksik degil

        expect(screen.getByRole('status')).toHaveTextContent('2 days without entries this week')
        expect(document.querySelector('.ant-modal')).toBeNull()
    })

    it('tek eksik gunde satir yok, nokta var; izinli gun etiketli', async () => {
        capacityService.getWeek.mockResolvedValue(week([
            day({ date: '2026-09-14', status: 'missing' }),
            day({ date: '2026-09-15', status: 'off', is_absent: true }),
            day({ date: '2026-09-16', status: 'complete', logged_hours: '8' }),
        ]))
        renderWithProviders(<EffortStrip />)
        const boxes = await screen.findAllByRole('listitem')
        expect(boxes[0].querySelector('.home-effort__dot')).toBeTruthy()
        expect(screen.queryByRole('status')).toBeNull()
        expect(within(boxes[1]).getByText('Leave')).toBeInTheDocument()
    })

    it('kapasite verisi yokken serit sessiz', async () => {
        capacityService.getWeek.mockRejectedValue(new Error('503'))
        renderWithProviders(<EffortStrip />)
        const strip = await screen.findByTestId('home-effort')
        expect(strip).toBeEmptyDOMElement()
        expect(screen.queryByRole('status')).toBeNull()
    })
})
