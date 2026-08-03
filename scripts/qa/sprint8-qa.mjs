/**
 * =============================================================================
 * HERMES QA — Sprint 8 kodlama-asamasi matrisi (gorsel cila + Ingilizce)
 * =============================================================================
 * MOCKED/LOCAL QA: API tamamen yakalanir, canli backend KULLANILMAZ.
 *
 * Kapsam (Sprint 8'in dokundugu yuzeyler):
 *   §A collapsed sidebar (logo boyutu, grup basligi artiklari, RBAC bosluklari)
 *   §B List/Timesheet degistirici (tab semantigi, seffaf krom, davranis)
 *   §C sayfa arka plan gradyani (iki tema), hafta sonu tonu, mukerrer ozet
 *   §D Ingilizce sistem metinleri (krom taramasi — kullanici VERISI haric)
 *   + admin yuzeyler (Users tablo+modal, API Management), veri-agir sayfa
 *     (Billable Hours), Tasks list/board.
 *
 * Matris: 4 viewport x 2 tema x yuzeyler; senaryolar 1440x900'de.
 * Ekran goruntuleri: sprint8-shots/ altina yazilir. "Oncesi" goruntusu
 * MUMKUN DEGIL (eski kod calismiyor) — durustce yalniz "sonrasi" alinir.
 *
 * Kullanim:
 *   cd frontend && npx vite build && npx vite preview --port 4174 &
 *   cp scripts/qa/sprint8-qa.mjs /tmp/hermes-qa/ && cd /tmp/hermes-qa
 *   QA_BASE=http://localhost:4174 node sprint8-qa.mjs
 * =============================================================================
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.QA_BASE || 'http://localhost:4174'
const SHOTS = new URL('./sprint8-shots/', import.meta.url).pathname
mkdirSync(SHOTS, { recursive: true })

const VIEWPORTS = [
    { name: '1440x900', width: 1440, height: 900, mobile: false },
    { name: '1280x720', width: 1280, height: 720, mobile: false },
    { name: '768x1024', width: 768, height: 1024, mobile: true },
    { name: '390x844', width: 390, height: 844, mobile: true },
]

const PERMISSIONS = [
    'reports.view', 'customers.manage', 'projects.manage', 'api.manage',
    'users.manage', 'reference.manage', 'tasks.permissions.manage',
    'worklogs.admin', 'meetings.admin', 'plans.manage',
]

const ME = { id: 'u1', email: 'ada@duosis.com', full_name: 'Ada Lovelace', is_admin: true, is_active: true }
const USERS = [
    ME,
    { id: 'u2', full_name: 'Bob Bit', email: 'bob@duosis.com', is_admin: false, is_active: true },
]
const PERMS = {
    is_admin: true,
    task: { can_access: true, can_assign: true },
    issue: { can_access: true, can_assign: true },
}

const monday = (() => {
    const d = new Date()
    const day = (d.getDay() + 6) % 7
    d.setDate(d.getDate() - day)
    return d.toISOString().slice(0, 10)
})()

/* Turkce VERI BILEREK korunur: kullanici verisi cevrilmez kurali bu
   goruntude de kanitlanmali. */
const WORK_LOGS = [{
    id: 'log-1', customer_id: 'c1', project_id: 'p1', work_type_id: 'w1',
    activity_type_id: 'a1', platform_id: null, work_line_id: null,
    date_worked: monday, duration_hours: 2.5, billable_duration_hours: 2,
    description: 'Ilk kayit — Türkçe ğüşiöç', customer_name: 'Vakko',
    project_name: 'ATM', work_type_name: 'Dev', user_id: 'u1',
}]

const TASKS = [
    {
        id: 't1', task_code: 'TASK-1', title: 'Sozlesme ekranini duzelt',
        status: 'in_progress', priority: 'high', task_type: 'task',
        assignee_user_id: 'u1', created_by: 'u2',
        customer_id: 'c1', project_id: 'p1',
        customer_name: 'Vakko', project_name: 'ATM Yenileme',
        due_date: monday,
    },
    {
        id: 't2', task_code: 'TASK-2', title: 'Cok uzun bir gorev basligi ile tasma testi',
        status: 'pending', priority: 'low', task_type: 'task',
        assignee_user_id: 'u2', created_by: 'u1',
        customer_id: 'c1', project_id: 'p1',
        customer_name: 'Vakko', project_name: 'ATM Yenileme',
    },
]

