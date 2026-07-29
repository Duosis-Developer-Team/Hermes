/**
 * Sprint 4 — sure/tarih modeli: ay sonu, yil gecisi, timezone kaymasi.
 */
import { describe, expect, it } from 'vitest'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import {
    buildWeekDays, formatHours, logsForDay, sumHours,
} from '../../features/time-entry/model/timeEntry'
dayjs.extend(isoWeek)

describe('formatHours (mevcut davranis birebir)', () => {
    it.each([
        [2.5, '2h 30m'], [2, '2h'], [0, '0h'], [0.25, '0h 15m'],
        [8, '8h'], [7.75, '7h 45m'], [null, '0h'], [undefined, '0h'],
        ['3.5', '3h 30m'],
    ])('%s → %s', (input, expected) => {
        expect(formatHours(input)).toBe(expected)
    })

    it('bozuk deger 0h', () => expect(formatHours('abc')).toBe('0h'))
})

describe('sumHours', () => {
    it('toplar ve gecersizleri 0 sayar', () => {
        expect(sumHours([
            { duration_hours: 2.5 }, { duration_hours: '1.5' },
            { duration_hours: null }, {}, { duration_hours: 'x' },
        ])).toBe(4)
    })
    it('bos liste 0', () => expect(sumHours([])).toBe(0))
})

describe('buildWeekDays — ay/yil sinirlari', () => {
    it('7 gun uretir, pazartesi baslar', () => {
        const days = buildWeekDays('2026-07-29')
        expect(days).toHaveLength(7)
        expect(days[0].key).toBe('2026-07-27') // ISO pazartesi
        expect(days[6].key).toBe('2026-08-02')
    })

    it('AY SONU haftasi: gunler dogru aya ait isaretlenir', () => {
        const days = buildWeekDays('2026-07-29')
        expect(days.filter((d) => d.isOutsideStartMonth).map((d) => d.key))
            .toEqual(['2026-08-01', '2026-08-02'])
        expect(days[5].month).toBe(8)
        expect(days[5].dayOfMonth).toBe(1)
    })

    it('YIL GECISI haftasi dogru (2026-12-28 → 2027-01-03)', () => {
        const days = buildWeekDays('2026-12-30')
        expect(days[0].key).toBe('2026-12-28')
        expect(days[6].key).toBe('2027-01-03')
        expect(days[6].year).toBe(2027)
        expect(days[4].key).toBe('2027-01-01')
    })

    it('ARTIK YIL: 29 Subat kaybolmaz', () => {
        const days = buildWeekDays('2028-02-28')
        expect(days.map((d) => d.key)).toContain('2028-02-29')
    })

    it('hafta sonu ve bugun bayraklari', () => {
        const days = buildWeekDays('2026-07-29', '2026-07-29')
        expect(days.filter((d) => d.isWeekend).map((d) => d.key))
            .toEqual(['2026-08-01', '2026-08-02'])
        expect(days.filter((d) => d.isToday).map((d) => d.key))
            .toEqual(['2026-07-29'])
    })

    it('haftanin HERHANGI bir gunu ayni haftayi uretir (idempotent)', () => {
        const a = buildWeekDays('2026-07-27').map((d) => d.key)
        for (const day of ['2026-07-29', '2026-08-02'])
            expect(buildWeekDays(day).map((d) => d.key)).toEqual(a)
    })
})

describe('logsForDay — TIMEZONE KAYMASI YOK', () => {
    const logs = [
        { id: 1, date_worked: '2026-07-27' },
        { id: 2, date_worked: '2026-07-27T00:00:00Z' },      // gece yarisi UTC
        { id: 3, date_worked: '2026-07-27T23:30:00+03:00' }, // gun sonu TR
        { id: 4, date_worked: '2026-07-28' },
        { id: 5, date_worked: null },
    ]

    it('gece yarisi ve gun sonu kayitlari DOGRU gunde kalir', () => {
        expect(logsForDay(logs, '2026-07-27').map((l) => l.id)).toEqual([1, 2, 3])
        expect(logsForDay(logs, '2026-07-28').map((l) => l.id)).toEqual([4])
    })

    it('tarihsiz kayit hicbir gune dusmez', () => {
        expect(logsForDay(logs, '2026-07-29')).toEqual([])
    })

    it('ay sonu gunu bir sonraki aya KAYMAZ', () => {
        const l = [{ id: 9, date_worked: '2026-07-31T22:00:00Z' }]
        expect(logsForDay(l, '2026-07-31')).toHaveLength(1)
        expect(logsForDay(l, '2026-08-01')).toHaveLength(0)
    })
})
