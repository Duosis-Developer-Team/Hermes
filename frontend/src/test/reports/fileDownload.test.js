/**
 * =============================================================================
 * Sprint 6A/6C — Dosya indirme sozlesmesi
 * =============================================================================
 * Uc export ucu ayni isi UC AYRI sekilde yapiyordu. Ortaklastirildi ve
 * burada kilitlenen kusurlar sunlar:
 *
 *   1. Object URL yalnizca BASARI yolunda ve 2 saniyelik bir timeout
 *      icinde revoke ediliyordu → hata yolunda sizinti.
 *   2. Gecici `<a>` ogesi de ayni timeout'a birakilmisti → DOM'da kaliyordu.
 *   3. `Content-Disposition` ve `Content-Type` yok sayiliyordu.
 *   4. Hata govdesi yalnizca TAM `application/json` esitliginde
 *      yakalaniyordu; `application/json; charset=utf-8` gecip CSV gibi
 *      indiriliyordu — yani BASARISIZLIK basari gibi gorunuyordu.
 * =============================================================================
 */
import { describe, expect, it, vi } from 'vitest'

import {
    downloadBlobResponse, ensureExtension, filenameFromDisposition,
} from '../../services/fileDownload'

/** Gercek DOM/URL yerine sayilabilir sahteler. */
function makeDeps() {
    const created = []
    const revoked = []
    const appended = []
    const removed = []
    const link = {
        href: '', style: {}, parentNode: null,
        setAttribute: vi.fn(function (k, v) { this[k] = v }),
        click: vi.fn(),
    }
    const doc = {
        createElement: vi.fn(() => link),
        body: {
            appendChild: vi.fn((el) => { appended.push(el); el.parentNode = doc.body }),
            removeChild: vi.fn((el) => { removed.push(el); el.parentNode = null }),
        },
    }
    const url = {
        createObjectURL: vi.fn((b) => { created.push(b); return 'blob:fake-url' }),
        revokeObjectURL: vi.fn((u) => revoked.push(u)),
    }
    return { deps: { document: doc, url }, created, revoked, appended, removed, link }
}

const blobResponse = (body, { type = 'text/csv', disposition, contentType } = {}) => ({
    data: { type, text: async () => body },
    headers: {
        ...(contentType ? { 'content-type': contentType } : {}),
        ...(disposition ? { 'content-disposition': disposition } : {}),
    },
})

describe('filenameFromDisposition', () => {
    it('duz filename okunur', () => {
        expect(filenameFromDisposition('attachment; filename="rapor.csv"'))
            .toBe('rapor.csv')
    })

    it('tirnaksiz filename okunur', () => {
        expect(filenameFromDisposition('attachment; filename=rapor.csv'))
            .toBe('rapor.csv')
    })

    it('RFC 5987 filename* TURKCE karakteri cozer', () => {
        expect(filenameFromDisposition(
            "attachment; filename*=UTF-8''ayl%C4%B1k-rapor.csv"
        )).toBe('aylık-rapor.csv')
    })

    it('filename* BOZUKSA duz filename e duser', () => {
        expect(filenameFromDisposition(
            "attachment; filename=\"yedek.csv\"; filename*=UTF-8''%E0%A4%A"
        )).toBe('yedek.csv')
    })

    it('baslik yoksa null', () => {
        expect(filenameFromDisposition(undefined)).toBeNull()
        expect(filenameFromDisposition('attachment')).toBeNull()
    })
})

describe('ensureExtension', () => {
    it('uzanti yoksa eklenir', () => {
        expect(ensureExtension('rapor')).toBe('rapor.csv')
    })
    it('farkli uzanti degistirilir', () => {
        expect(ensureExtension('rapor.xlsx')).toBe('rapor.csv')
    })
    it('dogru uzanti korunur', () => {
        expect(ensureExtension('rapor.csv')).toBe('rapor.csv')
    })
    it('bos ad guvenli varsayilana duser', () => {
        expect(ensureExtension('')).toBe('download.csv')
    })
})

