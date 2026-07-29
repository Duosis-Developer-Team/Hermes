/**
 * =============================================================================
 * HERMES - Runtime yapilandirma sozlesmesi (Sprint 5.1)
 * =============================================================================
 * `index.html` `/env-config.js` dosyasini KOSULSUZ yukler. Dosya imajda
 * yoksa her sayfa acilisinda bir 404 olusur — bu turda kapatilan kusur
 * buydu. Buradaki testler o kusurun geri gelmesini engeller.
 *
 * KAPSAM AYRIMI (bilincli): bu dosya KAYNAK sozlesmesini dogrular ve her
 * zaman deterministik kosar. "Production build ciktisinda gercekten
 * `dist/env-config.js` var mi?" sorusu build SONRASI cevaplanabildigi ve
 * CI'da `npm test` build'den ONCE kostugu icin o kontrol CI'daki
 * `Build frontend` adimina eklendi (kosullu/atlanabilir bir test
 * yazmaktansa iki katman ayri ayri kanitlaniyor).
 * =============================================================================
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../../', import.meta.url).pathname
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

const PLACEHOLDER = 'public/env-config.js'

describe('runtime config yer tutucusu', () => {
    it('public/ altinda VARDIR (Vite build ciktisina kopyalar)', () => {
        expect(read(PLACEHOLDER).length).toBeGreaterThan(0)
    })

    it('JavaScript’tir — HTML/SPA fallback DEGILDIR', () => {
        const src = read(PLACEHOLDER)
        expect(src).not.toMatch(/<!DOCTYPE/i)
        expect(src).not.toMatch(/<html/i)
        expect(src).toContain('window._env_')
    })

    it('MEVCUT runtime config nesnesini EZMEZ', () => {
        // `= window._env_ || {}` sozlesmesi: deploy sirasinda gercek
        // degerleri enjekte eden bir surum onceden calistiysa korunur.
        expect(read(PLACEHOLDER)).toMatch(
            /window\._env_\s*=\s*window\._env_\s*\|\|\s*\{\s*\}/
        )
    })

    it('GERCEK deger veya secret ICERMEZ', () => {
        const src = read(PLACEHOLDER)
        // UUID (Azure client/tenant id), token, uzun base64 blob yok.
        expect(src).not.toMatch(
            /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
        )
        expect(src).not.toMatch(/hms_(dev|live)_/)
        expect(src).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/)
        // Anahtarlara DEGER atanmaz; yalnizca nesne var edilir.
        expect(src).not.toMatch(/VITE_AZURE_(CLIENT|TENANT)_ID\s*:/)
    })
})

describe('yukleme sozlesmesi korunur', () => {
    it('index.html dosyayi hala cagirir', () => {
        expect(read('index.html')).toContain('src="/env-config.js"')
    })

    it('Vite publicDir DEVRE DISI birakilmamis', () => {
        // publicDir varsayilani "public"; kapatilirsa dosya dist'e
        // kopyalanmaz ve 404 sessizce geri gelir.
        expect(read('vite.config.js')).not.toMatch(/publicDir\s*:\s*false/)
    })

    it('build-time fallback zinciri KORUNUR (window._env_ → import.meta.env)', () => {
        // Yer tutucu deger tasimadigi icin Azure ayarlari bugun hala
        // build-time env'den gelir; bu zincir kirilirsa login bozulur.
        const login = read('src/pages/LoginPage.jsx')
        expect(login).toMatch(
            /window\._env_\?\.VITE_AZURE_TENANT_ID\s*\|\|\s*import\.meta\.env\.VITE_AZURE_TENANT_ID/
        )
        expect(login).toMatch(
            /window\._env_\?\.VITE_AZURE_CLIENT_ID\s*\|\|\s*import\.meta\.env\.VITE_AZURE_CLIENT_ID/
        )
    })
})

describe('nginx sunum sozlesmesi', () => {
    const nginx = () => read('nginx.conf')

    it('exact-match location vardir — SPA fallback’e DUSMEZ', () => {
        const conf = nginx()
        expect(conf).toMatch(/location\s*=\s*\/env-config\.js\s*\{/)
        // Eksik dosya 404 olmali; index.html olarak maskelenmemeli.
        const block = conf.split('location = /env-config.js')[1].split('}')[0]
        expect(block).toMatch(/try_files\s+\$uri\s*=404/)
    })

    it('uzun sureli immutable cache UYGULANMAZ', () => {
        const block = nginx().split('location = /env-config.js')[1].split('}')[0]
        expect(block).toMatch(/Cache-Control\s+"no-store"/)
        expect(block).not.toMatch(/immutable/)
        expect(block).not.toMatch(/expires\s+1y/)
    })

    it('hash’li asset cache davranisi DEGISMEZ', () => {
        const conf = nginx()
        const assets = conf.split('location ^~ /assets/')[1].split('}')[0]
        expect(assets).toMatch(/expires\s+1y/)
        expect(assets).toMatch(/public, immutable/)
    })
})