const SURFACES = [
    { id: 'dashboard', path: '/dashboard', ready: 'button[aria-label="Previous month"]' },
    { id: 'time-entry', path: '/time-entry', ready: 'text=Ilk kayit' },
    { id: 'tasks', path: '/project-management/tasks', ready: '.task-card' },
    { id: 'users-admin', path: '/users', ready: 'text=New User' },
    { id: 'api-management', path: '/api-management', ready: '.tm-section-head' },
    { id: 'billable-hours', path: '/management/billable-hours', ready: 'button[aria-label="Previous week"]' },
]

const results = []
const scenarios = []

function installRoutes(page, unexpected, permissions = PERMISSIONS) {
    return page.route('**/*', async (route) => {
        const url = route.request().url()
        if (!url.includes('/api/')) {
            if (url.startsWith(BASE)) return route.continue()
            unexpected.push(url.slice(0, 120))
            return route.abort()
        }
        const has = (s) => url.includes(s)
        let body = []
        if (has('/auth/users/me')) body = ME
        else if (has('/rbac/me')) body = { permissions, roles: [] }
        else if (has('/rbac/roles')) body = []
        else if (has('permissions/me')) body = PERMS
        else if (has('/users/lookup')) body = USERS
        else if (has('/task-permissions')) body = []
        else if (has('/api/v1/auth/users')) body = { data: USERS }
        else if (has('/tasks') && has('comments')) body = []
        else if (has('/tasks') && has('activity')) body = []
        else if (has('/core/tasks')) body = TASKS
        else if (has('/work-logs') || has('worklogs') || has('my-logs')) body = { data: WORK_LOGS }
        else if (has('/plan-times')) body = { data: [] }
        else if (has('/timesheets') || has('period')) body = { status: 'draft' }
        else if (has('/meetings')) body = []
        else if (has('/customers')) body = [{ id: 'c1', name: 'Vakko', code: 'VKK', is_active: true }]
        else if (has('/projects')) body = [{ id: 'p1', customer_id: 'c1', name: 'ATM Yenileme', is_active: true }]
        else if (has('/work-types') || has('/activity-types') || has('/platforms') || has('/work-lines')) {
            body = [{ id: 'w1', name: 'Dev', code: 'DEV', is_active: true }]
        } else if (has('/user-groups') || has('/groups')) body = []
        else if (has('/api-clients') || has('/clients')) body = []
        else if (has('capabilities')) body = { api_version: 'v1', scopes: {}, error_codes: {}, idempotency: {} }
        else if (has('/dashboard')) body = { data: [] }
        else if (has('request-logs')) body = []
        else if (has('cleanup')) body = { request_logs: 0, idempotency_keys: 0 }
        await route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify(body),
        })
    })
}

