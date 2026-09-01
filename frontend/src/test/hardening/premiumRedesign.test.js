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
        // Metin artik sozlukte (i18n): kaynak duz Ingilizce TASIMAZ.
        // Kilitlenen sey metnin kendisi degil, KOMPAKT indirme
        // eyleminin varligiydi — anahtar uzerinden dogrulanir.
        expect(jsx).toContain("reports.downloadCsv")
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
        // NOT: bu kilit ilk yazildiginda filtreler "More filters" arkasina
        // alinmisti; o karar KULLANICI TARAFINDAN REDDEDILDI (temel
        // filtreler gorunmez kaliyordu). Kalan sozlesme: panel dolu gri
        // zemin kullanmaz ve filtreler hafif toolbar'da yasar.
        const jsx = noComments(read('pages/ReportsPage.jsx'))
        expect(jsx).not.toMatch(/background:\s*'var\(--bg-secondary\)'/)
        expect(jsx).toContain('reports-filter-toolbar')
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
        /* Kilidin NIYETI degismedi: filtreler surekli acik bir serit
           degil, bir drawer icinde yasar. Drawer, TasksPage'den ayri bir
           bilesene TASINDI (sayfa <450 satir yapisal kilidi) — bu yuzden
           kontrol o bilesende yapilir ve sayfanin ONU KULLANDIGI ayrica
           dogrulanir. */
        const drawer = noComments(read('features/tasks/components/TaskFiltersDrawer.jsx'))
        expect(drawer).toContain('<Drawer')
        expect(drawer).toMatch(/Filters/)
        const jsx = noComments(read('pages/TasksPage.jsx'))
        expect(jsx).toContain('<TaskFiltersDrawer')
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

