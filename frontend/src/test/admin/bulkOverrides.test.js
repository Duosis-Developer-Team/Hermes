/**
 * =============================================================================
 * Sprint 6B.1 — Toplu override surucusu
 * =============================================================================
 * Kilitlenen sozlesme: uye override ucu TEK UYELIKtir, yani N uye = N
 * istek ve islem ATOMIK DEGILDIR. Arayuz atomikmis gibi davranamaz —
 * her uyenin gercek sonucu korunur, kismi basari asla tam basari
 * sayilmaz ve yalnizca basarisizlar yeniden denenir.
 * =============================================================================
 */
import { describe, expect, it, vi } from 'vitest'

import {
    errorText, failedTargets, runBulkOverrides,
} from '../../features/admin/permissions/model/bulkOverrides'
import { classifyBulkResult } from '../../features/admin/permissions/model/effectivePermission'

const members = (...ids) => ids.map((id) => ({ user_id: id }))
const DATA = { can_access_tasks_override: true }

describe('ilerleme bildirimi', () => {
    it('BASLAMADAN once hedef sayisi bilinir', async () => {
        const seen = []
        await runBulkOverrides({
            targets: members('a', 'b', 'c'),
            apply: vi.fn().mockResolvedValue(undefined),
            data: DATA,
            onProgress: (p) => seen.push({ ...p }),
        })
        expect(seen[0]).toEqual({ total: 3, completed: 0, succeeded: 0, failed: 0 })
    })

    it('her adimda tamamlanan/basarili/basarisiz sayilari artar', async () => {
        const seen = []
        const apply = vi.fn()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('nope'))
            .mockResolvedValueOnce(undefined)
        await runBulkOverrides({
            targets: members('a', 'b', 'c'), apply, data: DATA,
            onProgress: (p) => seen.push({ ...p }),
        })
        expect(seen.at(-1)).toEqual({ total: 3, completed: 3, succeeded: 2, failed: 1 })
        expect(seen.map((p) => p.completed)).toEqual([0, 1, 2, 3])
    })

    it('BOS hedef listesi calistirilir ama hicbir istek atilmaz', async () => {
        const apply = vi.fn()
        const seen = []
        const { results } = await runBulkOverrides({
            targets: [], apply, data: DATA, onProgress: (p) => seen.push({ ...p }),
        })
        expect(apply).not.toHaveBeenCalled()
        expect(results).toEqual([])
        // Bos liste "empty" olarak siniflanir → basari toast'i URETMEZ.
        expect(classifyBulkResult(results).kind).toBe('empty')
        expect(seen[0].total).toBe(0)
    })
})

describe('istekler SIRAYLA gider', () => {
    it('bir sonraki istek oncekinin bitmesini bekler', async () => {
        const order = []
        const apply = vi.fn(async ({ userId }) => {
            order.push('start:' + userId)
            await new Promise((r) => setTimeout(r, 5))
            order.push('end:' + userId)
        })
        await runBulkOverrides({ targets: members('a', 'b'), apply, data: DATA })
        expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b'])
    })

    it('her uyeye AYNI yama, DOGRU kimlikle gonderilir', async () => {
        const apply = vi.fn().mockResolvedValue(undefined)
        await runBulkOverrides({ targets: members('a', 'b'), apply, data: DATA })
        expect(apply.mock.calls.map((c) => c[0])).toEqual([
            { userId: 'a', data: DATA },
            { userId: 'b', data: DATA },
        ])
    })
})