const METRICS = () => {
    const isVisible = (el) => {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) return false
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || cs.display === 'none') return false
        if (parseFloat(cs.opacity) === 0) return false
        return !el.closest('[aria-hidden="true"]')
    }
    const accName = (el) => {
        const own = el.getAttribute('aria-label') || el.getAttribute('title')
        if (own) return own.trim()
        const text = (el.textContent || '').trim()
        if (text) return text
        return [...el.querySelectorAll('[aria-label]')]
            .map((n) => n.getAttribute('aria-label')).filter(Boolean).join(' ').trim()
    }
    const unnamed = []
    for (const b of document.querySelectorAll('button, [role="button"]')) {
        if (!isVisible(b)) continue
        if (!accName(b)) unnamed.push(b.className.toString().slice(0, 60))
    }

    /*
     * §D Ingilizce KROM taramasi. Kullanici VERISI tasiyan kontroller
     * (kart acma butonlari: aria-label'lari kayit basligini icerir)
     * BILEREK haric — mock verisi kasitli Turkce.
     */
    const TURKISH = /[ğşıİöüçĞŞÖÜÇ]/
    const turkishChrome = []
    const chrome = [
        ...document.querySelectorAll('.ant-menu-item, .ant-menu-item-group-title, th, .view-link, .ant-tabs-tab'),
    ]
    for (const el of chrome) {
        const t = (el.textContent || '').trim()
        if (TURKISH.test(t)) turkishChrome.push(t.slice(0, 40))
    }
    for (const el of document.querySelectorAll('[aria-label]')) {
        if (el.closest('.task-card-open, .worklog-card-open')) continue
        if (el.classList.contains('task-card-open') || el.classList.contains('worklog-card-open')) continue
        const t = el.getAttribute('aria-label') || ''
        if (TURKISH.test(t)) turkishChrome.push('aria:' + t.slice(0, 40))
    }

    // §C sayfa gradyani semantic token uzerinden uygulanmis mi?
    const mc = document.querySelector('.main-content')
    const bg = mc ? getComputedStyle(mc).backgroundImage : ''

    return {
        bodyOverflow: document.documentElement.scrollWidth
            - document.documentElement.clientWidth,
        unnamedButtons: [...new Set(unnamed)],
        turkishChrome: [...new Set(turkishChrome)],
        pageGradient: bg.includes('radial-gradient'),
        brokenImages: [...document.querySelectorAll('img')]
            .filter((i) => i.complete && i.naturalWidth === 0).length,
    }
}

const browser = await chromium.launch()

// ============================ Matris turu ====================================
for (const vp of VIEWPORTS) {
    for (const theme of ['dark', 'light']) {
        const ctx = await browser.newContext({
            viewport: { width: vp.width, height: vp.height }, hasTouch: vp.mobile,
        })
        const page = await ctx.newPage()
        const consoleErrors = []
        const deprecations = []
        const rejections = []
        const unexpected = []
        page.on('console', (m) => {
            const t = m.text()
            if (/deprecated/i.test(t)) deprecations.push(t.slice(0, 130))
            else if (m.type() === 'error') consoleErrors.push(t.slice(0, 150))
        })
        page.on('pageerror', (e) => rejections.push(e.message.slice(0, 150)))
        await page.addInitScript(([t]) => {
            localStorage.setItem('hermes-theme', t)
            localStorage.setItem('hermes-sidebar-collapsed', '0')
        }, [theme])
        await installRoutes(page, unexpected)

        for (const s of SURFACES) {
            const tag = `${s.id} @ ${vp.name}/${theme}`
            const before = consoleErrors.length
            try {
                await page.goto(BASE + s.path, { waitUntil: 'domcontentloaded' })
                await page.waitForSelector(s.ready, { timeout: 20000 })
                await page.waitForTimeout(300)
            } catch (e) {
                results.push({ tag, status: 'LOAD_FAILED', detail: e.message.slice(0, 110) })
                continue
            }
            const metrics = await page.evaluate(METRICS)
            if (vp.name === '1440x900') {
                await page.screenshot({ path: `${SHOTS}${s.id}-${theme}.png` })
            }
            results.push({
                tag, status: 'OK', ...metrics,
                consoleErrors: consoleErrors.slice(before, before + 3),
                deprecations: [...new Set(deprecations)].slice(0, 3),
                rejections: rejections.slice(0, 2),
                unexpectedNetwork: [...new Set(unexpected)].slice(0, 3),
            })
        }
        await ctx.close()
    }
}

// ===================== Davranis senaryolari (1440x900) =======================
const scenario = (name, ok, detail = '') => scenarios.push({ name, ok, detail })

