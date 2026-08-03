/**
 * =============================================================================
 * HERMES QA — Sprint 7 toplu final matrisi (hardening dogrulamasi)
 * =============================================================================
 * MOCKED/LOCAL QA: API tamamen yakalanir, canli backend KULLANILMAZ.
 *
 * Kapsam: Sprint 7'nin dokundugu yuzeyler — shell, Dashboard (ay gezinme),
 * Time Entry (hafta gezinme + kopyala/yapistir), Tasks list/board
 * (TaskCard semantigi), Meetings (hafta gezinme), Billable Hours,
 * API Management. 4 viewport x 2 tema + davranis senaryolari.
 *
 * Kullanim:
 *   cd frontend && npx vite build && npx vite preview --port 4174 &
 *   cp scripts/qa/sprint7-final-qa.mjs /tmp/hermes-qa/ && cd /tmp/hermes-qa
 *   QA_BASE=http://localhost:4174 node sprint7-final-qa.mjs
 * =============================================================================
 */
import { chromium } from 'playwright'

const BASE = process.env.QA_BASE || 'http://localhost:4174'
const SCENARIOS_ONLY = process.env.QA_SCENARIOS_ONLY === '1'

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

/** Gecerli ISO haftasinin pazartesi gunu (Time Entry o haftayi gosterir). */
const monday = (() => {
    const d = new Date()
    const day = (d.getDay() + 6) % 7
    d.setDate(d.getDate() - day)
    return d.toISOString().slice(0, 10)
})()

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
        id: 't2', task_code: 'TASK-2', title: 'Cok uzun bir gorev basligi ile tasma testi yapiyoruz burada evet',
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
    { id: 'meetings', path: '/meetings', ready: 'button[aria-label="Previous week"]' },
    { id: 'billable-hours', path: '/management/billable-hours', ready: 'button[aria-label="Previous week"]' },
    { id: 'api-management', path: '/api-management', ready: '.tm-section-head' },
]

const results = []
const scenarios = []

function installRoutes(page, unexpected) {
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
        else if (has('/rbac/me')) body = { permissions: PERMISSIONS, roles: [] }
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
    const nested = []
    for (const b of document.querySelectorAll('button, [role="button"]')) {
        if (!isVisible(b)) continue
        if (!accName(b)) unnamed.push(b.className.toString().slice(0, 60))
        // IC ICE INTERAKTIF: bir butonun atasi da interaktif mi?
        // (dnd-kit sarmalayicisi haric — senaryo bolumundeki aciklamaya
        // bakiniz: klavye suruklemesinin erisilebilirlik modeli.)
        const parentInteractive = b.parentElement?.closest('button, [role="button"], a[href]')
        if (parentInteractive
            && parentInteractive.getAttribute('aria-roledescription') !== 'draggable') {
            nested.push(accName(b).slice(0, 40) || b.className.toString().slice(0, 40))
        }
    }
    return {
        bodyOverflow: document.documentElement.scrollWidth
            - document.documentElement.clientWidth,
        unnamedButtons: [...new Set(unnamed)],
        nestedInteractive: [...new Set(nested)],
        brokenImages: [...document.querySelectorAll('img')]
            .filter((i) => i.complete && i.naturalWidth === 0).length,
    }
}

const browser = await chromium.launch()

for (const vp of (SCENARIOS_ONLY ? [] : VIEWPORTS)) {
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
            let focus = { found: false }
            try {
                await page.keyboard.press('Tab')
                await page.keyboard.press('Tab')
                focus = await page.evaluate(() => {
                    const el = document.activeElement
                    if (!el || el === document.body) return { found: false }
                    return { found: true, visible: el.matches(':focus-visible') }
                })
            } catch { /* odaklanacak oge yok */ }
            results.push({
                tag, status: 'OK', ...metrics, focus,
                consoleErrors: consoleErrors.slice(before, before + 3),
                deprecations: [...new Set(deprecations)].slice(0, 3),
                rejections: rejections.slice(0, 2),
                unexpectedNetwork: [...new Set(unexpected)].slice(0, 3),
            })
        }
        await ctx.close()
    }
}

