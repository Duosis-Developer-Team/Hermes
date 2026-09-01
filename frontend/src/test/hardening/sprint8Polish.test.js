/**
 * =============================================================================
 * Sprint 8 — Gorsel cila + Ingilizce tutarlilik kilitleri (KAYNAK TARAMASI)
 * =============================================================================
 * frontendDebt.test.js ile ayni yaklasim: etkilesim degil YAPISAL KURAL
 * korunur. Kapsam yalnizca `src/` urun kaynagi; test dosyalari haric.
 *
 * Kilitlenen kararlar:
 *   1. Collapsed logo kutusu ikon dosyasinin GERCEK oranina gore (714x349,
 *      ~2:1 yatay) boyutlanir — 36x36 kare kutuya donus, logoyu yeniden
 *      "cok kucuk" yapar.
 *   2. .view-link native buton kromunu SIFIRLAR (Sprint 8'in kok neden
 *      duzeltmesi) ve gorunur odak halkasi tasir.
 *   3. Sayfa arka plani semantic token uzerinden gelir (--h-bg-page),
 *      iki temada da tanimlidir ve ANIMASYONSUZDUR.
 *   4. Hafta ici/sonu ayrimi token uzerindendir (--h-bg-weekend).
 *   5. WeeklyListView'daki mukerrer hafta ozeti GERI GELMEZ.
 *   6. Urun kaynaginin KOD satirlarinda (yorumlar haric) Turkce'ye ozgu
 *      karakter kalmaz — sistem metinleri Ingilizce'dir. Yorumlar Turkce
 *      kalabilir (proje kurali); kullanici VERISI zaten kaynakta yasamaz.
 * =============================================================================
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = 'src'

function walk(dir, exts, out = []) {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) {
            if (name === 'test' || name === '__tests__' || name === 'node_modules') continue
            walk(full, exts, out)
        } else if (exts.some((e) => name.endsWith(e))) {
            out.push(full)
        }
    }
    return out
}

const read = (f) => readFileSync(f, 'utf8')

/** CSS blogunu secip govdesini dondurur (ilk eslesen selector).
    Yorumlar DUSURULUR: aciklama metninde gecen bir ozellik adi
    "kural var" sayilmamali (yanlis pozitif). */
