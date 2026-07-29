/**
 * Characterization §4-4: query key builder deterministik olmali —
 * ayni mantiksal filtre, alan sirasi/undefined/Date bicimi fark
 * etmeksizin AYNI cache anahtarini uretir.
 */
import { describe, expect, it } from 'vitest'
import { queryKeys, stableFilters } from '../../query/queryKeys'

describe('stableFilters determinism', () => {
    it('alan sirasi anahtari degistirmez', () => {
        expect(stableFilters({ b: 1, a: 2 }))
            .toEqual(stableFilters({ a: 2, b: 1 }))
        expect(JSON.stringify(queryKeys.tasks.list({ b: 1, a: 2 })))
            .toBe(JSON.stringify(queryKeys.tasks.list({ a: 2, b: 1 })))
    })

    it('undefined ve bos string atilir', () => {
        expect(stableFilters({ a: 1, b: undefined, c: '' }))
            .toEqual({ a: 1 })
    })

    it('Date deterministik ISO olur', () => {
        const d = new Date('2026-07-29T10:00:00Z')
        expect(stableFilters({ from: d }).from)
            .toBe('2026-07-29T10:00:00.000Z')
    })

    it('null ve 0 KORUNUR (bilincli: gecerli filtre degerleri)', () => {
        expect(stableFilters({ a: 0, b: null })).toEqual({ a: 0, b: null })
    })
})