describe('downloadBlobResponse — basari yolu', () => {
    it('sunucunun DOSYA ADINI kullanir', async () => {
        const { deps, link } = makeDeps()
        const res = await downloadBlobResponse(
            blobResponse('a,b\n1,2', { disposition: 'attachment; filename="mart.csv"' }),
            'yedek.csv',
            deps
        )
        expect(res.filename).toBe('mart.csv')
        expect(link.setAttribute).toHaveBeenCalledWith('download', 'mart.csv')
    })

    it('sunucu ad vermezse VERILEN ad kullanilir', async () => {
        const { deps } = makeDeps()
        const res = await downloadBlobResponse(blobResponse('x'), 'hermes_rapor.csv', deps)
        expect(res.filename).toBe('hermes_rapor.csv')
    })

    it('sunucunun ICERIK TURU korunur', async () => {
        const { deps } = makeDeps()
        const res = await downloadBlobResponse(
            blobResponse('x', { contentType: 'text/tab-separated-values' }),
            'a.csv', deps
        )
        expect(res.type).toBe('text/tab-separated-values')
    })

    it('octet-stream anlamli sayilmaz — CSV varsayilir', async () => {
        const { deps } = makeDeps()
        const res = await downloadBlobResponse(
            blobResponse('x', { contentType: 'application/octet-stream' }),
            'a.csv', deps
        )
        expect(res.type).toContain('text/csv')
    })

    it('gecici <a> ogesi DOM da BIRAKILMAZ', async () => {
        const { deps, appended, removed } = makeDeps()
        await downloadBlobResponse(blobResponse('x'), 'a.csv', deps)
        expect(appended).toHaveLength(1)
        expect(removed).toHaveLength(1)
        expect(removed[0]).toBe(appended[0])
    })

    it('object URL REVOKE edilir', async () => {
        const { deps, revoked } = makeDeps()
        await downloadBlobResponse(blobResponse('x'), 'a.csv', deps)
        await new Promise((r) => setTimeout(r, 0))
        expect(revoked).toEqual(['blob:fake-url'])
    })
})

describe('downloadBlobResponse — hata yolu', () => {
    it('JSON hata govdesi BASARI gibi indirilmez', async () => {
        const { deps } = makeDeps()
        const res = blobResponse(
            JSON.stringify({ detail: 'Report window too large.' }),
            { type: 'application/json' }
        )
        await expect(downloadBlobResponse(res, 'a.csv', deps))
            .rejects.toThrow('Report window too large.')
    })

    it('charset TASIYAN json turu de yakalanir', async () => {
        // Eski kod yalnizca TAM esitlik kontrol ediyordu; bu govde CSV
        // olarak indiriliyordu.
        const { deps } = makeDeps()
        const res = blobResponse(
            JSON.stringify({ error: { message: 'Forbidden' } }),
            { type: 'application/json; charset=utf-8' }
        )
        await expect(downloadBlobResponse(res, 'a.csv', deps))
            .rejects.toThrow('Forbidden')
    })

    it('hata yolunda object URL ve DOM ogesi OLUSTURULMAZ', async () => {
        const { deps, created, appended } = makeDeps()
        const res = blobResponse(JSON.stringify({ detail: 'nope' }), {
            type: 'application/json',
        })
        await expect(downloadBlobResponse(res, 'a.csv', deps)).rejects.toThrow()
        expect(created).toHaveLength(0)
        expect(appended).toHaveLength(0)
    })

    it('okunamayan JSON govdesi generic mesaja duser', async () => {
        const { deps } = makeDeps()
        const res = {
            data: { type: 'application/json', text: async () => 'bozuk{' },
            headers: {},
        }
        await expect(downloadBlobResponse(res, 'a.csv', deps))
            .rejects.toThrow('Download failed')
    })

    it('click PATLARSA bile object URL revoke edilir', async () => {
        const { deps, revoked, link } = makeDeps()
        link.click = vi.fn(() => { throw new Error('click blocked') })
        await expect(downloadBlobResponse(blobResponse('x'), 'a.csv', deps))
            .rejects.toThrow('click blocked')
        await new Promise((r) => setTimeout(r, 0))
        // `finally` sayesinde temizlik KESIN.
        expect(revoked).toEqual(['blob:fake-url'])
    })
})
