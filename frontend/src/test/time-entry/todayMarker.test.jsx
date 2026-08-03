/**
 * =============================================================================
 * Premium UI — Bugun isareti (ORTAK primitive)
 * =============================================================================
 * KAPATILAN KUSUR: bugunun TUM sutunu griye boyaniyordu. Yeni sozlesme:
 *   - sutun zemini DEGISMEZ (tam-sutun boyama yasak — CSS kilidi),
 *   - gun basligi .h-today-flag (cift capraz cizgi) tasir,
 *   - aria-current="date" ile semantik isaret verilir,
 *   - kucuk "Today" etiketi renk korlugune karsi metinsel ipucudur.
 * Ayni primitive Meetings ve Timesheet basliklarinda da kullanilir.
 * =============================================================================
 */
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import DayColumn from '../../components/time-entry/DayColumn'

const renderDay = (props = {}) =>
    render(
        <DayColumn
            date="2026-08-04"
            workLogs={[]}
            planTimes={[]}
            onLogTime={vi.fn()}
            onSelectDay={vi.fn()}
            {...props}
        />
    )

describe('bugun isareti — davranis', () => {
    it('isToday: aria-current="date" + baslikta h-today-flag + Today etiketi', () => {
        const { container } = renderDay({ isToday: true })
        const col = container.querySelector('.day-column')
        expect(col.getAttribute('aria-current')).toBe('date')
        expect(container.querySelector('.day-column-name.h-today-flag')).toBeTruthy()
        expect(container.querySelector('.h-today-label')?.textContent).toBe('Today')
    })

    it('diger gunlerde isaret YOK', () => {
        const { container } = renderDay({ isToday: false })
        expect(container.querySelector('.day-column').getAttribute('aria-current')).toBeNull()
        expect(container.querySelector('.h-today-flag')).toBeNull()
        expect(container.querySelector('.h-today-label')).toBeNull()
    })
})

describe('bugun isareti — yapisal kilitler', () => {
    const read = (f) => readFileSync(join('src', f), 'utf8')
    const noComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')

    it('tam-sutun boyamasi geri gelmez (.day-column-today background yok)', () => {
        for (const f of [
            'components/time-entry/DayColumn.css',
            'components/time-entry/TimesheetView.css',
        ]) {
            const css = noComments(read(f))
            const m = css.match(/\.(day-column-today|timesheet-day-cell\.today)\s*\{[^}]*\}/g) || []
            for (const block of m) {
                expect(block, f).not.toMatch(/background/)
            }
        }
    })

    it('ortak primitive premium.css te tanimli (cift cizgi + etiket)', () => {
        const css = read('styles/premium.css')
        expect(css).toMatch(/\.h-today-flag::before/)
        expect(css).toMatch(/\.h-today-flag::after/)
        expect(css).toMatch(/\.h-today-label/)
    })

    it('Meetings ve Timesheet ayni primitive i kullanir', () => {
        expect(read('components/meetings/MeetingsWeeklyView.jsx')).toContain('h-today-flag')
        expect(read('components/time-entry/TimesheetView.jsx')).toContain('h-today-flag')
    })
})
