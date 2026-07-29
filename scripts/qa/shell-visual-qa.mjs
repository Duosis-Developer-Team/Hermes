/**
 * =============================================================================
 * HERMES - Shell gorsel QA harness (Sprint 3)
 * =============================================================================
 * GERCEK Chromium ile shell matrisini gezer: 4 viewport x 2 tema x
 * (expanded/collapsed/drawer/focus/reduced-motion), screenshot uretir ve
 * otomatik kontrol yapar: yatay tasma, sidebar-icerik cakismasi, z-index,
 * tema drift (canvas token vs gercek body bg), focus halkasi, console error.
 *
 * URUN BAGIMLILIGI DEGILDIR: playwright package.json'a EKLENMEZ.
 * Kullanim:
 *   cd frontend && npx vite build && npx vite preview --port 4174 &
 *   mkdir -p /tmp/hermes-qa && cd /tmp/hermes-qa && npm i -D playwright
 *   npx playwright install chromium
 *   QA_BASE=http://localhost:4174 QA_OUT=./shots node <repo>/scripts/qa/shell-visual-qa.mjs
 *
 * Backend GEREKMEZ: tum /api istekleri sahte JSON ile karsilanir.
 * =============================================================================
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.QA_BASE || 'http://localhost:4173'
const OUT = process.env.QA_OUT || './shots'
mkdirSync(OUT, { recursive: true })

const USER = { id: 'u1', email: 'ada@duosis.com',
    full_name: 'Ada Lovelace Çok Uzun Bir Kullanıcı Adı', is_admin: false }
const PERMS = { permissions: ['reports.view', 'customers.manage',
    'projects.manage', 'reference.manage', 'users.manage',
    'api.manage', 'tasks.permissions.manage'], roles: [] }

const VIEWPORTS = [
    { name: '390x844', width: 390, height: 844, mobile: true },
    { name: '768x1024', width: 768, height: 1024, mobile: true },
    { name: '1440x900', width: 1440, height: 900, mobile: false },
    { name: '1920x1080', width: 1920, height: 1080, mobile: false },
]

const results = []
const record = (id, checks, extra = {}) => results.push({ id, ...checks, ...extra })

const browser = await chromium.launch()

for (const vp of VIEWPORTS) {
    for (const theme of ['dark', 'light']) {
        for (const reduced of [false, ...(vp.name === '1440x900' && theme === 'dark' ? [true] : [])]) {
            const ctx = await browser.newContext({
                viewport: { width: vp.width, height: vp.height },
                reducedMotion: reduced ? 'reduce' : 'no-preference',
            })
            const page = await ctx.newPage()
            const consoleErrors = []
            page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
            page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))

            // API mock: kimlik + izinler + bos listeler
            await page.route('**/api/**', async (route) => {
                const url = route.request().url()
                let body = {}
                if (url.includes('/auth/users/me')) body = USER
                else if (url.includes('/rbac/me')) body = PERMS
                else if (url.includes('/permissions/me')) body = {
                    is_admin: false, scopes: { task: { access: true, assign: false },
                    issue: { access: false, assign: false } },
                    assignable_user_ids: [], assignable_group_ids: [] }
                else if (url.includes('/work-logs') || url.includes('/plan-times')) body = { data: [] }
                else body = { data: [] }
                await route.fulfill({ status: 200, contentType: 'application/json',
                    body: JSON.stringify(body) })
            })

            await page.addInitScript(([t]) => {
                localStorage.setItem('hermes-theme', t)
                localStorage.setItem('hermes-sidebar-collapsed', '0')
            }, [theme])

            await page.goto(BASE + '/time-entry', { waitUntil: 'networkidle' })
            await page.waitForSelector('.main-header', { state: 'visible', timeout: 15000 })
            await page.waitForTimeout(400)

            const tag = `${vp.name}-${theme}${reduced ? '-reduced' : ''}`

            // --- otomatik kontroller ---
            const checks = await page.evaluate(() => {
                const doc = document.documentElement
                const hOverflow = doc.scrollWidth > doc.clientWidth + 1
                const header = document.querySelector('.main-header')
                const sider = document.querySelector('.main-sider')
                const content = document.querySelector('.main-content')
                const z = (el) => el ? getComputedStyle(el).zIndex : null
                // sidebar ↔ content cakismasi (desktop'ta yan yana olmali)
                let overlap = false
                if (sider && content && sider.offsetWidth > 0 && getComputedStyle(sider).display !== 'none') {
                    const a = sider.getBoundingClientRect()
                    const b = content.getBoundingClientRect()
                    overlap = a.right > b.left + 2
                }
                // tema drift: canvas degiskeni gercekten uygulanmis mi
                const canvas = getComputedStyle(doc).getPropertyValue('--h-bg-canvas').trim()
                const bodyBg = getComputedStyle(document.body).backgroundColor
                return {
                    horizontalOverflow: hOverflow,
                    headerZ: z(header), siderZ: z(sider),
                    sidebarContentOverlap: overlap,
                    canvasToken: canvas, bodyBg,
                    theme: doc.getAttribute('data-theme'),
                }
            })

            await page.screenshot({ path: `${OUT}/${tag}-expanded.png`, fullPage: false })

            // --- durum varyasyonlari ---
            if (vp.mobile) {
                await page.click('button[aria-label="Toggle navigation"]')
                await page.waitForTimeout(450)
                const drawerOpen = await page.locator('.ant-drawer').count()
                const bodyLocked = await page.evaluate(() => document.body.style.overflow)
                await page.screenshot({ path: `${OUT}/${tag}-drawer-open.png` })
                record(`${tag}-drawer`, checks, {
                    drawerOpen: drawerOpen > 0, bodyScrollLocked: bodyLocked === 'hidden',
                    consoleErrors: consoleErrors.length,
                })
                await page.keyboard.press('Escape')
                await page.waitForTimeout(400)
            } else {
                // collapsed
                await page.click('button[aria-label="Toggle navigation"]')
                await page.waitForTimeout(450)
                const collapsedW = await page.evaluate(() =>
                    document.querySelector('.main-sider')?.offsetWidth)
                await page.screenshot({ path: `${OUT}/${tag}-collapsed.png` })
                // keyboard focus halkasi
                await page.keyboard.press('Tab'); await page.keyboard.press('Tab')
                const focusRing = await page.evaluate(() => {
                    const el = document.activeElement
                    if (!el || el === document.body) return null
                    const cs = getComputedStyle(el)
                    return { tag: el.tagName, outline: cs.outlineStyle,
                        width: cs.outlineWidth, boxShadow: cs.boxShadow !== 'none' }
                })
                await page.screenshot({ path: `${OUT}/${tag}-focus.png` })
                record(`${tag}-desktop`, checks, {
                    collapsedWidth: collapsedW,
                    focusVisible: !!(focusRing && (focusRing.outline !== 'none' || focusRing.boxShadow)),
                    focusTarget: focusRing?.tag ?? null,
                    consoleErrors: consoleErrors.length,
                })
            }

            // aktif rota kontrolu
            const activeText = await page.locator('.ant-menu-item-selected').first()
                .textContent().catch(() => null)
            results[results.length - 1].activeNav = (activeText || '').trim()

            await ctx.close()
        }
    }
}
await browser.close()
console.log(JSON.stringify(results, null, 1))