describe('kismi basarisizlik', () => {
    it('bir uyenin hatasi kalanlari ENGELLEMEZ', async () => {
        const apply = vi.fn()
            .mockRejectedValueOnce(new Error('bir'))
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce(undefined)
        const { results } = await runBulkOverrides({
            targets: members('a', 'b', 'c'), apply, data: DATA,
        })
        expect(apply).toHaveBeenCalledTimes(3)
        expect(results.map((r) => r.ok)).toEqual([false, true, true])
    })

    it('sonuclar GIRDI SIRASINDA ve kimliklerle birlikte doner', async () => {
        const apply = vi.fn()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('x'))
        const { results } = await runBulkOverrides({
            targets: members('a', 'b'), apply, data: DATA,
        })
        expect(results.map((r) => r.user_id)).toEqual(['a', 'b'])
    })

    it('kismi sonuc PARTIAL olarak siniflanir — success DEGIL', async () => {
        const apply = vi.fn()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('x'))
        const { results } = await runBulkOverrides({
            targets: members('a', 'b'), apply, data: DATA,
        })
        const c = classifyBulkResult(results)
        expect(c.kind).toBe('partial')
        expect(c.failed.map((f) => f.user_id)).toEqual(['b'])
    })

    it('hepsi basarisizsa ERROR olarak siniflanir', async () => {
        const apply = vi.fn().mockRejectedValue(new Error('x'))
        const { results } = await runBulkOverrides({
            targets: members('a', 'b'), apply, data: DATA,
        })
        expect(classifyBulkResult(results).kind).toBe('error')
    })

    it('hata nesnesi saklanir (kullaniciya mesaj gosterilebilir)', async () => {
        const apply = vi.fn().mockRejectedValue({
            response: { data: { detail: 'Not permitted.' } },
        })
        const { results } = await runBulkOverrides({
            targets: members('a'), apply, data: DATA,
        })
        expect(errorText(results[0].error)).toBe('Not permitted.')
    })
})

describe('yalnizca BASARISIZLARI yeniden dene', () => {
    it('basarili uyeler yeniden denenmez (duplicate mutation YOK)', async () => {
        const apply = vi.fn()
            .mockResolvedValueOnce(undefined)      // a basarili
            .mockRejectedValueOnce(new Error('x')) // b basarisiz
            .mockResolvedValueOnce(undefined)      // c basarili
        const targets = members('a', 'b', 'c')
        const { results } = await runBulkOverrides({ targets, apply, data: DATA })

        const byId = Object.fromEntries(targets.map((t) => [t.user_id, t]))
        const retry = failedTargets(results, byId)
        expect(retry.map((t) => t.user_id)).toEqual(['b'])

        apply.mockClear()
        apply.mockResolvedValue(undefined)
        const second = await runBulkOverrides({ targets: retry, apply, data: DATA })
        // YALNIZCA b tekrar gonderildi.
        expect(apply.mock.calls.map((c) => c[0].userId)).toEqual(['b'])
        expect(classifyBulkResult(second.results).kind).toBe('success')
    })

    it('hic basarisiz yoksa retry listesi BOS', async () => {
        const apply = vi.fn().mockResolvedValue(undefined)
        const { results } = await runBulkOverrides({
            targets: members('a', 'b'), apply, data: DATA,
        })
        expect(failedTargets(results, {})).toEqual([])
    })

    it('uye nesnesi bulunamazsa en azindan kimlik korunur', () => {
        const retry = failedTargets([{ user_id: 'z', ok: false }], {})
        expect(retry).toEqual([{ user_id: 'z' }])
    })
})

describe('iptal (unmount guvenligi)', () => {
    it('iptal edilince kalan istekler ATILMAZ', async () => {
        const signal = { aborted: false }
        const apply = vi.fn(async () => { signal.aborted = true })
        const { results, aborted } = await runBulkOverrides({
            targets: members('a', 'b', 'c'), apply, data: DATA, signal,
        })
        // Ilk istek gitti, sonra iptal edildi.
        expect(apply).toHaveBeenCalledTimes(1)
        expect(results).toHaveLength(1)
        expect(aborted).toBe(true)
    })

    it('bastan iptal edilmisse hic istek atilmaz', async () => {
        const apply = vi.fn()
        const { aborted } = await runBulkOverrides({
            targets: members('a'), apply, data: DATA, signal: { aborted: true },
        })
        expect(apply).not.toHaveBeenCalled()
        expect(aborted).toBe(true)
    })
})

describe('errorText', () => {
    it('sunucu detayini tercih eder, sonra message, sonra fallback', () => {
        expect(errorText({ response: { data: { detail: 'D' } } })).toBe('D')
        expect(errorText(new Error('M'))).toBe('M')
        expect(errorText(null, 'F')).toBe('F')
    })
})
