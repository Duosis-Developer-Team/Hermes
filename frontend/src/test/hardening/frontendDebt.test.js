/**
 * =============================================================================
 * Sprint 7 — Frontend borç kilitleri
 * =============================================================================
 * Bu dosya KAYNAK TARAMASI yapar; bir etkilesim akisini degil YAPISAL BIR
 * KURALI korur ("su desen urun kodunda bir daha ortaya cikmasin"). Ayni
 * yaklasim nginxContract, portalReality ve secretSafety testlerinde de
 * kullaniliyor.
 *
 * Tarama kapsami BILEREK dar: yalnizca `src/` altindaki URUN kaynagi.
 * Test dosyalari, fixture'lar ve build ciktisi haric — aksi halde kural
 * kendi test kodunu ihlal sayardi.
 * =============================================================================
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = 'src'

/** Urun kaynagindaki dosyalari gezer (test/fixture haric). */
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

/** Yorum satirlarini atar — yasak kelime aciklamada gecebilir. */
const codeOnly = (text) =>
    text
        .split('\n')
        .filter((l) => {
            const t = l.trim()
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
        })
        .join('\n')

describe('motion borcu', () => {
    it('urun kaynaginda `transition: all` YOK', () => {
        /*
         * `transition: all` degisen HER ozelligi animasyona sokar: layout
         * ozellikleri de dahil olur, gereksiz compositing isi cikar ve
         * beklenmedik gecisler gorunur. Her kullanim, gercekten degisen
         * ozelliklerle sinirlandirildi.
         */
        const offenders = []
        for (const f of walk(SRC, ['.css', '.jsx', '.js'])) {
            for (const [i, line] of read(f).split('\n').entries()) {
                if (/transition:\s*all\b/.test(line)) offenders.push(`${f}:${i + 1}`)
            }
        }
        expect(offenders).toEqual([])
    })

    it('azaltilmis hareket destegi KORUNUYOR', () => {
        // prefers-reduced-motion blogu silinmemeli: orada `!important`
        // ZORUNLUDUR (kullanicinin sistem tercihi her seyi yenmelidir).
        const tokens = read(join(SRC, 'styles/tokens.css'))
        expect(tokens).toContain('prefers-reduced-motion')
        expect(tokens).toMatch(/animation-duration:\s*0\.01ms\s*!important/)
    })
})

