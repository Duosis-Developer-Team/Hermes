/**
 * =============================================================================
 * HERMES - Nginx sunum sozlesmesi (Sprint 6D)
 * =============================================================================
 * Bu testler CONFIG'in dogru YAZILDIGINI deterministik olarak dogrular.
 * Gercekten dogru CEVAP uretildigi ayrica gercek bir container'da olculur
 * (raporda "Docker/Nginx dogrulamasi"): ikisi birlikte, "config dogru
 * gorunuyor ama davranis yanlis" bosluguna yer birakmaz.
 *
 * KILITLENEN BULGU (Sprint 5.1): nginx `add_header`'i alt seviyeye YALNIZCA
 * o seviyede HIC add_header yoksa devralir. `Cache-Control` tanimlayan her
 * location bu yuzden guvenlik header'larini sessizce dusuruyordu. Cozum
 * tek kaynakli bir parca (`nginx-security-headers.inc`) ve onu ilgili her
 * seviyeye `include` etmek. Asagidaki testler bir location'a Cache-Control
 * eklenip include EDILMEDIGI anda kirmiziya doner.
 * =============================================================================
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../../', import.meta.url).pathname
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

const SNIPPET = 'nginx-security-headers.inc'
const INCLUDE = 'include /etc/nginx/conf.d/security-headers.inc;'

/**
 * Yorum satirlarini atar. Assertion'lar DIREKTIFLERE bakmali; aksi halde
 * config'i aciklayan bir yorum metni testi yanlislikla esletiyor (bu
 * dosyada iki kez oldu: "location" ve "expires 1y" kelimeleri
 * yorumlarda geciyordu).
 */
const directives = (text) =>
    text.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')

/** Bir `location ... { ... }` blogunun govdesini cikarir (yorumsuz). */
const locationBody = (conf, header) => {
    const start = conf.indexOf(header)
    if (start === -1) throw new Error(`location bulunamadi: ${header}`)
    const open = conf.indexOf('{', start)
    let depth = 0
    for (let i = open; i < conf.length; i++) {
        if (conf[i] === '{') depth++
        else if (conf[i] === '}') {
            depth--
            if (depth === 0) return directives(conf.slice(open + 1, i))
        }
    }
    throw new Error(`kapanmayan blok: ${header}`)
}

const REQUIRED_HEADERS = [
    'X-Frame-Options',
    'X-Content-Type-Options',
    'Referrer-Policy',
    'Content-Security-Policy',
    // Mevcut sozlesmede korunuyor:
    'X-XSS-Protection',
]

describe('guvenlik header parcasi', () => {
    it('TEK KAYNAK dosyasi zorunlu header’larin tamamini tanimlar', () => {
        const snippet = read(SNIPPET)
        for (const h of REQUIRED_HEADERS) {
            expect(snippet, `${h} eksik`).toContain(h)
        }
    })

    it('her header `always` ile yazilir (hata cevaplarinda da gecerli)', () => {
        for (const line of read(SNIPPET).split('\n')) {
            if (line.trim().startsWith('add_header')) {
                expect(line).toMatch(/always;\s*$/)
            }
        }
    })

    it('parca YENI external origin EKLEMEZ (CSP yeniden tasarlanmadi)', () => {
        const csp = read(SNIPPET).match(/Content-Security-Policy "([^"]+)"/)[1]
        const origins = csp.match(/https?:\/\/[^\s;]+/g) || []
        // Yalnizca dev ucu; baska host yok.
        expect([...new Set(origins)].sort()).toEqual([
            'http://84.247.180.172:30772',
            'https://84.247.180.172:30772',
        ])
    })

    it('Dockerfile parcayi imaja kopyalar', () => {
        expect(read('Dockerfile')).toMatch(
            /COPY nginx-security-headers\.inc \/etc\/nginx\/conf\.d\/security-headers\.inc/
        )
    })

    it('parca conf.d/*.conf olarak KENDILIGINDEN yuklenmez (.inc uzantisi)', () => {
        expect(read('Dockerfile')).toContain('security-headers.inc')
        expect(read('Dockerfile')).not.toMatch(/security-headers\.conf/)
    })
})

describe('header devralma kirilmasi kapatildi', () => {
    const conf = () => read('nginx.conf')

    it('server seviyesi parcayi include eder', () => {
        // include, ilk location DIREKTIFINDEN once gelmeli. (Ham
        // `indexOf('location')` yorum metnini de yakalar — direktifi
        // satir basindan eslestiriyoruz.)
        const c = directives(conf())
        expect(c).toContain(INCLUDE)
        const firstLocation = c.search(/^\s*location\s/m)
        expect(firstLocation).toBeGreaterThan(-1)
        expect(c.indexOf(INCLUDE)).toBeLessThan(firstLocation)
    })

    it('satir-ici add_header KOPYASI kalmadi (tek kaynak)', () => {
        // Guvenlik header'lari artik yalniz parcada tanimli; nginx.conf
        // icinde Cache-Control disinda add_header olmamali.
        for (const line of conf().split('\n')) {
            const t = line.trim()
            if (t.startsWith('add_header')) {
                expect(t, `beklenmeyen add_header: ${t}`).toContain('Cache-Control')
            }
        }
    })

    it.each([
        ['location ^~ /assets/', 'public, immutable'],
        ['location = /env-config.js', 'no-store'],
        ['location = /index.html', 'no-store'],
    ])('%s — Cache-Control tanimlar VE parcayi include eder', (header, cc) => {
        const body = locationBody(conf(), header)
        expect(body).toContain('Cache-Control')
        expect(body).toContain(cc)
        // Kritik kural: add_header tanimlayan her seviye parcayi da
        // include etmeli, aksi halde devralma kirilir.
        expect(body, `${header} include etmiyor → header’lar duser`)
            .toContain(INCLUDE)
    })

    it('add_header tanimlayan HICBIR location include’u atlamaz', () => {
        const c = conf()
        // Tum location bloklarini tara: add_header varsa include de olmali.
        for (const m of directives(c).matchAll(/location\s+[^{]+\{/g)) {
            const body = locationBody(c, m[0])
            if (/add_header/.test(body)) {
                expect(body, `include eksik: ${m[0].trim()}`).toContain(INCLUDE)
            }
        }
    })
})

describe('cache sozlesmesi DEGISMEDI', () => {
    const conf = () => read('nginx.conf')

    it('hash’li asset: uzun cache + immutable, TEK Cache-Control satiri', () => {
        const body = locationBody(conf(), 'location ^~ /assets/')
        expect(body).toMatch(/public, immutable/)
        expect(body).toMatch(/max-age=31536000/)
        // `expires` KENDI Cache-Control'unu yazar; add_header ile birlikte
        // cevapta IKI satir olusuyordu. Ikisi ayni anda bulunmamali.
        expect(body).not.toMatch(/expires\s+1y/)
        expect((body.match(/Cache-Control/g) || []).length).toBe(1)
        // Olmayan bundle SPA'ya dusmez, gercek 404 olur.
        expect(body).toMatch(/try_files\s+\$uri\s*=404/)
    })

    it('index.html ve env-config.js: no-store, immutable DEGIL', () => {
        for (const h of ['location = /index.html', 'location = /env-config.js']) {
            const body = locationBody(conf(), h)
            expect(body).toContain('no-store')
            expect(body).not.toContain('immutable')
            expect(body).not.toMatch(/max-age/)
        }
    })

    it('SPA fallback korunur (direct refresh)', () => {
        const body = locationBody(conf(), 'location / {')
        expect(body).toMatch(/try_files\s+\$uri\s+\$uri\/\s+\/index\.html/)
    })
})
