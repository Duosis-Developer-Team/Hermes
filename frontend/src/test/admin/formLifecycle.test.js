/**
 * =============================================================================
 * Sprint 6B.2 — Admin form yasam dongusu yardimcilari
 * =============================================================================
 * `resetAndFill` + `pickFields`, "Edit A → Edit B'de bayat deger" ve
 * "API alanlari form store'una sizar" kusurlarini KAYNAKTA kapatir.
 * Saf fonksiyonlar oldugu icin dogrudan test edilir; davranissal kanit
 * ayrica gercek yuzeylerde (dictionaryCrud, usersLifecycle) surulur.
 * =============================================================================
 */
import { describe, expect, it, vi } from 'vitest'

import { pickFields, resetAndFill } from '../../features/admin/shared/formLifecycle'

describe('pickFields', () => {
    const SHAPE = { name: '', code: '', is_active: true }

    it('yalnizca BEKLENEN alanlari alir — id/created_at sizmaz', () => {
        const out = pickFields(
            { id: 'x1', name: 'Ada', code: 'ADA', is_active: false, created_at: 'z' },
            SHAPE
        )
        expect(out).toEqual({ name: 'Ada', code: 'ADA', is_active: false })
        expect(out).not.toHaveProperty('id')
        expect(out).not.toHaveProperty('created_at')
    })

    it('EKSIK alan acik bos degere cevrilir (bayat deger kalmaz)', () => {
        // Kritik: `undefined` dondurulurse setFieldsValue o alani HIC
        // yazmaz ve onceki kaydin degeri formda kalir.
        expect(pickFields({ name: 'Ada' }, SHAPE))
            .toEqual({ name: 'Ada', code: '', is_active: true })
    })

    it('null da eksik sayilir', () => {
        expect(pickFields({ name: null, code: null, is_active: null }, SHAPE))
            .toEqual({ name: '', code: '', is_active: true })
    })

    it('acik false ve 0 KORUNUR — bos sayilmaz', () => {
        const out = pickFields(
            { name: '', code: 'C', is_active: false },
            { name: 'FALLBACK', code: '', is_active: true }
        )
        expect(out.is_active).toBe(false)
        // Bos string GERCEK bir degerdir; fallback'e dusmez.
        expect(out.name).toBe('')
    })

    it('kayit yoksa tum alanlar fallback olur', () => {
        expect(pickFields(null, SHAPE)).toEqual({ name: '', code: '', is_active: true })
        expect(pickFields(undefined, SHAPE)).toEqual({ name: '', code: '', is_active: true })
    })

    it('bos sekil bos nesne dondurur', () => {
        expect(pickFields({ a: 1 }, {})).toEqual({})
    })
})

describe('resetAndFill', () => {
    const makeForm = () => ({ resetFields: vi.fn(), setFieldsValue: vi.fn() })

    it('DOLDURMADAN ONCE temizler — sira onemlidir', () => {
        const form = makeForm()
        const order = []
        form.resetFields.mockImplementation(() => order.push('reset'))
        form.setFieldsValue.mockImplementation(() => order.push('fill'))
        resetAndFill(form, { name: 'Ada' })
        // Ters sirada calisirsa bayat deger kusuru geri gelir.
        expect(order).toEqual(['reset', 'fill'])
    })

    it('deger yoksa yalnizca temizler (Create modu)', () => {
        const form = makeForm()
        resetAndFill(form, null)
        expect(form.resetFields).toHaveBeenCalledTimes(1)
        expect(form.setFieldsValue).not.toHaveBeenCalled()
    })

    it('form yoksa cokmez', () => {
        expect(() => resetAndFill(null, { name: 'x' })).not.toThrow()
        expect(() => resetAndFill(undefined, null)).not.toThrow()
    })
})
