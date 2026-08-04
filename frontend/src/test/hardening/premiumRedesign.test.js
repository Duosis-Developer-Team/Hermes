/**
 * =============================================================================
 * Premium redesign — yapisal kabul kilitleri (KAYNAK TARAMASI)
 * =============================================================================
 * Onceki tur "yalniz token/renk" duzeyinde kalmisti. Bu kilitler, YAPISAL
 * kararlarin geri donmesini engeller:
 *   1. Ortak primitifler tek kaynakta (ui.css) tanimli.
 *   2. Dashboard/Reports/Contracts: ayri KPI kartlari yerine metric strip.
 *   3. Buyuk gri/blur toolbar seritleri geri gelmez.
 *   4. Tasks board kolonlari zeminsiz; filtreler drawer'da.
 *   5. Emoji ikonlar urun yuzeylerinde yok.
 *   6. PM Config bolumleri Card degil section-row.
 *   7. Yeni CSS'te !important ve transition:all yok.
 * =============================================================================
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = 'src'
const read = (f) => readFileSync(join(SRC, f), 'utf8')
const noComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')

describe('ortak primitifler tek kaynakta', () => {
    it('metric strip + section + inline toolbar ui.css te tanimli', () => {
        const css = read('components/ui/ui.css')
        for (const cls of [
            '.h-metric-strip', '.h-metric-strip__item', '.h-metric-strip__value',
            '.h-section', '.h-section__title', '.h-inline-toolbar', '.h-dataview',
        ]) {
            expect(css, cls).toContain(cls)
        }
    })

    it('premium koprusu !important ve transition:all icermez', () => {
        const css = noComments(read('styles/premium.css'))
        expect(css).not.toContain('!important')
        expect(css).not.toMatch(/transition:\s*all\b/)
    })

    it('light tuval near-white tokena baglandi (gri levha degil)', () => {
        const tokens = read('styles/tokens.css')
        expect(tokens).toContain('--hp-neutral-25')
        expect(tokens).toMatch(/\[data-theme='light'\][\s\S]*--h-bg-canvas:\s*var\(--hp-neutral-25\)/)
    })
})

describe('KPI kartlari metric stripe donustu', () => {
    it('Dashboard eski stat-card yigini kullanmiyor', () => {
        const jsx = noComments(read('pages/DashboardPage.jsx'))
        expect(jsx).toContain('h-metric-strip')
        expect(jsx).not.toContain('className="stat-card"')
    })

    it('Reports uc stat-card yerine strip + kompakt download kullaniyor', () => {
        const jsx = noComments(read('pages/ReportsPage.jsx'))
        expect(jsx).toContain('h-metric-strip')
        expect(jsx).not.toContain('className="stat-card"')
        expect(jsx).toContain('Download CSV')
    })

    it('Contract Status health strip kullaniyor', () => {
        const jsx = noComments(read('pages/admin/ContractStatusPage.jsx'))
        expect(jsx).toContain('h-metric-strip')
        expect(jsx).not.toContain('modern-stat-card')
    })

    it('PM Configurations metrikleri zeminsiz striptir', () => {
        const css = noComments(read('pages/admin/TaskManagementPage.css'))
        const block = css.slice(css.indexOf('.tm-stat {'), css.indexOf('.tm-stat-icon'))
        expect(block).toContain('background: transparent')
        expect(block).not.toMatch(/border-radius:\s*14px/)
    })
})

describe('buyuk gri seritler ve panel yiginlari kalkti', () => {
    it('Billable/Contracts blur+dolu toolbar kullanmiyor', () => {
        for (const f of ['pages/BillableHoursPage.jsx', 'pages/admin/ContractStatusPage.jsx']) {
            const jsx = noComments(read(f))
            expect(jsx, f).not.toContain('backdropFilter')
            expect(jsx, f).toContain('h-inline-toolbar')
        }
    })

    it('Reports filtre paneli dolu Card zemini kullanmiyor', () => {
        const jsx = noComments(read('pages/ReportsPage.jsx'))
        expect(jsx).not.toMatch(/background:\s*'var\(--bg-secondary\)'/)
        expect(jsx).toContain('More filters')
    })

    it('PM Config bolumleri Card degil section-row', () => {
        const css = noComments(read('pages/admin/TaskManagementPage.css'))
        const block = css.slice(css.indexOf('.tm-section {'), css.indexOf('.tm-section-head'))
        expect(block).toContain('background: transparent')
        expect(block).toContain('border-top')
    })
})

describe('Tasks yuzeyi', () => {
    it('board kolonlari zeminsiz (buyuk gri dikdortgen yok)', () => {
        const css = noComments(read('components/tasks/TasksBoardView.css'))
        const block = css.slice(css.indexOf('.tasks-board-column {'), css.indexOf('.tasks-board-column-header'))
        expect(block).toContain('background: transparent')
        expect(block).toMatch(/border:\s*0/)
    })

    it('gelismis filtreler drawer icinde (surekli acik serit degil)', () => {
        const jsx = noComments(read('pages/TasksPage.jsx'))
        expect(jsx).toContain('<Drawer')
        expect(jsx).toMatch(/Filters/)
    })

    it('durum/oncelik rozetleri tonal (koyu dolu hex yok)', () => {
        const css = noComments(read('components/tasks/TaskCard.css'))
        const block = css.slice(css.indexOf('.task-card-priority-low'), css.indexOf('.task-card-code'))
        expect(block).not.toMatch(/#(1e3a8a|166534|b91c1c|b45309|1d4ed8)/)
        expect(block).toContain('color-mix')
    })
})

describe('ikonografi', () => {
    it('urun sayfalarinda emoji baslik/ikon yok', () => {
        const files = [
            'pages/admin/UsersPage.jsx', 'pages/admin/CustomersPage.jsx',
            'pages/admin/ProjectsPage.jsx', 'pages/admin/WorkTypesPage.jsx',
            'pages/admin/RolesTab.jsx', 'pages/DashboardPage.jsx',
        ]
        const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
        for (const f of files) {
            const code = noComments(read(f))
                .split('\n')
                .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
                .join('\n')
            expect(EMOJI.test(code), f).toBe(false)
        }
    })

    it('Roles kolon basliklari ve rozetleri Ingilizce', () => {
        const jsx = read('pages/admin/RolesTab.jsx')
        expect(jsx).not.toMatch(/title: '(ROL|DURUM)'/)
        expect(jsx).not.toMatch(/'(Aktif|Pasif)'/)
    })
})
