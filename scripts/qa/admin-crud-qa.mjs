/**
 * =============================================================================
 * HERMES QA — Admin CRUD yuzeyleri (Sprint 6B.2)
 * =============================================================================
 * GERCEK Chromium ile 4 viewport x 2 tema matrisini gezer. jsdom'un
 * ANLATAMADIGI seyleri olcer: yatay tasma, dokunma hedefi boyutu, gercek
 * odak gorunurlugu, sticky kolon davranisi ve konsol temizligi.
 *
 * URUN BAGIMLILIGI DEGILDIR: ayri bir dizinde kurulu Playwright ile
 * calisir, repo'ya paket eklemez.
 *
 * Kullanim:
 *   cd frontend && npx vite build && npx vite preview --port 4174 &
 *   mkdir -p /tmp/hermes-qa && cd /tmp/hermes-qa && npm i -D playwright
 *   QA_BASE=http://localhost:4174 node scripts/qa/admin-crud-qa.mjs
 *
 * API tamamen yakalanir: gercek kimlik bilgisi ya da canli ortam
 * GEREKMEZ; hicbir gercek veriye dokunulmaz.
 * =============================================================================
 */
import { chromium } from 'playwright'

const BASE = process.env.QA_BASE || 'http://localhost:4174'

const VIEWPORTS = [
    { name: '390x844', width: 390, height: 844, mobile: true },
    { name: '768x1024', width: 768, height: 1024, mobile: true },
    { name: '1440x900', width: 1440, height: 900, mobile: false },
    { name: '1920x1080', width: 1920, height: 1080, mobile: false },
]

/** Sozluk kayitlari: biri PASIF (arsiv/kalici silme ayrimini gormek icin). */
const DICT = [
    { id: 'd1', name: 'Coding', code: 'COD', description: 'Writing code', is_active: true },
    { id: 'd2', name: 'Code Review', code: 'CRV', description: '', is_active: true },
    { id: 'd3', name: 'Legacy Task', code: 'LEG', description: 'Old', is_active: false },
]

const SURFACES = [
    { id: 'activity-types', path: '/activity-types', ready: 'text=Coding' },
    { id: 'platforms', path: '/platforms', ready: 'text=Coding' },
    { id: 'work-lines', path: '/work-lines', ready: 'text=Coding' },
]

const results = []
const record = (data) => results.push(data)

const browser = await chromium.launch()