// --- §A: sidebar (admin) — expanded/collapsed ---
{
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    const errs = []
    const unexpected = []
    page.on('pageerror', (e) => errs.push(e.message.slice(0, 140)))
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)) })
    await page.addInitScript(() => {
        localStorage.setItem('hermes-theme', 'dark')
        localStorage.setItem('hermes-sidebar-collapsed', '0')
    })
    await installRoutes(page, unexpected)

    await page.goto(BASE + '/time-entry', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=Ilk kayit', { timeout: 20000 })

    const expanded = await page.evaluate(() => ({
        groupTitles: [...document.querySelectorAll('.main-sider .ant-menu-item-group-title')]
            .filter((el) => el.getBoundingClientRect().width > 0).length,
    }))
    scenario('§A expanded: yonetim grubu basliklari gorunur', expanded.groupTitles >= 2,
        `titles=${expanded.groupTitles}`)
    await page.screenshot({ path: `${SHOTS}sidebar-expanded-dark.png` })

    await page.click('button[aria-label="Toggle navigation"]')
    await page.waitForTimeout(450) // collapse animasyonu + logo crossfade

    const collapsed = await page.evaluate(() => {
        const sider = document.querySelector('.main-sider')
        const icon = document.querySelector('.sidebar-logo--icon')
        const full = document.querySelector('.sidebar-logo--full')
        const ir = icon.getBoundingClientRect()
        const sr = sider.getBoundingClientRect()
        return {
            siderW: sr.width,
            groupTitles: document.querySelectorAll('.main-sider .ant-menu-item-group-title').length,
            dividers: document.querySelectorAll('.main-sider .ant-menu-item-divider').length,
            iconW: ir.width,
            iconH: ir.height,
            iconOpacity: parseFloat(getComputedStyle(icon).opacity),
            fullOpacity: parseFloat(getComputedStyle(full).opacity),
            centerDelta: Math.abs((ir.left + ir.width / 2) - (sr.left + sr.width / 2)),
        }
    })
    scenario('§A collapsed: grup basligi DOM da yok (kirpilmis gri blok yok)',
        collapsed.groupTitles === 0, `titles=${collapsed.groupTitles}`)
    scenario('§A collapsed: ayirici (divider) hiyerarsi ipucu var',
        collapsed.dividers >= 2, `dividers=${collapsed.dividers}`)
    scenario('§A collapsed: logo ikonu BUYUK ve gorunur (36x36 kutu bug geri gelmedi)',
        collapsed.iconW >= 40 && collapsed.iconH >= 28 && collapsed.iconOpacity === 1,
        `icon=${Math.round(collapsed.iconW)}x${Math.round(collapsed.iconH)} op=${collapsed.iconOpacity}`)
    scenario('§A collapsed: tam logo gizli (crossfade tamam)', collapsed.fullOpacity === 0,
        `fullOp=${collapsed.fullOpacity}`)
    scenario('§A collapsed: ikon sider icinde ortalanmis', collapsed.centerDelta <= 6,
        `delta=${collapsed.centerDelta.toFixed(1)}px sider=${Math.round(collapsed.siderW)}px`)
    await page.screenshot({ path: `${SHOTS}sidebar-collapsed-dark.png` })

    // Geri ac: basliklar geri gelir (kalici DOM hasari yok).
    await page.click('button[aria-label="Toggle navigation"]')
    await page.waitForTimeout(450)
    const restored = await page.evaluate(() =>
        document.querySelectorAll('.main-sider .ant-menu-item-group-title').length)
    scenario('§A expand geri: basliklar geri geldi', restored >= 2, `titles=${restored}`)

    scenario('§A turunda console/pageerror yok', errs.length === 0, errs[0] || '')
    await ctx.close()
}

