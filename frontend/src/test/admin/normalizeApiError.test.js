/**
 * =============================================================================
 * Sprint 6B.2 — Ortak Admin hata modeli
 * =============================================================================
 * Kapatilan gercek kusur: sozluk CRUD sayfalari hatayi
 * `err.response?.data?.detail || 'Error'` ile ele aliyordu. Sonuc,
 * kullaniciya hicbir sey anlatmayan "Error" metni, ham backend
 * icerigi ve alan hatalarinin forma HIC baglanmamasiydi.
 * =============================================================================
 */
import { describe, expect, it, vi } from 'vitest'

import {
    applyErrorToForm, normalizeApiError,
} from '../../features/admin/shared/normalizeApiError'

const httpError = (status, data) => ({ response: { status, data } })

describe('HTTP durumu → anlamli sonuc', () => {
    it('response YOKSA network hatasi ve RETRY edilebilir', () => {
        const r = normalizeApiError(new Error('Network Error'))
        expect(r.kind).toBe('network')
        expect(r.retryable).toBe(true)
        expect(r.message).toMatch(/Cannot reach the server/)
    })

    it('409 → conflict, retry EDILEMEZ', () => {
        const r = normalizeApiError(httpError(409, {}))
        expect(r.kind).toBe('conflict')
        expect(r.retryable).toBe(false)
    })

    it('401/403 → authorization', () => {
        expect(normalizeApiError(httpError(401, {})).kind).toBe('authorization')
        expect(normalizeApiError(httpError(403, {})).kind).toBe('authorization')
    })

    it('404 → missing (kayit artik yok)', () => {
        expect(normalizeApiError(httpError(404, {})).message)
            .toMatch(/no longer exists/)
    })

    it('5xx → server, RETRY edilebilir', () => {
        const r = normalizeApiError(httpError(503, {}))
        expect(r.kind).toBe('server')
        expect(r.retryable).toBe(true)
    })

    it('bilinmeyen durum sessizce yutulmaz', () => {
        expect(normalizeApiError(httpError(418, {})).kind).toBe('unknown')
    })
})

describe('sunucu mesaji vs generic metin', () => {
    it('domain’e ozel catisma mesaji KAYBOLMAZ', () => {
        const r = normalizeApiError(
            httpError(409, { detail: 'A work line with this code already exists.' })
        )
        expect(r.message).toBe('A work line with this code already exists.')
    })

    it('sunucu mesaji yoksa generic metin kullanilir — "Error" DEGIL', () => {
        const r = normalizeApiError(httpError(409, {}))
        expect(r.message).not.toBe('Error')
        expect(r.message.length).toBeGreaterThan(10)
    })

    it('TEKNIK icerik kullaniciya GOSTERILMEZ', () => {
        for (const technical of [
            'Traceback (most recent call last): File "x.py"',
            '<!DOCTYPE html><html><body>500</body></html>',
            'sqlalchemy.exc.IntegrityError: duplicate key',
            'x'.repeat(400),
        ]) {
            const r = normalizeApiError(httpError(400, { detail: technical }))
            expect(r.message).not.toContain('Traceback')
            expect(r.message).not.toContain('<!DOCTYPE')
            expect(r.message).not.toContain('sqlalchemy')
            expect(r.message.length).toBeLessThan(200)
        }
    })

    it('5xx govdesi ASLA gosterilmez (teknik olmasa bile)', () => {
        const r = normalizeApiError(httpError(500, { detail: 'boom in worker 3' }))
        expect(r.message).not.toContain('worker 3')
    })
})

describe('422 alan hatalari', () => {
    it('FastAPI loc dizisinden alan adi cikarilir', () => {
        const r = normalizeApiError(httpError(422, {
            detail: [
                { loc: ['body', 'name'], msg: 'field required' },
                { loc: ['body', 'code'], msg: 'too short' },
            ],
        }))
        expect(r.kind).toBe('validation')
        expect(r.fieldErrors).toEqual({ name: 'field required', code: 'too short' })
    })

    it('ayni alanin ILK mesaji tutulur', () => {
        const r = normalizeApiError(httpError(422, {
            detail: [
                { loc: ['body', 'name'], msg: 'first' },
                { loc: ['body', 'name'], msg: 'second' },
            ],
        }))
        expect(r.fieldErrors.name).toBe('first')
    })

    it('bozuk/eksik detail cokmez', () => {
        expect(normalizeApiError(httpError(422, { detail: 'plain text' })).fieldErrors)
            .toEqual({})
        expect(normalizeApiError(httpError(422, {})).fieldErrors).toEqual({})
        expect(normalizeApiError(httpError(422, { detail: [{}] })).fieldErrors)
            .toEqual({})
    })

    it('400 de alan hatasi tasiyabilir', () => {
        const r = normalizeApiError(httpError(400, {
            detail: [{ loc: ['body', 'code'], msg: 'bad code' }],
        }))
        expect(r.fieldErrors).toEqual({ code: 'bad code' })
    })
})

describe('applyErrorToForm', () => {
    const makeForm = () => ({ setFields: vi.fn() })

    it('alan hatalari FORMA baglanir', () => {
        const form = makeForm()
        const leftover = applyErrorToForm(
            httpError(422, { detail: [{ loc: ['body', 'name'], msg: 'required' }] }),
            form, ['name', 'code']
        )
        expect(form.setFields).toHaveBeenCalledWith([
            { name: 'name', errors: ['required'] },
        ])
        // Tumu baglandi → form seviyesinde ek mesaj yok.
        expect(leftover).toBeNull()
    })

    it('BILINMEYEN alan forma baglanmaz, mesaj geri doner (yutulmaz)', () => {
        const form = makeForm()
        const leftover = applyErrorToForm(
            httpError(422, {
                detail: [{ loc: ['body', 'secret_internal'], msg: 'nope' }],
            }),
            form, ['name', 'code']
        )
        expect(form.setFields).not.toHaveBeenCalled()
        expect(leftover).toBeTruthy()
    })

    it('alan hatasi olmayan hata form seviyesinde gosterilir', () => {
        const form = makeForm()
        const leftover = applyErrorToForm(httpError(409, { detail: 'Duplicate.' }), form)
        expect(form.setFields).not.toHaveBeenCalled()
        expect(leftover).toBe('Duplicate.')
    })

    it('form verilmese bile cokmez', () => {
        expect(applyErrorToForm(httpError(409, {}), null)).toBeTruthy()
    })

    it('kismen baglanabilen hatada kalan mesaj yine gosterilir', () => {
        const form = makeForm()
        const leftover = applyErrorToForm(
            httpError(422, {
                detail: [
                    { loc: ['body', 'name'], msg: 'required' },
                    { loc: ['body', 'unknown_field'], msg: 'weird' },
                ],
            }),
            form, ['name']
        )
        expect(form.setFields).toHaveBeenCalled()
        expect(leftover).toBeTruthy()
    })
})
