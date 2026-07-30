/**
 * =============================================================================
 * Sprint 6C — API token SECRET-SAFETY kilitleri
 * =============================================================================
 * API Management yuzeyi plaintext token sozlesmesini DOGRU uyguluyor
 * (kodun kendi basliginda da yazili). Eksik olan sey testti: hicbir kilit
 * yoktu, yani bir sonraki duzenleme sizintiyi sessizce geri getirebilirdi.
 *
 * Bu dosya KAYNAK TARAMASI yapar; mount eden bir entegrasyon testi degil.
 * Sebep bilincli: burada korunan sey bir etkilesim akisi degil, bir
 * YAPISAL YASAK — "token su yollara ASLA yazilmaz". Yasagi en dogrudan ve
 * en hizli kanitlayan sey, o yollarin kaynakta hic gecmemesidir. (Ayni
 * desen portalFacts, featureStructure ve nginxContract testlerinde de
 * kullaniliyor.)
 *
 * Kapsam disi kalan ve DURUSTCE boyle raporlanan sey: gercek tarayicida
 * "kopyala" tiklamasi ve modal kapanisi sonrasi bellek durumu. Onlar
 * authenticated bir admin oturumu gerektirir.
 * =============================================================================
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../../', import.meta.url).pathname
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

const PAGE = 'pages/admin/ApiManagementPage.jsx'
const page = () => read(PAGE)

/*
 * Sprint 6A/6C: plaintext token GOSTERIMI ayri bir module tasindi
 * (sorumluluk ayrimi; davranis birebir korundu — govde diff'i bos).
 * Yapisal yasak DEGISMEDI, yalnizca dosya yolu degisti: gosterim
 * iddialarini artik o modul karsilamalidir.
 */
const TOKEN_MODAL = 'features/api-management/components/TokenOnceModal.jsx'
const tokenModal = () => read(TOKEN_MODAL)

/** Yorumlari atar — yasak kelimeler aciklama metninde gecebilir. */
const code = (text) =>
    text
        .split('\n')
        .filter((l) => {
            const t = l.trim()
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
        })
        .join('\n')

describe('plaintext token KALICI hicbir yere yazilmaz', () => {
    it('localStorage / sessionStorage / cookie KULLANILMAZ', () => {
        const c = code(page())
        for (const sink of ['localStorage', 'sessionStorage', 'document.cookie']) {
            expect(c, `${sink} kullanimi bulundu`).not.toContain(sink)
        }
    })

    it('console’a hicbir sey yazilmaz', () => {
        // Token'i loglamak sizinti; "sadece debug" diye eklenen bir
        // console.log da sizintidir (Dashboard'da tam bu oldu).
        expect(code(page())).not.toMatch(/console\.(log|debug|info|warn|error)\s*\(/)
    })

    it('token QUERY CACHE’ine yazilmaz (setQueryData yok)', () => {
        // Liste/detay cache'i devingen ve kalicidir; plaintext oraya
        // girerse modal kapandiktan sonra da erisilebilir kalir.
        expect(code(page())).not.toContain('setQueryData')
    })

    it('token URL’e / adres cubuguna tasinmaz', () => {
        const c = code(page())
        expect(c).not.toMatch(/searchParams\.set\([^)]*token/i)
        expect(c).not.toMatch(/location\.(href|search|hash)\s*=/)
    })
})

describe('reveal-once sozlesmesi', () => {
    it('plaintext YALNIZCA tek bir local state’te yasar', () => {
        const c = code(page())
        expect(c).toMatch(/const \[issuedToken, setIssuedToken\] = useState\(null\)/)
    })

    it('kapanista state VE mutation cache birlikte temizlenir', () => {
        // `mutation.data` icinde de plaintext kalir; state'i tek basina
        // sifirlamak yeterli DEGILDIR.
        const c = code(page())
        const closeFn = c.slice(c.indexOf('const closeIssued'))
            .slice(0, c.slice(c.indexOf('const closeIssued')).indexOf('}') + 1)
        expect(closeFn).toContain('setIssuedToken(null)')
        expect(closeFn).toContain('createToken.reset()')
        expect(closeFn).toContain('rotateToken.reset()')
    })

    it('varsayilan gosterim MASKELI', () => {
        // Token kutusu once maskelenir; tam deger acik bir eylemle gorunur.
        expect(tokenModal()).toMatch(/'•'\.repeat\(/)
    })

    it('"bir daha gosterilmeyecek" uyarisi kullaniciya soylenir', () => {
        expect(tokenModal()).toMatch(/will not be shown again/i)
    })

    it('kopyalama ACIK bir kullanici eylemi ve geri bildirimi var', () => {
        const c = code(tokenModal())
        expect(c).toContain('navigator.clipboard.writeText')
        // Panoya yazma bir tiklama isleyicisinin icinde olmali, render
        // sirasinda kendiliginden calismamali.
        expect(c).toMatch(/const handleCopy|onClick=\{[^}]*[Cc]opy/)
    })
})

describe('fixture ve testlerde GERCEK token yok', () => {
    const walk = (dir) => {
        const out = []
        for (const name of readdirSync(join(ROOT, dir))) {
            const rel = `${dir}/${name}`
            if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel))
            else if (/\.(js|jsx|json)$/.test(rel)) out.push(rel)
        }
        return out
    }

    it('hicbir test/kaynak dosyasi hms_dev_/hms_live_ deseni icermez', () => {
        // Gercek token bicimi: hms_dev_… / hms_live_… (bkz. CLAUDE.md).
        const offenders = []
        for (const f of [...walk('test'), ...walk('pages/admin')]) {
            if (/hms_(dev|live)_[A-Za-z0-9]/.test(read(f))) offenders.push(f)
        }
        expect(offenders).toEqual([])
    })

    it('API Management kaynagi uzun opak literal tasimaz', () => {
        // 32+ karakterlik harf/rakam blogu = sizmis anahtar suphesi.
        const literals = code(page()).match(/['"`][A-Za-z0-9_-]{32,}['"`]/g) || []
        expect(literals).toEqual([])
    })
})