// --- §A: sidebar (NORMAL kullanici) — collapsed artiklari ---
{
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    const unexpected = []
    await page.addInitScript(() => {
        localStorage.setItem('hermes-theme', 'dark')
        localStorage.setItem('hermes-sidebar-collapsed', '1')
    })
    await installRoutes(page, unexpected, []) // izin YOK
    await page.goto(BASE + '/time-entry', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=Ilk kayit', { timeout: 20000 })
    const normal = await page.evaluate(() => ({
        groupTitles: document.querySelectorAll('.main-sider .ant-menu-item-group-title').length,
        dividers: document.querySelectorAll('.main-sider .ant-menu-item-divider').length,
    }))
    scenario('§A normal kullanici collapsed: grup/divider ARTIGI yok',
        normal.groupTitles === 0 && normal.dividers === 0,
        JSON.stringify(normal))
    await page.screenshot({ path: `${SHOTS}sidebar-collapsed-normal-dark.png` })
    await ctx.close()
}

// --- §B + §C + §D: Time Entry degistirici, hafta sonu, ozet, Ingilizce ---
{
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    const errs = []
    const unexpected = []
    page.on('pageerror', (e) => errs.push(e.message.slice(0, 140)))
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)) })
    await page.addInitScript(() => {
        localStorage.setItem('hermes-theme', 'dark')
        localStorage.setItem('hermes-sidebar-collapsed', '0')
    })
    await installRoutes(page, unexpected)
    await page.goto(BASE + '/time-entry', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=Ilk kayit', { timeout: 20000 })

    const sw = await page.evaluate(() => {
        const list = document.querySelector('[role="tablist"][aria-label="View"]')
        const tabs = [...(list?.querySelectorAll('[role="tab"]') || [])]
        const active = tabs.find((t) => t.getAttribute('aria-selected') === 'true')
        const cs = active ? getComputedStyle(active) : null
        const after = active ? getComputedStyle(active, '::after') : null
        return {
            tabs: tabs.map((t) => t.textContent),
            selected: tabs.map((t) => t.getAttribute('aria-selected')),
            bg: cs?.backgroundColor,
            borderW: cs?.borderTopWidth,
            antBtn: tabs.some((t) => t.className.includes('ant-btn')),
            underlineH: after?.height,
        }
    })
    scenario('§B tablist + iki tab (List/Timesheet)',
        JSON.stringify(sw.tabs) === '["List","Timesheet"]', JSON.stringify(sw.tabs))
    scenario('§B aria-selected yalniz aktifte', JSON.stringify(sw.selected) === '["true","false"]',
        JSON.stringify(sw.selected))
    scenario('§B krom SEFFAF (native buton gorunumu yok)',
        sw.bg === 'rgba(0, 0, 0, 0)' && sw.borderW === '0px' && !sw.antBtn,
        `bg=${sw.bg} border=${sw.borderW} antBtn=${sw.antBtn}`)
    scenario('§B aktif tabda accent alt cizgi', sw.underlineH === '2px', `h=${sw.underlineH}`)

    // §C: hafta sonu tonu ve mukerrer ozet.
    const c = await page.evaluate(() => {
        const wk = document.querySelector('.day-column-weekend')
        const nd = document.querySelector('.day-column:not(.day-column-weekend)')
        return {
            weekendBg: wk ? getComputedStyle(wk).backgroundColor : null,
            normalBg: nd ? getComputedStyle(nd).backgroundColor : null,
            dupSummary: document.querySelectorAll('.weekly-list-summary').length,
        }
    })
    scenario('§C hafta sonu tonu var ve hafta icinden farkli',
        !!c.weekendBg && c.weekendBg !== c.normalBg,
        `wk=${c.weekendBg} vs ${c.normalBg}`)
    scenario('§C mukerrer hafta ozeti bandi yok', c.dupSummary === 0, `n=${c.dupSummary}`)

    // §D: Ingilizce nokta kontrolleri.
    scenario('§D hafta gezinme Ingilizce (Previous/Next week)',
        (await page.locator('button[aria-label="Previous week"]').count()) > 0
        && (await page.locator('button[aria-label="Next week"]').count()) > 0)
    scenario('§D tema butonu Ingilizce (Switch to ...)',
        (await page.locator('button[aria-label*="Switch to"]').count()) > 0)

    // §B davranis: Timesheet'e gec, geri don — veri davranisi ayni.
    await page.click('[role="tab"]:has-text("Timesheet")')
    await page.waitForSelector('.timesheet-issue-cell, .ant-table', { timeout: 15000 })
    scenario('§B Timesheet gorunumu acildi', true)
    await page.screenshot({ path: `${SHOTS}time-entry-timesheet-dark.png` })
    await page.click('[role="tab"]:has-text("List")')
    await page.waitForSelector('text=Ilk kayit', { timeout: 15000 })
    scenario('§B List e geri donus — worklog verisi yerinde', true)

    scenario('§B/§C/§D turunda console/pageerror yok', errs.length === 0, errs[0] || '')
    scenario('§B/§C/§D turunda beklenmedik istek yok', unexpected.length === 0,
        unexpected[0] || '')
    await ctx.close()
}