// ================= Davranis senaryolari (1440x900/dark) ======================
{
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    const errs = []
    const unexpected = []
    page.on('pageerror', (e) => errs.push(e.message.slice(0, 140)))
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)) })
    await page.addInitScript(() => localStorage.setItem('hermes-theme', 'dark'))
    await installRoutes(page, unexpected)
    const scenario = (name, ok, detail = '') => scenarios.push({ name, ok, detail })

    // --- TaskCard semantigi ---
    await page.goto(BASE + '/project-management/tasks', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.task-card', { timeout: 20000 })

    const rootRole = await page.evaluate(() => {
        const card = document.querySelector('.task-card')
        return { role: card.getAttribute('role'), tabindex: card.getAttribute('tabindex') }
    })
    scenario('TaskCard koku buton olarak ANONS EDILMIYOR',
        rootRole.role === null && rootRole.tabindex === null,
        JSON.stringify(rootRole))

    const nestedCount = await page.evaluate(() => {
        let n = 0
        for (const b of document.querySelectorAll('.task-card button, .task-card input')) {
            const anc = b.parentElement?.closest('button, [role="button"], a[href]')
            if (!anc) continue
            /*
             * BILINEN ISTISNA (rapor edilen borc): board'da dnd-kit
             * sarmalayicisi klavye suruklemesi icin role="button" tasir
             * (KeyboardSensor aktif — kaldirmak klavye suruklemeyi
             * bozar). Sprint 7 kartin KENDI kokundeki role="button"u
             * kaldirdi; sarmalayici dnd-kit'in erisilebilirlik modeli.
             * Kalici cozum (drag handle) ayri bir UX karari.
             */
            if (anc.getAttribute('aria-roledescription') === 'draggable') continue
            n += 1
        }
        return n
    })
    scenario('TaskCard icinde IC ICE interaktif kontrol yok (dnd sarmalayicisi haric)',
        nestedCount === 0, `nested=${nestedCount}`)

    // Enter TEK KEZ acar (panel acilisini sayarak).
    const opener = page.locator('.task-card-open').first()
    await opener.focus()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    // Acilan sey TaskDetailPanel'dir (yan panel), modal degil.
    const panelsAfterEnter = await page.locator('.task-detail-panel').count()
    scenario('TaskCard Enter ile acilir (dnd sensoru yutmaz)',
        panelsAfterEnter > 0, `panel=${panelsAfterEnter}`)
    const dragStarted = await page.locator('.tasks-board-drag-overlay').count()
    scenario('Enter surukleme BASLATMAZ', dragStarted === 0, `overlay=${dragStarted}`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)

    // Kartin bos alanina fare tiklamasi da acar (alisilmis davranis).
    await page.locator('.task-card-meta').first().click()
    await page.waitForTimeout(500)
    scenario('TaskCard bos alan tiklamasi da acar (fare alisikligi korundu)',
        (await page.locator('.task-detail-panel').count()) > 0)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)

    // --- Time Entry: kopyala/yapistir kisayollari ---
    await page.goto(BASE + '/time-entry', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=Ilk kayit', { timeout: 20000 })
    await page.locator('text=Ilk kayit').first().click()
    await page.keyboard.press('Control+c')
    await page.waitForTimeout(300)
    // Pano gostergesi ya da secim vurgusu — kesin kanit: hata olmamasi
    // ve sonrasinda Ctrl+V akisinin mutation uretmesi ayri testte kilitli.
    scenario('Time Entry Ctrl+C hata uretmiyor', errs.length === 0, errs[0] || '')

    // Hafta gezinme butonlari adlandirilmis (WeekNavigator TURKCE
    // adlandirir — mevcut ve dogru davranis).
    const tePrev = await page.locator('button[aria-label="Önceki hafta"]').count()
    scenario('Time Entry hafta gezinme butonlari adlandirilmis', tePrev > 0)

    // --- Dashboard ay gezinme ---
    await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('button[aria-label="Previous month"]', { timeout: 20000 })
    scenario('Dashboard ay gezinme butonlari adlandirilmis', true)

    scenario('Senaryo turunda beklenmedik network istegi yok',
        unexpected.length === 0, unexpected.slice(0, 2).join(' '))
    scenario('Senaryo turunda console/pageerror yok', errs.length === 0,
        errs.slice(0, 2).join(' | '))
    await ctx.close()
}

await browser.close()

// ============================== Rapor =======================================
const fail = []
for (const r of results) {
    if (r.status !== 'OK') { fail.push(`${r.tag}: ${r.status} — ${r.detail || ''}`); continue }
    if (r.bodyOverflow > 1) fail.push(`${r.tag}: govde yatay tasma ${r.bodyOverflow}px`)
    if (r.unnamedButtons.length) fail.push(`${r.tag}: adsiz buton ${JSON.stringify(r.unnamedButtons)}`)
    if (r.nestedInteractive.length) fail.push(`${r.tag}: IC ICE interaktif ${JSON.stringify(r.nestedInteractive)}`)
    if (r.brokenImages) fail.push(`${r.tag}: bozuk gorsel ${r.brokenImages}`)
    if (r.focus.found && !r.focus.visible) fail.push(`${r.tag}: odak halkasi gorunmuyor`)
    if (r.consoleErrors.length) fail.push(`${r.tag}: konsol hatasi ${JSON.stringify(r.consoleErrors)}`)
    if (r.deprecations.length) fail.push(`${r.tag}: AntD deprecation ${JSON.stringify(r.deprecations)}`)
    if (r.rejections.length) fail.push(`${r.tag}: unhandled rejection ${JSON.stringify(r.rejections)}`)
    if (r.unexpectedNetwork.length) fail.push(`${r.tag}: mocklanmayan istek ${JSON.stringify(r.unexpectedNetwork)}`)
}
for (const s of scenarios) if (!s.ok) fail.push(`SENARYO — ${s.name} ${s.detail}`)

console.log(JSON.stringify({ matrix: results.length, scenarios }, null, 2))
console.log('\n===== OZET =====')
console.log(`Matris: ${results.length} kombinasyon (${VIEWPORTS.length} viewport x 2 tema x ${SURFACES.length} yuzey)`)
console.log(`Senaryo: ${scenarios.length} (gecen: ${scenarios.filter((s) => s.ok).length})`)
for (const s of scenarios) console.log(`  ${s.ok ? 'PASS' : 'FAIL'} — ${s.name}${s.detail ? ` [${s.detail}]` : ''}`)
if (fail.length) {
    console.log(`\nSONUC: FAIL — ${fail.length} bulgu`)
    for (const f of fail.slice(0, 40)) console.log('  - ' + f)
    process.exit(1)
}
console.log('\nSONUC: PASS — tasma 0, adsiz buton 0, ic ice interaktif 0, odak gorunur, '
    + 'konsol temiz, deprecation 0, beklenmedik istek 0, tum senaryolar gecti')
