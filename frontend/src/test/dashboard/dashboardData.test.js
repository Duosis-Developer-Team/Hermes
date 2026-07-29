/**
 * =============================================================================
 * Sprint 6A — Dashboard veri adaptoru
 * =============================================================================
 * Kilitlenen iki gercek kusur (sayfa govdesinde sessizce yanlisti):
 *   1. `Number(item.hours)` sayisal olmayan degeri NaN yapip grafige
 *      gonderiyordu,
 *   2. cozulemeyen kullanici kimligi HAM UUID olarak ekranda kaliyordu.
 * =============================================================================
 */
import { describe, expect, it } from 'vitest'

import {
    chartState, dashboardSummary, formatDuration, resolveUserNames,
    toChartSeries,
} from '../../features/dashboard/model/dashboardData'

describe('formatDuration', () => {
    it('ondalik saati saat+dakikaya cevirir', () => {
        expect(formatDuration(0.75)).toBe('0h 45m')
        expect(formatDuration(2.75)).toBe('2h 45m')
        expect(formatDuration(2)).toBe('2h')
        expect(formatDuration(2.0)).toBe('2h')
    })

    it('60 dakikaya YUVARLANAN deger saate tasar ("1h 60m" olmaz)', () => {
        expect(formatDuration(1.999)).toBe('2h')
        expect(formatDuration(0.9999)).toBe('1h')
    })

    it('gecersiz/eksik/negatif girdi "0h" verir — ASLA NaN', () => {
        for (const bad of [undefined, null, '', 'abc', NaN, Infinity, -3, 0]) {
            expect(formatDuration(bad), String(bad)).toBe('0h')
        }
    })

    it('sayisal string kabul edilir (API bazen string doner)', () => {
        expect(formatDuration('2.5')).toBe('2h 30m')
    })
})

describe('toChartSeries', () => {
    it('hours SAYIYA cevrilir', () => {
        expect(toChartSeries([{ name: 'A', hours: '3.5' }]))
            .toEqual([{ name: 'A', hours: 3.5 }])
    })

    it('sayiya cevrilemeyen satir ATILIR (NaN grafige gitmez)', () => {
        const out = toChartSeries([
            { name: 'A', hours: 2 },
            { name: 'B', hours: 'yok' },
            { name: 'C', hours: null },
            { name: 'D', hours: undefined },
        ])
        expect(out.map((r) => r.name)).toEqual(['A'])
        expect(out.every((r) => Number.isFinite(r.hours))).toBe(true)
    })

    it('etiketsiz satir ATILIR (eksende bos cubuk olusmaz)', () => {
        expect(toChartSeries([{ name: '', hours: 5 }, { hours: 5 }])).toEqual([])
    })

    it('sifir saat KORUNUR — "veri yok" ile ayni sey degildir', () => {
        expect(toChartSeries([{ name: 'A', hours: 0 }]))
            .toEqual([{ name: 'A', hours: 0 }])
    })

    it('limit uygulanir, dizi olmayan girdi bos doner', () => {
        const rows = [1, 2, 3, 4].map((i) => ({ name: `n${i}`, hours: i }))
        expect(toChartSeries(rows, { limit: 2 }).map((r) => r.name))
            .toEqual(['n1', 'n2'])
        expect(toChartSeries(null)).toEqual([])
        expect(toChartSeries(undefined)).toEqual([])
    })
})

describe('resolveUserNames', () => {
    const USERS = [
        { id: 'u1', full_name: 'Ada Lovelace', email: 'ada@x.com' },
        { id: 'u2', email: 'grace@x.com' },
    ]

    it('kullanici kimligi goruntulenen ADA cevrilir', () => {
        expect(resolveUserNames([{ name: 'u1', hours: 4 }], USERS))
            .toEqual([{ name: 'Ada Lovelace', hours: 4 }])
    })

    it('adi yoksa e-postaya duser', () => {
        expect(resolveUserNames([{ name: 'u2', hours: 1 }], USERS)[0].name)
            .toBe('grace@x.com')
    })

    it('HAM UUID SIZMAZ — cozulemeyen kimlik notr tire olur', () => {
        const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
        const out = resolveUserNames([{ name: uuid, hours: 2 }], USERS)
        expect(out[0].name).toBe('—')
        expect(JSON.stringify(out)).not.toContain(uuid)
    })

    it('kullanici listesi yoksa bile UUID gostermez', () => {
        expect(resolveUserNames([{ name: 'u1', hours: 2 }], null)[0].name).toBe('—')
        expect(resolveUserNames([{ name: 'u1', hours: 2 }], undefined)[0].name).toBe('—')
    })

    it('gecersiz saat degerleri ATILIR', () => {
        expect(resolveUserNames([{ name: 'u1', hours: 'yok' }], USERS)).toEqual([])
    })
})

describe('dashboardSummary', () => {
    it('eksik yanit TAMAMEN sifir doner (kart geometrisi korunur)', () => {
        expect(dashboardSummary(undefined, undefined)).toEqual({
            totalHours: '0h', customerCount: 0, projectCount: 0, memberCount: 0,
        })
    })

    it('sayimlar ve toplam sure dogru', () => {
        const s = dashboardSummary(
            { total_hours: 12.5, by_customer: [1, 2], by_project: [1, 2, 3] },
            [1, 2, 3, 4]
        )
        expect(s).toEqual({
            totalHours: '12h 30m', customerCount: 2, projectCount: 3, memberCount: 4,
        })
    })

    it('dizi olmayan alanlar sayima 0 katar', () => {
        const s = dashboardSummary({ by_customer: 'bozuk', by_project: null }, null)
        expect(s.customerCount).toBe(0)
        expect(s.projectCount).toBe(0)
        expect(s.memberCount).toBe(0)
    })
})

describe('chartState', () => {
    it('bos veri "empty"', () => {
        expect(chartState([])).toBe('empty')
        expect(chartState(null)).toBe('empty')
    })

    it('hepsi sifir saat "insufficient" — bos ile AYNI SEY DEGIL', () => {
        expect(chartState([{ name: 'A', hours: 0 }])).toBe('insufficient')
    })

    it('gercek veri "ready"', () => {
        expect(chartState([{ name: 'A', hours: 0 }, { name: 'B', hours: 3 }]))
            .toBe('ready')
    })
})
