/**
 * =============================================================================
 * PM rework P0 / D2 — efor seridi ve eksik gun durtmesi
 * =============================================================================
 * Kilitlenen sozlesmeler (04-roller §4.1, §7):
 *   1. Kapasite verisi YOKSA eski davranis: "/ 8h", "/ 40h", uyari yok.
 *   2. 'missing' gun: sari isaret + iki eylem (efor gir / izin isaretle);
 *      modal yok, toast yok.
 *   3. 'today' ve 'future' eksik SAYILMAZ; 'off' gunlerde hedef cizilmez.
 *   4. Izinli gunde etiket; kaldirma yalniz izin verildiyse.
 *   5. WeekNavigator hedefi kapasiteden okur ve eksik gunleri tek satirda soyler.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import DayColumn from '../../components/time-entry/DayColumn'
import WeekNavigator from '../../features/time-entry/components/WeekNavigator'

const day = (over = {}) => ({
    date: '2026-09-14', weekday: 1, is_working_day: true, is_holiday: false,
    holiday_name: null, is_absent: false, absence_type: null, absence_id: null,
    expected_hours: '8.00', logged_hours: '0', status: 'missing', ...over,
})

const renderDay = (props = {}) => render(
    <DayColumn
        date="2026-09-14" workLogs={[]} planTimes={[]}
        onLogTime={vi.fn()} onSelectDay={vi.fn()} {...props}
    />,
)

describe('DayColumn — kapasite', () => {
    it('kapasite yokken eski davranis: 8h hedefi, uyari yok', () => {
        const { container } = renderDay()
        expect(container.querySelector('.day-column-hours').textContent).toContain('/ 8h')
        expect(container.querySelector('.day-column-missing')).toBeNull()
        expect(container.querySelector('.day-column-progress')).toBeTruthy()
    })

    it('missing: sari isaret + efor gir / izin isaretle eylemleri', () => {
        const onLogTime = vi.fn()
        const onMarkAbsence = vi.fn()
        const { container } = renderDay({
            capacity: day({ status: 'missing' }), onLogTime, onMarkAbsence,
        })
        expect(container.querySelector('.day-column-missing')).toBeTruthy()
        expect(container.querySelector('.day-column-missing-dot')).toBeTruthy()
        expect(container.querySelector('.day-column').dataset.dayStatus).toBe('missing')

        fireEvent.click(screen.getByRole('button', { name: 'Log Time' }))
        expect(onLogTime).toHaveBeenCalledTimes(1)
        fireEvent.click(screen.getByRole('button', { name: 'Mark leave' }))
        expect(onMarkAbsence).toHaveBeenCalledWith('2026-09-14')
        // Modal/toast yok: uyari kutunun icinde.
        expect(document.querySelector('.ant-modal')).toBeNull()
    })

    it('izin eylemi verilmemisse yalniz efor gir gorunur', () => {
        renderDay({ capacity: day({ status: 'missing' }) })
        expect(screen.queryByRole('button', { name: 'Mark leave' })).toBeNull()
        expect(screen.getByRole('button', { name: 'Log Time' })).toBeTruthy()
    })

    it.each(['today', 'future', 'partial', 'complete'])('%s eksik SAYILMAZ', (status) => {
        const { container } = renderDay({ capacity: day({ status }) })
        expect(container.querySelector('.day-column-missing')).toBeNull()
        expect(container.querySelector('.day-column-missing-hint')).toBeNull()
    })

    it('beklenen saat kapasiteden gelir (override 6h)', () => {
        const { container } = renderDay({ capacity: day({ status: 'future', expected_hours: '6.00' }) })
        expect(container.querySelector('.day-column-hours').textContent).toContain('/ 6h')
    })

    it('tatil: hedef ve ilerleme cizilmez, etiket gosterilir', () => {
        const { container } = renderDay({
            capacity: day({ status: 'off', expected_hours: '0', is_holiday: true, holiday_name: 'Bayram' }),
        })
        expect(container.querySelector('.day-column-progress')).toBeNull()
        expect(container.querySelector('.day-column-off-label').textContent).toBe('Holiday')
        expect(container.querySelector('.day-column-off-label').getAttribute('title')).toBe('Bayram')
        expect(container.querySelector('.day-column-missing')).toBeNull()
    })

    it('izinli gun: etiket var; kaldirma yalniz izin verildiyse', () => {
        const onRemoveAbsence = vi.fn()
        const cap = day({ status: 'off', expected_hours: '0', is_absent: true, absence_type: 'leave', absence_id: 'abs-1' })
        const first = renderDay({ capacity: cap })
        expect(first.container.querySelector('.day-column-absence')).toBeTruthy()
        expect(screen.queryByRole('button', { name: 'Remove leave' })).toBeNull()
        first.unmount()

        renderDay({ capacity: cap, onRemoveAbsence })
        fireEvent.click(screen.getByRole('button', { name: 'Remove leave' }))
        expect(onRemoveAbsence).toHaveBeenCalledWith('abs-1')
    })
})

describe('WeekNavigator — haftalik ozet', () => {
    const base = { weekLabel: '14 Sep - 20 Sep, 2026', totalLabel: '12h', onPrevious: vi.fn(), onNext: vi.fn(), onToday: vi.fn() }

    it('kapasite yokken "/ 40h" ve eksik satiri yok', () => {
        const { container } = render(<WeekNavigator {...base} />)
        expect(container.querySelector('.summary-target').textContent).toBe('/ 40h')
        expect(container.querySelector('.week-missing')).toBeNull()
    })

    it('hedef kapasiteden gelir, eksik gunler tek satirda', () => {
        const capacity = {
            expected_total: '32.00', logged_total: '12', fill_percent: 37,
            missing_days: ['2026-09-14', '2026-09-16'], days: [],
        }
        const { container } = render(<WeekNavigator {...base} capacity={capacity} />)
        expect(container.querySelector('.summary-target').textContent).toBe('/ 32h')
        expect(container.querySelector('.summary-fill').textContent).toBe('37% of expected')
        const line = screen.getByRole('status')
        expect(line.textContent).toContain('2 day(s) without entries')
        expect(line.textContent).toContain('Mon, Wed')
    })

    it('eksik gun yoksa satir cizilmez (tebrik tonu da yok)', () => {
        const { container } = render(<WeekNavigator {...base} capacity={{ expected_total: 40, fill_percent: 100, missing_days: [], days: [] }} />)
        expect(container.querySelector('.week-missing')).toBeNull()
        expect(container.textContent).not.toMatch(/congrat|tebrik/i)
    })
})