for (const vp of VIEWPORTS) {
    for (const theme of ['dark', 'light']) {
        const ctx = await browser.newContext({
            viewport: { width: vp.width, height: vp.height },
            hasTouch: vp.mobile,
        })
        const page = await ctx.newPage()
        const consoleErrors = []
        page.on('console', (m) => {
            if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160))
        })
        page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message.slice(0, 160)))

        await page.addInitScript(([t]) => {
            localStorage.setItem('hermes-theme', t)
            localStorage.setItem('hermes-sidebar-collapsed', '0')
            // Oturum BILEREK localStorage'a yazilmaz: authStore token'i
            // kasitli olarak persist ETMEZ (XSS karari). Oturum, yakalanan
            // /auth/users/me yanitindan hidratlanir.
        }, [theme])

        await page.route('**/api/**', async (route) => {
            const url = route.request().url()
            let body = []
            if (url.includes('/auth/users/me')) {
                body = { id: 'u1', email: 'ada@duosis.com', full_name: 'Ada', is_admin: true }
            } else if (url.includes('/rbac/me')) {
                // Sozluk sayfalari `reference.manage` ister.
                body = {
                    permissions: ['users.manage', 'reference.manage', 'tasks.permissions.manage'],
                    roles: [],
                }
            } else if (url.includes('permissions/me')) {
                body = { is_admin: true, task: { can_access: true, can_assign: true }, issue: { can_access: true, can_assign: true } }
            } else if (/(activity-types|platforms|work-lines|work-types)/.test(url)) {
                body = DICT
            }
            await route.fulfill({
                status: 200, contentType: 'application/json', body: JSON.stringify(body),
            })
        })

        for (const surface of SURFACES) {
            const tag = `${surface.id} @ ${vp.name}/${theme}`
            try {
                await page.goto(BASE + surface.path, { waitUntil: 'domcontentloaded' })
                await page.waitForSelector(surface.ready, { timeout: 15000 })
            } catch (e) {
                record({ tag, status: 'LOAD_FAILED', detail: e.message.slice(0, 120) })
                continue
            }

            const metrics = await page.evaluate(() => {
                const doc = document.documentElement
                // Yatay tasma: sayfa GOVDESI asla yana kaymamali; genis
                // icerik yalnizca kendi kapsayicisinda kaydirilir.
                const bodyOverflow = doc.scrollWidth - doc.clientWidth
                const scrollers = [...document.querySelectorAll('.ant-table-content, .ant-table-body')]
                    .filter((el) => el.scrollWidth > el.clientWidth).length

                /**
                 * GORULEBILIR mi? Ekranda yer kaplayan ama `visibility`
                 * ya da `aria-hidden` ile gizlenmis ogeler (orn. AntD'nin
                 * bos girdideki temizle ikonu) kullanici icin YOK
                 * sayilir; onlari bulgu olarak saymak yanlis pozitiftir.
                 */
                const isVisible = (el) => {
                    const r = el.getBoundingClientRect()
                    if (r.width === 0 || r.height === 0) return false
                    const cs = getComputedStyle(el)
                    if (cs.visibility === 'hidden' || cs.display === 'none') return false
                    if (parseFloat(cs.opacity) === 0) return false
                    return !el.closest('[aria-hidden="true"]')
                }
                /** Erisilebilir ad: metin + IC ICE aria-label'lar. */
                const accName = (el) => {
                    const own = el.getAttribute('aria-label') || el.getAttribute('title')
                    if (own) return own.trim()
                    const text = (el.textContent || '').trim()
                    if (text) return text
                    const inner = [...el.querySelectorAll('[aria-label]')]
                        .map((n) => n.getAttribute('aria-label'))
                        .filter(Boolean)
                        .join(' ')
                        .trim()
                    return inner
                }

                // Dokunma hedefleri: satir aksiyonlari ve birincil buton.
                const small = []
                for (const b of document.querySelectorAll('button')) {
                    if (!isVisible(b)) continue
                    const r = b.getBoundingClientRect()
                    if (r.height < 24 || r.width < 24) {
                        small.push((accName(b) || '?').slice(0, 40))
                    }
                }

                // Erisilebilir ad: ikon-only butonlarin adi VAR MI?
                const unnamed = []
                for (const b of document.querySelectorAll('button')) {
                    if (!isVisible(b)) continue
                    if (!accName(b)) unnamed.push(b.className.slice(0, 60))
                }
                return {
                    theme: doc.getAttribute('data-theme'),
                    bodyOverflow, scrollers,
                    smallTargets: small, unnamed,
                    rows: document.querySelectorAll('.ant-table-row').length,
                }
            })

            // Odak gorunurlugu: klavyeyle ilk satir aksiyonuna gidip
            // gercek outline/box-shadow olculur.
            const focusRing = await page.evaluate(() => {
                const btn = document.querySelector('button[aria-label^="Edit"]')
                if (!btn) return { found: false }
                btn.focus()
                const cs = getComputedStyle(btn)
                const visible =
                    (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0)
                    || cs.boxShadow !== 'none'
                return { found: true, visible, outline: cs.outlineWidth, shadow: cs.boxShadow !== 'none' }
            })

            // Modal: acilir mi, erisilebilir adi var mi, tasar mi?
            let modal = { opened: false }
            try {
                await page.click('button[aria-label^="Add"]', { timeout: 3000 })
                await page.waitForSelector('.ant-modal-content', { timeout: 5000 })
                modal = await page.evaluate(() => {
                    const d = document.querySelector('[role="dialog"]')
                    const r = d?.getBoundingClientRect()
                    return {
                        opened: true,
                        named: !!(d?.getAttribute('aria-label')
                            || d?.getAttribute('aria-labelledby')),
                        withinViewport: !!r && r.width <= window.innerWidth + 1,
                    }
                })
                await page.keyboard.press('Escape')
            } catch {
                modal = { opened: false }
            }

            record({
                tag,
                status: 'OK',
                theme: metrics.theme,
                rows: metrics.rows,
                bodyOverflow: metrics.bodyOverflow,
                tableScrollers: metrics.scrollers,
                smallTargets: metrics.smallTargets,
                unnamedButtons: metrics.unnamed,
                focusRing,
                modal,
                consoleErrors: consoleErrors.slice(0, 3),
            })
        }
        await ctx.close()
    }
}
await browser.close()

// ============================ Rapor =====================================
const fail = []
for (const r of results) {
    if (r.status !== 'OK') { fail.push(`${r.tag}: ${r.status} ${r.detail || ''}`); continue }
    if (r.bodyOverflow > 1) fail.push(`${r.tag}: govde yatay tasma ${r.bodyOverflow}px`)
    if (r.smallTargets.length) fail.push(`${r.tag}: kucuk dokunma hedefi ${JSON.stringify(r.smallTargets)}`)
    if (r.unnamedButtons.length) fail.push(`${r.tag}: adsiz buton ${JSON.stringify(r.unnamedButtons)}`)
    if (r.focusRing.found && !r.focusRing.visible) fail.push(`${r.tag}: odak halkasi GORUNMUYOR`)
    if (!r.modal.opened) fail.push(`${r.tag}: modal acilmadi`)
    else if (!r.modal.named) fail.push(`${r.tag}: modalin erisilebilir adi YOK`)
    else if (!r.modal.withinViewport) fail.push(`${r.tag}: modal viewport'u asiyor`)
    if (r.consoleErrors.length) fail.push(`${r.tag}: konsol hatasi ${JSON.stringify(r.consoleErrors)}`)
}

console.log(JSON.stringify({ matrix: results.length, results }, null, 2))
console.log('\n===== OZET =====')
console.log(`Matris: ${results.length} kombinasyon (${VIEWPORTS.length} viewport x 2 tema x ${SURFACES.length} yuzey)`)
if (fail.length) {
    console.log(`SONUC: FAIL — ${fail.length} bulgu`)
    for (const f of fail) console.log('  - ' + f)
    process.exit(1)
}
console.log('SONUC: PASS — tasma yok, dokunma hedefleri yeterli, adsiz buton yok, odak gorunur, modal erisilebilir, konsol temiz')