// --- Tasks board + Users modal (modal+tablo yuzeyi) ---
{
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    const errs = []
    const unexpected = []
    page.on('pageerror', (e) => errs.push(e.message.slice(0, 140)))
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)) })
    await page.addInitScript(() => {
        localStorage.setItem('hermes-theme', 'dark')
        localStorage.setItem('hermes-sidebar-collapsed', '0')
    })
    await installRoutes(page, unexpected)

    // Tasks: STATUS_LABELS artik Ingilizce.
    await page.goto(BASE + '/project-management/tasks', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.task-card', { timeout: 20000 })
    scenario('§D task durum etiketi Ingilizce (In Progress)',
        (await page.locator('text=In Progress').count()) > 0)
    await page.screenshot({ path: `${SHOTS}tasks-dark.png` })

    // Users: tablo + modal.
    await page.goto(BASE + '/users', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=Bob Bit', { timeout: 20000 })
    await page.click('button:has-text("New User")')
    await page.waitForSelector('.ant-modal', { timeout: 10000 })
    const modal = await page.evaluate(() => {
        const m = document.querySelector('.ant-modal')
        return {
            visible: !!m,
            turkish: /[ğşıİöüçĞŞÖÜÇ]/.test(m?.textContent || ''),
        }
    })
    scenario('modal+tablo: New User modali acildi', modal.visible)
    scenario('§D modal metinleri Ingilizce', !modal.turkish)
    await page.screenshot({ path: `${SHOTS}users-modal-dark.png` })

    scenario('modal turunda console/pageerror yok', errs.length === 0, errs[0] || '')
    await ctx.close()
}

await browser.close()

// ============================== Rapor =======================================
const fail = []
for (const r of results) {
    if (r.status !== 'OK') { fail.push(`${r.tag}: ${r.status} — ${r.detail || ''}`); continue }
    if (r.bodyOverflow > 1) fail.push(`${r.tag}: govde yatay tasma ${r.bodyOverflow}px`)
    if (r.unnamedButtons.length) fail.push(`${r.tag}: adsiz buton ${JSON.stringify(r.unnamedButtons)}`)
    if (r.turkishChrome.length) fail.push(`${r.tag}: TURKCE krom ${JSON.stringify(r.turkishChrome)}`)
    if (!r.pageGradient) fail.push(`${r.tag}: sayfa gradyani YOK`)
    if (r.brokenImages) fail.push(`${r.tag}: bozuk gorsel ${r.brokenImages}`)
    if (r.consoleErrors.length) fail.push(`${r.tag}: konsol hatasi ${JSON.stringify(r.consoleErrors)}`)
    if (r.deprecations.length) fail.push(`${r.tag}: AntD deprecation ${JSON.stringify(r.deprecations)}`)
    if (r.rejections.length) fail.push(`${r.tag}: unhandled rejection ${JSON.stringify(r.rejections)}`)
    if (r.unexpectedNetwork.length) fail.push(`${r.tag}: mocklanmayan istek ${JSON.stringify(r.unexpectedNetwork)}`)
}
for (const s of scenarios) if (!s.ok) fail.push(`SENARYO — ${s.name} ${s.detail}`)

console.log('\n===== OZET =====')
console.log(`Matris: ${results.length} kombinasyon (4 viewport x 2 tema x ${SURFACES.length} yuzey)`)
console.log(`Senaryo: ${scenarios.length} (gecen: ${scenarios.filter((s) => s.ok).length})`)
for (const s of scenarios) console.log(`  ${s.ok ? 'PASS' : 'FAIL'} — ${s.name}${s.detail ? ` [${s.detail}]` : ''}`)
if (fail.length) {
    console.log(`\nSONUC: FAIL — ${fail.length} bulgu`)
    for (const f of fail.slice(0, 40)) console.log('  - ' + f)
    process.exit(1)
}
console.log('\nSONUC: PASS — tasma 0, adsiz buton 0, Turkce krom 0, gradyan her yuzeyde, '
    + 'konsol temiz, deprecation 0, beklenmedik istek 0, tum senaryolar gecti')