describe('erisilebilirlik kilitleri', () => {
    /** `<Button ...>` bloklarini susulu-parantez farkindalikla ayikla. */
    const buttonBlocks = (src) => {
        const out = []
        let i = 0
        for (;;) {
            i = src.indexOf('<Button', i)
            if (i < 0) break
            let j = i + 7
            let depth = 0
            let inStr = false
            let quote = ''
            while (j < src.length) {
                const c = src[j]
                if (inStr) {
                    if (c === quote) inStr = false
                } else if (c === '"' || c === "'" || c === '`') {
                    inStr = true
                    quote = c
                } else if (c === '{') depth += 1
                else if (c === '}') depth -= 1
                else if (c === '>' && depth === 0) break
                j += 1
            }
            out.push(src.slice(i, j + 1))
            i = j + 1
        }
        return out
    }

    it('ikon-only butonlarin HEPSININ erisilebilir adi var', () => {
        /*
         * AntD `Tooltip` erisilebilir ad VERMEZ (portala cizer, `title`
         * attribute'u basmaz). Ikon-only bir buton adsizsa ekran okuyucu
         * kullanicisi ne yaptigini bilemez.
         */
        const offenders = []
        for (const f of walk(SRC, ['.jsx'])) {
            const src = read(f)
            for (const block of buttonBlocks(src)) {
                if (!block.includes('icon=')) continue
                // Yalnizca cocuk metni OLMAYAN (self-closing) butonlar.
                if (!block.trimEnd().endsWith('/>')) continue
                if (block.includes('aria-label') || block.includes('title=')) continue
                offenders.push(`${f}: ${block.slice(0, 60).replace(/\s+/g, ' ')}`)
            }
        }
        expect(offenders).toEqual([])
    })

    it('TaskCard koku ARTIK bir buton DEGIL (ic ice interaktif yasagi)', () => {
        /*
         * Kart koku `role="button"` iken ICINDE checkbox ve aksiyon
         * butonlari vardi: bir buton rolunun icinde baska interaktif
         * kontroller. Gecersiz semantik; `stopPropagation` ile ORTULMEZ,
         * HTML ile cozulur.
         */
        const card = codeOnly(read(join(SRC, 'components/tasks/TaskCard.jsx')))
        const rootIdx = card.indexOf('className={className}')
        expect(rootIdx).toBeGreaterThan(-1)
        const rootTag = card.slice(rootIdx - 40, rootIdx + 200)
        expect(rootTag).not.toContain('role="button"')
        expect(rootTag).not.toContain('tabIndex')
    })

    it('karti ACAN kontrol GERCEK bir buton ve adi var', () => {
        const card = read(join(SRC, 'components/tasks/TaskCard.jsx'))
        // Baslik artik <button type="button"> ve erisilebilir ad tasiyor.
        expect(card).toMatch(/<button\s+type="button"[\s\S]*?task-card-open/)
        expect(card).toMatch(/task-card-open[\s\S]{0,400}aria-label=/)
    })

    it('acma kontrolunde gorunur odak halkasi var', () => {
        const css = read(join(SRC, 'components/tasks/TaskCard.css'))
        expect(css).toMatch(/\.task-card-open:focus-visible\s*\{[^}]*outline/)
    })

    it('WorkLogCard koku da buton DEGIL (final QA bulgusu, ayni recete)', () => {
        // Time Entry kartinda ayni gecersiz desen vardi: role="button"
        // kok + icinde duzenle/sil butonlari. Ayni cozum uygulandi.
        const card = codeOnly(read(join(SRC, 'components/time-entry/WorkLogCard.jsx')))
        expect(card).not.toContain('role="button"')
        const css = read(join(SRC, 'components/time-entry/WorkLogCard.css'))
        expect(css).toMatch(/\.worklog-card-open:focus-visible\s*\{[^}]*outline/)
    })
})

