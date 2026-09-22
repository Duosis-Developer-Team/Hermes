/**
 * =============================================================================
 * Is akisi durumlari → pano sutunlari (PM rework P1) — saf kilitler
 * =============================================================================
 * Sutun kumesi ve sirasi sabittir; sunucu durumu yalniz ILISTIRILIR.
 * Bos/gecersiz liste → eski uc sutun (pano asla bos kalmaz).
 * =============================================================================
 */
import { describe, expect, it } from 'vitest'
import {
    FALLBACK_COLUMNS, boardColumnsOf,
} from '../../features/tasks/hooks/useWorkflowStates'

const state = (over) => ({
    id: 'st', name: 'X', category: 'todo', position: 0, is_default: false,
    is_active: true, legacy_status: 'pending', ...over,
})

describe('boardColumnsOf', () => {
    it('bos/gecersiz girdi → fallback uc sutun', () => {
        expect(boardColumnsOf([])).toBe(FALLBACK_COLUMNS)
        expect(boardColumnsOf(null)).toBe(FALLBACK_COLUMNS)
        expect(FALLBACK_COLUMNS.map((c) => c.status))
            .toEqual(['pending', 'in_progress', 'completed'])
    })

    it('sunucu durumlari sutunlara ILISTIRILIR; sira ve anahtarlar degismez', () => {
        const cols = boardColumnsOf([
            state({ id: 'done', name: 'Completed', category: 'done', position: 3, legacy_status: 'completed' }),
            state({ id: 'todo', name: 'Pending', category: 'todo', position: 1 }),
            state({ id: 'prog', name: 'In Progress', category: 'in_progress', position: 2, legacy_status: 'in_progress' }),
            state({ id: 'canc', name: 'Cancelled', category: 'cancelled', position: 4, legacy_status: 'cancelled' }),
        ])
        expect(cols.map((c) => c.status)).toEqual(['pending', 'in_progress', 'completed'])
        expect(cols.map((c) => c.stateId)).toEqual(['todo', 'prog', 'done'])
        expect(cols.map((c) => c.labelKey)).toEqual(FALLBACK_COLUMNS.map((c) => c.labelKey))
    })

    it('pasif durum ilistirilmez; eksik sutun fallback ile tamamlanir', () => {
        const cols = boardColumnsOf([
            state({ id: 'old', name: 'Old', is_active: false }),
            state({ id: 'prog', category: 'in_progress', legacy_status: 'in_progress' }),
        ])
        expect(cols[0].stateId).toBeNull()
        expect(cols[1].stateId).toBe('prog')
        expect(cols[2].stateId).toBeNull()
        expect(cols).toHaveLength(3)
    })

    it('ayni legacy durumda birden fazla durum varsa POZISYONU kucuk olan ilistirilir', () => {
        const cols = boardColumnsOf([
            state({ id: 'b', position: 5 }),
            state({ id: 'a', position: 1 }),
        ])
        expect(cols[0].stateId).toBe('a')
    })
})
