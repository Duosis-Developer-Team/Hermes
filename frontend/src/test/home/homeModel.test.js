/**
 * =============================================================================
 * PM rework P3.1 — ana sayfa modeli (saf)
 * =============================================================================
 * Kilitlenen sozlesmeler (04-roller §4.1, §4.2, §9.1 / E4):
 *   1. dueTone: gecikmis | bugun | notr — terminsiz ve gecersiz tarih notr.
 *   2. visibleBuckets: gecikmis ve bu hafta BOSSA yok; bugun hep var.
 *   3. effortSummary: yalnizca calisma gunleri; eksik gun sayisi; kapasite
 *      yoksa null (serit sessiz).
 * =============================================================================
 */
import { describe, expect, it } from 'vitest'

import {
    dueTone, effortSummary, formatHours, groupLabel, mondayOf, visibleBuckets,
} from '../../features/home/model/home'

const TODAY = '2026-09-16'

describe('dueTone (E4 tek renkli sinyal)', () => {
    it('gecikmis / bugun / notr', () => {
        expect(dueTone('2026-09-10', TODAY)).toBe('overdue')
        expect(dueTone('2026-09-16', TODAY)).toBe('today')
        expect(dueTone('2026-09-18', TODAY)).toBe('neutral')
    })
    it('terminsiz veya bozuk tarih notr', () => {
        expect(dueTone(null, TODAY)).toBe('neutral')
        expect(dueTone('not-a-date', TODAY)).toBe('neutral')
    })
})

describe('visibleBuckets', () => {
    const empty = { count: 0, groups: [] }
    it('bos gecikmis ve bu hafta kaybolur, bugun kalir', () => {
        const out = visibleBuckets({ overdue: empty, due_today: empty, this_week: empty })
        expect(out.map((b) => b.key)).toEqual(['due_today'])
    })
    it('dolu kovalar sabit sirada', () => {
        const one = { count: 1, groups: [{ project_id: 'p', project_name: 'ATM', count: 1, items: [] }] }
        const out = visibleBuckets({ overdue: one, due_today: empty, this_week: one })
        expect(out.map((b) => b.key)).toEqual(['overdue', 'due_today', 'this_week'])
    })
    it('veri yokken bos', () => {
        expect(visibleBuckets(null)).toEqual([])
    })
})

describe('groupLabel', () => {
    it('Musteri · Proje; musteri yoksa yalniz proje', () => {
        expect(groupLabel({ customer_name: 'Vakko', project_name: 'ATM' })).toBe('Vakko · ATM')
        expect(groupLabel({ customer_name: null, project_name: 'ATM' })).toBe('ATM')
    })
})

describe('effortSummary', () => {
    const day = (over) => ({
        date: '2026-09-14', weekday: 1, is_working_day: true, is_holiday: false,
        holiday_name: null, is_absent: false, expected_hours: '8', logged_hours: '0',
        status: 'missing', ...over,
    })
    it('kapasite yoksa null', () => {
        expect(effortSummary(null)).toBeNull()
    })
    it('calisma gunleri, eksik sayisi ve dolum', () => {
        const out = effortSummary({
            expected_total: '40', logged_total: '12.5', fill_percent: 31,
            days: [
                day({ date: '2026-09-14', status: 'missing' }),
                day({ date: '2026-09-15', status: 'missing' }),
                day({ date: '2026-09-16', status: 'today', logged_hours: '4.5' }),
                day({ date: '2026-09-17', status: 'future' }),
                day({ date: '2026-09-18', status: 'off', is_absent: true }),
                day({ date: '2026-09-19', status: 'off', is_working_day: false }),
            ],
        })
        expect(out.expected).toBe(40)
        expect(out.logged).toBe(12.5)
        expect(out.fillPercent).toBe(31)
        expect(out.missingCount).toBe(2)
        expect(out.days).toHaveLength(5)
        expect(out.days[4]).toMatchObject({ off: true, absent: true })
    })
    it('sunucu yuzde vermezse hesaplar', () => {
        expect(effortSummary({ expected_total: '40', logged_total: '10', days: [] }).fillPercent).toBe(25)
        expect(effortSummary({ expected_total: '0', logged_total: '0', days: [] }).fillPercent).toBeNull()
    })
})

describe('yardimcilar', () => {
    it('mondayOf ISO haftanin Pazartesi', () => {
        expect(mondayOf('2026-09-16')).toBe('2026-09-14')
        expect(mondayOf('2026-09-20')).toBe('2026-09-14')
    })
    it('formatHours tam sayiyi kisa, ondaligi tek basamak yazar', () => {
        expect(formatHours('8.00')).toBe('8')
        expect(formatHours(7.5)).toBe('7.5')
        expect(formatHours('x')).toBe('0')
    })
})