describe('AntD borcu', () => {
    const DEPRECATED = [
        'destroyOnClose', 'dropdownRender', 'dropdownClassName', 'dropdownStyle',
        'onVisibleChange', 'bodyStyle', 'headStyle', 'strokeWidth',
        'overlayClassName', 'overlayStyle',
    ]

    it('deprecated AntD prop KULLANIMI yok', () => {
        const offenders = []
        for (const f of walk(SRC, ['.jsx'])) {
            const src = codeOnly(read(f))
            for (const prop of DEPRECATED) {
                if (new RegExp(`\\b${prop}\\s*=`).test(src)) offenders.push(`${f}: ${prop}`)
            }
        }
        expect(offenders).toEqual([])
    })

    it('AntD `App.useApp()` KULLANILMIYOR — provider yok', () => {
        /*
         * Uygulama kokunde (Root.jsx) antd'nin `<App>` provider'i YOKTUR;
         * oradaki `<App />` bizim kendi bilesenimizdir. `App.useApp()`
         * provider'siz cagrilinca donen nesnenin `message`i CALISMAZ ve
         * ilk toast denemesinde `message.error is not a function` ile
         * patlar — testte degil, KULLANICIDA.
         *
         * Repo konvansiyonu statik import: `import { message } from 'antd'`.
         * (Canli olarak yakalandi: yeni ticket ekranlarinin tamami bu
         * hatayla yazilmisti.)
         */
        const offenders = []
        for (const f of walk(SRC, ['.jsx'])) {
            if (/App\.useApp\s*\(/.test(codeOnly(read(f)))) offenders.push(f)
        }
        expect(offenders).toEqual([])
    })

    it('Table rowKey INDEX parametresi kullanmiyor', () => {
        // AntD 5.x: `rowKey`in index parametresi deprecated — siralama ya
        // da filtreleme sonrasi ayni index farkli satiri gosterir.
        const offenders = []
        for (const f of walk(SRC, ['.jsx'])) {
            const src = codeOnly(read(f))
            if (/rowKey=\{\s*\([^)]*,\s*\w+\s*\)/.test(src)) offenders.push(f)
        }
        expect(offenders).toEqual([])
    })
})

describe('urun kodu hijyeni', () => {
    it('urun kaynaginda console.log/debug YOK', () => {
        const offenders = []
        for (const f of walk(SRC, ['.jsx', '.js'])) {
            // Developer Portal ORNEK KOD dizeleri haric: onlar gelistiriciye
            // gosterilen dokumantasyon, uygulamanin kendi ciktisi degil.
            if (f.includes('developer/sections/CodeExamplesSection')) continue
            for (const [i, line] of read(f).split('\n').entries()) {
                const t = line.trim()
                if (t.startsWith('//') || t.startsWith('*')) continue
                if (/console\.(log|debug)\s*\(/.test(line)) offenders.push(`${f}:${i + 1}`)
            }
        }
        expect(offenders).toEqual([])
    })

    it('effect icindeki listener/timer TEMIZLENIYOR', () => {
        const offenders = []
        for (const f of walk(SRC, ['.jsx'])) {
            const src = read(f)
            const re = /useEffect\(\s*\(\)\s*=>\s*\{/g
            let m
            while ((m = re.exec(src)) !== null) {
                let i = m.index + m[0].length - 1
                let depth = 0
                for (; i < src.length; i += 1) {
                    if (src[i] === '{') depth += 1
                    else if (src[i] === '}') {
                        depth -= 1
                        if (depth === 0) break
                    }
                }
                const body = src.slice(m.index, i)
                const needsCleanup = /addEventListener|set(Interval|Timeout)\(/.test(body)
                if (needsCleanup && !/return\s*\(?\s*\)?\s*=>/.test(body)) {
                    offenders.push(`${f}:${src.slice(0, m.index).split('\n').length}`)
                }
            }
        }
        expect(offenders).toEqual([])
    })
})

describe('lazy-loading siniri', () => {
    it('en az 19 route lazy kalir', () => {
        const app = read(join(SRC, 'App.jsx'))
        const lazyCount = (app.match(/lazy\(routeLoaders/g) || []).length
        expect(lazyCount).toBeGreaterThanOrEqual(19)
    })

    it('Admin/Reports/Portal rotalari lazy loader FONKSIYONU uzerinden gelir', () => {
        const loaders = read(join(SRC, 'routes/loaders.js'))
        for (const key of ['reports', 'apiManagement', 'developerPortal', 'users']) {
            expect(loaders).toContain(key)
        }
    })
})

describe('!important politikasi', () => {
    /*
     * Sprint 7 baslangici 411 idi; olu CSS temizligiyle 383'e indi.
     * Kalanin buyuk cogunlugu AntD/third-party override'idir: AntD stilini
     * CSS-in-JS ile enjekte eder ve pek cok yerde specificity ile yenmek
     * MUMKUN DEGILDIR. Bunlari mekanik silmek gorsel regresyon uretirdi.
     *
     * Bu yuzden kural "sifir" degil, TAVAN: sayi ARTMAMALI. Yeni bir
     * override gerekiyorsa once ortak component/token seviyesinde
     * cozulmeli.
     */
    const CEILING = 383

    it('urun kaynagindaki !important sayisi TAVANI asmaz', () => {
        let count = 0
        for (const f of walk(SRC, ['.css', '.jsx', '.js'])) {
            count += (read(f).match(/!important/g) || []).length
        }
        expect(count).toBeLessThanOrEqual(CEILING)
    })

    it('olu CSS geri gelmedi (Sprint 5te yerini alan siniflar)', () => {
        // `.excel-export-btn` Sprint 5'te `.te-export-btn` ile
        // degistirilmisti ama eski blok iki kez kopyalanmis halde
        // kalmisti; tek basina 26 !important tasiyordu.
        const css = read(join(SRC, 'pages/TimeEntryPage.css'))
        expect(css).not.toContain('.excel-export-btn {')
        expect(css).toContain('.te-export-btn')
    })
})