const cssBlock = (raw, selector) => {
    const css = raw.replace(/\/\*[\s\S]*?\*\//g, '')
    const i = css.indexOf(selector)
    expect(i).toBeGreaterThan(-1)
    const open = css.indexOf('{', i)
    const close = css.indexOf('}', open)
    return css.slice(open + 1, close)
}

describe('collapsed logo kutusu (§A)', () => {
    it('ikon logo YATAY kutuda ve object-fit: contain ile cizilir', () => {
        const css = read(join(SRC, 'components/layout/MainLayout.css'))
        const block = cssBlock(css, '.sidebar-logo--icon')
        expect(block).toContain('object-fit: contain')

        const w = parseInt(block.match(/width:\s*(\d+)px/)?.[1] ?? '0', 10)
        const h = parseInt(block.match(/height:\s*(\d+)px/)?.[1] ?? '0', 10)
        // Kok neden: dosya 714x349 (~2:1 yatay). Kare/kucuk kutu = bug geri
        // geldi. 2026-08-04: kullanici "hala cok kucuk" dedi → taban 60px.
        expect(w).toBeGreaterThanOrEqual(60)
        expect(w).toBeGreaterThan(h)
    })
})

describe('view switcher kromu (§B)', () => {
    it('.view-link native buton kromunu sifirlar (seffaf metin-tab)', () => {
        const css = read(join(SRC, 'pages/TimeEntryPage.css'))
        const block = cssBlock(css, '.view-link {')
        expect(block).toContain('background: none')
        expect(block).toContain('border: 0')
        expect(block).toContain('appearance: none')
    })

    it('.view-link gorunur odak halkasi tasir', () => {
        const css = read(join(SRC, 'pages/TimeEntryPage.css'))
        expect(css).toMatch(/\.view-link:focus-visible\s*\{[^}]*outline/)
    })

    it('aktif tab accent alt cizgi tasir (durum yalniz renkle anlatilmaz)', () => {
        const css = read(join(SRC, 'pages/TimeEntryPage.css'))
        expect(css).toMatch(/\.view-link\.active::after\s*\{/)
    })
})

describe('sayfa arka plani tokenlari (§C)', () => {
    it('--h-bg-page iki temada da tanimli ve gradient icerir', () => {
        const tokens = read(join(SRC, 'styles/tokens.css'))
        const defs = tokens.match(/--h-bg-page:/g) || []
        expect(defs.length).toBeGreaterThanOrEqual(2)
        expect(tokens).toMatch(/--h-bg-page:[^;]*radial-gradient/)
    })

    it('--h-bg-weekend iki temada da tanimli; DayColumn onu kullanir', () => {
        const tokens = read(join(SRC, 'styles/tokens.css'))
        expect((tokens.match(/--h-bg-weekend:/g) || []).length).toBeGreaterThanOrEqual(2)
        const day = read(join(SRC, 'components/time-entry/DayColumn.css'))
        expect(day).toContain('var(--h-bg-weekend)')
    })

    it('sayfa gradyani token uzerinden gelir ve ANIMASYONSUZ', () => {
        /* 2026-08-04 performans duzeltmesi: gradient artik `.main-content`
           uzerinde `background-attachment: fixed` ile DEGIL, sabit tek bir
           pseudo-katmanda (scroll'da repaint yok). Token sozlesmesi ayni. */
        const css = read(join(SRC, 'components/layout/MainLayout.css'))
        const layer = cssBlock(css, '.main-content::before')
        expect(layer).toContain('var(--h-bg-page')
        expect(layer).not.toContain('animation')
        expect(cssBlock(css, '.main-content {')).not.toContain('background-attachment: fixed')
    })
})

describe('mukerrer hafta ozeti geri gelmez (§C)', () => {
    it('WeeklyListView kendi hafta toplam bandini CIZMEZ (WeekNavigator cizer)', () => {
        // Aciklayici yorumlar sinif adini ANABILIR — yalnizca kod taranir.
        const noComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
        const jsx = noComments(read(join(SRC, 'components/time-entry/WeeklyListView.jsx')))
        expect(jsx).not.toContain('weekly-list-summary')
        const css = noComments(read(join(SRC, 'components/time-entry/WeeklyListView.css')))
        expect(css).not.toContain('.weekly-list-summary')
    })
})

describe('Ingilizce tutarlilik (§D)', () => {
    /*
     * Yorumlar Turkce KALABILIR (proje kurali) — bu yuzden once tum
     * yorumlar dusurulur, kalan KOD satirlari taranir. Turkce'ye ozgu
     * karakterler (ğşıİöüç) kod satirinda ancak kullaniciya gosterilen
     * bir dizgede olabilir; o da artik Ingilizce olmali.
     *
     * Bilinen ISTISNALAR (hepsi ALGORITMA verisi, UI metni degil):
     *   - codeGenerator.js: VOWELS kumesi (Turkce musteri adindan kod
     *     uretir) — dosya duzeyinde istisna.
     *   - Regex KARAKTER SINIFLARI (`[ıi]`, `[^…ğüşıöç…]`): Turkce-locale
     *     Teams govdesini ayristiran ayraclar (LogTimeModal) ve dosya adi
     *     sanitizasyonunda Turkce harfleri KORUYAN sinif (TimeEntryPage).
     *     Bunlar kullanici VERISI isler, ekrana Turkce basmaz — satirda
     *     koseli parantez DISINDA Turkce karakter kalirsa yine yakalanir.
     */
    const TURKISH = /[ğşıİöüçĞŞÖÜÇ]/
    // `i18n/tr.js` BILINCLI istisnadir: kural "kullaniciya Ingilizce
    // goster" demek icin vardi, artik metin sozlukten geliyor ve Turkce
    // sozlukte Turkce karakter olmasi ZORUNLU. Istisna DOSYA duzeyinde
    // ve tektir; geri kalan tum kaynakta kural aynen gecerli.
    const ALLOWED = ['utils/codeGenerator.js', 'i18n/tr.js']
    const dropBracketClasses = (line) => line.replace(/\[[^\]]*\]/g, '')

    const stripComments = (text) =>
        text
            // once blok yorumlar (CSS + JS + JSX icindekiler)
            .replace(/\/\*[\s\S]*?\*\//g, '')
            // sonra satir sonu yorumlari (dizge icindeki `//` URL'leri de
            // dusurulebilir — bu yalnizca taramayi DARALTIR, yanlis alarm
            // uretmez)
            .split('\n')
            .map((l) => l.replace(/\/\/.*$/, ''))
            .join('\n')

    it('urun kaynaginin kod satirlarinda Turkce karakter YOK', () => {
        const offenders = []
        for (const f of walk(SRC, ['.js', '.jsx', '.css'])) {
            if (ALLOWED.some((a) => f.endsWith(a))) continue
            const code = stripComments(read(f))
            for (const [i, line] of code.split('\n').entries()) {
                if (TURKISH.test(dropBracketClasses(line))) {
                    offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 60)}`)
                }
            }
        }
        expect(offenders).toEqual([])
    })
})