describe('duzeltme turu (2026-08-04) kilitleri', () => {
    it('Reports temel filtreleri gizleyen "More filters" GERI GELMEZ', () => {
        const jsx = noComments(read('pages/ReportsPage.jsx'))
        expect(jsx).not.toContain('More filters')
        expect(jsx).not.toContain('moreFiltersOpen')
        // Uc filtre de erisilebilir ad tasir (placeholder ad DEGILDIR).
        // i18n sonrasi ad sozlukten gelir; kilit ANAHTAR uzerindedir.
        // Anahtarlarin gercek metni `test/i18n/locale.test.jsx`
        // tarafindan ayrica dogrulanir.
        for (const key of [
            'reports.filterByProject',
            'reports.filterByType',
            'reports.filterByPlatform',
        ]) {
            expect(jsx, key).toContain(key)
        }
    })

    it('ortak create-action primitive TEK kaynakta ve TE "+" dilini tasir', () => {
        const css = read('components/ui/ui.css')
        expect(css).toContain('.h-create-action')
        expect(css).toContain('.h-inline-action')
        // Hover'da ince mavi ring; dolu parlak mavi zemin YOK.
        const block = css.slice(css.indexOf('.ant-btn.h-create-action {'),
                                css.indexOf('.ant-btn.h-create-action:focus-visible'))
        expect(block).toContain('background: transparent')
        expect(block).toMatch(/border-color:[^;]*h-brand|border: 1px solid var\(--h-border-default\)/)
    })

    it('PM Configurations ve API Management sayfa aksiyonlari solid mavi DEGIL', () => {
        for (const f of ['pages/admin/TaskManagementPage.jsx',
                         'pages/admin/ApiManagementPage.jsx',
                         'pages/admin/AssignmentHierarchyTab.jsx']) {
            const jsx = noComments(read(f))
            // Modal Save/Confirm haric sayfa/section aksiyonlarinda
            // type="primary" kalmamali.
            const primaries = (jsx.match(/type="primary"/g) || []).length
            const submits = (jsx.match(/htmlType="submit"/g) || []).length
            expect(primaries, `${f}: primary=${primaries} submit=${submits}`)
                .toBeLessThanOrEqual(submits)
            expect(jsx).toContain('h-create-action')
        }
    })

    it('collapsed logo kutusu belirgin sekilde buyuk (>=60px)', () => {
        const css = read('components/layout/MainLayout.css')
        const block = css.slice(css.indexOf('.sidebar-logo--icon {'),
                                css.indexOf('.ant-layout-sider-collapsed .sidebar-logo--full'))
        const w = parseInt(block.match(/width:\s*(\d+)px/)?.[1] ?? '0', 10)
        expect(w).toBeGreaterThanOrEqual(60)
    })

    it('modal yuksekligi YAPISAL cozulur — sihirli sayi ile degil', () => {
        /*
         * 2026-08-04 (ikinci tur, olcumle): govdeye verilen sabit
         * `max-height: calc(100vh - 158px)` yanlisti. 158px "baslik +
         * altlik" varsayimidir; baslik/altligi olmayan modallerde
         * (Log Time) 126px'i BOSA harciyor ve sigan icerigi bile
         * kaydiriyordu. Dogru cozum: icerik kutusu dikey flex olur,
         * viewport'a gore sinirlanir; govde kalan alani alir.
         */
        const css = noComments(read('styles/premium.css'))
        const content = css.slice(css.indexOf(':root .ant-modal .ant-modal-content {\n  display: flex'))
        expect(content).toContain('flex-direction: column')
        expect(content).toMatch(/max-height:\s*calc\(100vh - 32px\)/)
        // Govde flex cocugu olarak KUCULEBILMELI (min-height:0 sart).
        expect(css).toMatch(/:root \.ant-modal \.ant-modal-body \{[^}]*min-height:\s*0/)
        // Sabit "govde tavani" varsayimi GERI GELMEZ.
        expect(css).not.toMatch(/\.ant-modal-body \{[^}]*max-height:\s*calc\(100vh - 1\d\dpx\)/)
    })

    it('form-yogun modallar eslenmis satir primitifini kullanir', () => {
        // Dikey yigin, modal yuksekligini belirleyen seydir: Create Task
        // govdesi 816px olcumlenmisti (1440x900'de bile kayiyordu).
        const ui = read('components/ui/ui.css')
        expect(ui).toContain('.h-modal-row')
        expect(ui).toContain('.h-modal-row--3')
        const task = noComments(read('components/modals/CreateTaskModal.jsx'))
        expect(task).toContain('h-modal-row')
        const log = noComments(read('components/modals/LogTimeModal.jsx'))
        expect((log.match(/className="form-row"/g) || []).length).toBeGreaterThanOrEqual(3)
    })

    it('Timesheet gorunumu gri levha kullanmaz', () => {
        const css = noComments(read('components/time-entry/TimesheetView.css'))
        const block = css.slice(css.indexOf('.timesheet-view {'), css.indexOf('.timesheet-table'))
        expect(block).toContain('background: transparent')
        expect(css).not.toContain('background: var(--bg-secondary)')
    })

    it('Mail Notifications satir tabanli (kart yigini degil)', () => {
        const css = noComments(read('pages/admin/TaskManagementPage.css'))
        const block = css.slice(css.indexOf('.tm-notif-row {'), css.indexOf('.tm-notif-head'))
        expect(block).toContain('background: transparent')
        expect(block).toContain('border-top')
    })

    it('performans: sabit-arkaplan repaint ve margin animasyonu kaldirildi', () => {
        const css = noComments(read('components/layout/MainLayout.css'))
        const block = css.slice(css.indexOf('.main-content {'), css.indexOf('.main-content::before'))
        expect(block).not.toContain('background-attachment: fixed')
        expect(block).not.toContain('transition: margin-left')
        // Cift giris animasyonu: .fade-in artik animasyon calistirmaz.
        const idx = read('index.css')
        expect(idx).toMatch(/\.fade-in \{\s*animation: none;/)
    })

    it('idle route prefetch izin filtreli ve tek seferlik', () => {
        const jsx = read('components/layout/MainLayout.jsx')
        expect(jsx).toContain('idlePrefetchDone')
        expect(jsx).toContain('requestIdleCallback')
        // Yalniz izin filtresinden gecmis menu listeleri kullanilir.
        expect(jsx).toMatch(/\[\.\.\.managementItems, \.\.\.configurationItems\]/)
    })
})
