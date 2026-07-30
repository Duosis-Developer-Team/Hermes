/**
 * =============================================================================
 * HERMES QA — Sprint 6 toplu final matrisi (6A/6C yuzeyleri)
 * =============================================================================
 * TEK CALISTIRMA: Reports, Billable Hours, Customers (sozlesme alanlari),
 * Projects (sozlesme alanlari), API Management ve Developer Portal.
 * 4 viewport x 2 tema x 6 yuzey + davranis senaryolari.
 *
 * MOCKED/LOCAL QA: API tamamen yakalanir, canli backend KULLANILMAZ.
 * Gercek kimlik bilgisi gerekmez, hicbir gercek veriye dokunulmaz.
 *
 * Rotalar router kaynagindan cozuldu (tahmin edilmedi):
 *   /management/reports, /management/billable-hours, /customers,
 *   /projects, /api-management, /developer
 *
 * Kullanim:
 *   cd frontend && npx vite build && npx vite preview --port 4174 &
 *   cp scripts/qa/sprint6-final-qa.mjs /tmp/hermes-qa/ && cd /tmp/hermes-qa
 *   QA_BASE=http://localhost:4174 node sprint6-final-qa.mjs
 * =============================================================================
 */
import { chromium } from 'playwright'

const BASE = process.env.QA_BASE || 'http://localhost:4174'

const VIEWPORTS = [
    { name: '1440x900', width: 1440, height: 900, mobile: false },
    { name: '1280x720', width: 1280, height: 720, mobile: false },
    { name: '768x1024', width: 768, height: 1024, mobile: true },
    { name: '390x844', width: 390, height: 844, mobile: true },
]

const PERMISSIONS = [
    'reports.view', 'customers.manage', 'projects.manage', 'api.manage',
    'users.manage', 'reference.manage', 'tasks.permissions.manage',
]

const USERS = [
    { id: 'u1', full_name: 'Ada Lovelace', email: 'ada@duosis.com', is_admin: true, is_active: true },
    {
        id: 'u2',
        full_name: 'Wolfeschlegelsteinhausenbergerdorff Uzunca Kullanici Adi',
        email: 'cok.uzun.eposta.adresi.testi@subdomain.duosis.com.tr',
        is_admin: false, is_active: true,
    },
]
const CUSTOMERS = [{
    id: 'c1', name: 'Vakko', code: 'VKK', contact_person: 'Ada',
    email: 'ada@vakko.com', is_active: true,
    contract_start_date: '2026-01-01T00:00:00', contract_duration_days: 100,
}]
const PROJECTS = [{
    id: 'p1', name: 'ATM Yenileme', code: 'ATM', customer_id: 'c1',
    customer_name: 'Vakko', is_active: true,
    contract_start_date: '2026-01-01T00:00:00', contract_duration_days: 100,
}]
const LOGS = [
    {
        date: '2026-07-01', user_name: 'Ada Lovelace', customer_name: 'Vakko',
        project_name: 'ATM Yenileme', work_type: 'Development',
        activity_type: 'Coding', platform_name: 'Backend',
        duration: 4, description: 'Çok uzun bir açıklama — Türkçe karakterler: ğüşiöç',
    },
]
const CLIENTS = [{
    id: 'cl1', name: 'Reporting Bot', client_type: 'service', environment: 'dev',
    is_active: true, scopes: ['tasks:read'], created_at: '2026-06-01T00:00:00',
    tokens: [{ id: 't1', prefix: 'hms_dev_abc', is_active: true, created_at: '2026-06-01T00:00:00' }],
}]

const SURFACES = [
    // Hazir-olma isareti viewport'tan BAGIMSIZ: genis tablodaki bir
    // hucre dar ekranlarda yatay kaydirmanin disinda kalir.
    { id: 'reports', path: '/management/reports', ready: '.ant-table-row' },
    { id: 'billable-hours', path: '/management/billable-hours', ready: '.ant-table' },
    { id: 'customers', path: '/customers', ready: 'text=Vakko' },
    { id: 'projects', path: '/projects', ready: 'text=ATM Yenileme' },
    { id: 'api-management', path: '/api-management', ready: '.tm-section-head' },
    { id: 'developer-portal', path: '/developer', ready: '.dp-code, h1' },
]

const results = []
const scenarios = []
const record = (r) => results.push(r)

/** Ortak API yakalama — TUM istekler karsilanir; kacak istek raporlanir. */
function installRoutes(page, unexpected) {
    return page.route('**/*', async (route) => {
        const url = route.request().url()
        /*
         * SIRA ONEMLI: uygulama API'yi AYNI ORIGIN uzerinden (`/api/...`)
         * cagirir. Origin kontrolu once yapilirsa bu istekler gercek aga
         * gider ve 404 doner. Once API yakalanir, sonra uygulama
         * varliklari gecirilir.
         */
        if (!url.includes('/api/')) {
            if (url.startsWith(BASE)) return route.continue()
            unexpected.push(url.slice(0, 120))
            return route.abort()
        }
        const has = (s) => url.includes(s)
        let body = []
        if (has('/auth/users/me')) body = USERS[0]
        else if (has('/rbac/me')) body = { permissions: PERMISSIONS, roles: [] }
        else if (has('/rbac/permissions/catalog') || has('/catalog')) {
            body = { permissions: PERMISSIONS.map((code) => ({ code })) }
        } else if (has('/rbac/roles')) body = { roles: [] }
        else if (has('permissions/me')) {
            body = {
                is_admin: true,
                task: { can_access: true, can_assign: true },
                issue: { can_access: true, can_assign: true },
            }
        } else if (has('/users/lookup')) body = USERS
        else if (has('/task-permissions')) body = []
        else if (has('/api/v1/auth/users')) body = { data: USERS }
        else if (has('/reports/export')) {
            // CSV indirme akisi.
            return route.fulfill({
                status: 200,
                headers: {
                    'content-type': 'text/csv; charset=utf-8',
                    'content-disposition': "attachment; filename*=UTF-8''temmuz-raporu.csv",
                },
                body: 'tarih,kullanıcı,süre\n2026-07-01,Ada,4\n',
            })
        } else if (has('/reports/json') || has('/reports/user-logs') || has('reports')) {
            body = { data: LOGS }
        } else if (has('/work-logs') || has('worklogs')) body = { data: [] }
        else if (has('/customers')) body = CUSTOMERS
        else if (has('/projects')) body = PROJECTS
        else if (has('/work-types') || has('/activity-types') || has('/platforms') || has('/work-lines')) {
            body = [{ id: 'w1', name: 'Development', code: 'DEV', is_active: true }]
        } else if (has('/user-groups') || has('/groups')) body = []
        else if (has('/api-clients') || has('/clients')) body = CLIENTS
        else if (has('capabilities')) {
            body = {
                api_version: 'v1',
                scopes: { 'tasks:read': 'Read tasks', 'users:read': 'Resolve user ids' },
                error_codes: { resource_not_found: 'Not found' },
                idempotency: { in_progress_error_code: 'idempotency_request_in_progress' },
            }
        } else if (has('request-logs')) body = []
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
    const hits = (el, dx, dy) => {
        const r = el.getBoundingClientRect()
        const x = r.left + r.width / 2 + dx
        const y = r.top + r.height / 2 + dy
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return true
        const h = document.elementFromPoint(x, y)
        return !!h && (h === el || el.contains(h) || h.contains(el))
    }
    const targetOk = (el) => {
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') return null
        const r = el.getBoundingClientRect()
        if (r.width >= 24 && r.height >= 24) return true
        if (!hits(el, 0, 0)) return null
        return hits(el, -11, 0) && hits(el, 11, 0) && hits(el, 0, -11) && hits(el, 0, 11)
    }
    const small = []
    const unnamed = []
    const clipped = []
    for (const b of document.querySelectorAll('button, [role="button"]')) {
        if (!isVisible(b)) continue
        const name = accName(b)
        if (targetOk(b) === false) small.push(name || '?')
        if (!name) unnamed.push(b.className.toString().slice(0, 60))
        /*
         * KIRPILMA yalnizca ULASILAMAYAN aksiyon icin bulgudur. Tablo
         * aksiyon kolonu ve portal gezinme seridi BILEREK yatay
         * kaydirilabilir kapsayicilarin icinde; orada viewport disina
         * tasmak beklenen davranistir, kullanici kaydirarak ulasir.
         * Yalnizca kaydirilamayan bir baglamda tasan aksiyon sayilir.
         */
        const inScroller = (() => {
            let el = b.parentElement
            while (el && el !== document.body) {
                const cs = getComputedStyle(el)
                if (/(auto|scroll)/.test(cs.overflowX)
                    && el.scrollWidth > el.clientWidth + 1) return true
                el = el.parentElement
            }
            return false
        })()
        const r = b.getBoundingClientRect()
        if (!inScroller && (r.right > innerWidth + 1 || r.left < -1)) {
            clipped.push(name.slice(0, 40) || '?')
        }
    }
    const dialog = document.querySelector('[role="dialog"]')
    const dr = dialog?.getBoundingClientRect()
    return {
        bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        smallTargets: [...new Set(small)],
        unnamedButtons: [...new Set(unnamed)],
        clippedActions: [...new Set(clipped)],
        modalOverflows: dr ? dr.width > innerWidth + 1 : false,
        brokenImages: [...document.querySelectorAll('img')]
            .filter((i) => i.complete && i.naturalWidth === 0).length,
    }
}

const SCENARIOS_ONLY = process.env.QA_SCENARIOS_ONLY === '1'

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
                record({ tag, status: 'LOAD_FAILED', detail: e.message.slice(0, 120) })
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
            record({
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

// ===================== Davranis senaryolari (1440x900/dark) ==================
{
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    const errs = []
    const unexpected = []
    page.on('pageerror', (e) => errs.push(e.message.slice(0, 140)))
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)) })
    await page.addInitScript(() => localStorage.setItem('hermes-theme', 'dark'))

    let exportCalls = 0
    let jsonErrorMode = false
    let customerPayload = null
    let projectPayload = null
    await page.route('**/*', async (route) => {
        const url = route.request().url()
        const req = route.request()
        // Ayni sira kurali (yukaridaki aciklamaya bakiniz).
        if (!url.includes('/api/')) {
            if (url.startsWith(BASE)) return route.continue()
            unexpected.push(url.slice(0, 100))
            return route.abort()
        }
        if (url.includes('/reports/export')) {
            exportCalls += 1
            if (jsonErrorMode) {
                return route.fulfill({
                    status: 200,
                    headers: { 'content-type': 'application/json; charset=utf-8' },
                    body: JSON.stringify({ detail: 'Report window too large.' }),
                })
            }
            await new Promise((r) => setTimeout(r, 400))
            return route.fulfill({
                status: 200,
                headers: {
                    'content-type': 'text/csv; charset=utf-8',
                    'content-disposition': "attachment; filename*=UTF-8''temmuz-raporu.csv",
                },
                body: 'tarih,süre\n2026-07-01,4\n',
            })
        }
        if (['POST', 'PUT', 'PATCH'].includes(req.method()) && url.includes('/customers')) {
            customerPayload = req.postDataJSON()
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
        }
        if (['POST', 'PUT', 'PATCH'].includes(req.method()) && url.includes('/projects')) {
            projectPayload = req.postDataJSON()
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
        }
        const has = (s) => url.includes(s)
        let body = []
        if (has('/auth/users/me')) body = USERS[0]
        else if (has('/rbac/me')) body = { permissions: PERMISSIONS, roles: [] }
        else if (has('permissions/me')) body = { is_admin: true, task: { can_access: true, can_assign: true }, issue: { can_access: true, can_assign: true } }
        else if (has('/users/lookup')) body = USERS
        else if (has('/api/v1/auth/users')) body = { data: USERS }
        else if (has('reports')) body = { data: LOGS }
        else if (has('/customers')) body = CUSTOMERS
        else if (has('/projects')) body = PROJECTS
        else if (has('/work-types') || has('/activity-types') || has('/platforms')) body = [{ id: 'w1', name: 'Dev', code: 'DEV', is_active: true }]
        else if (has('capabilities')) body = { api_version: 'v1', scopes: {}, error_codes: {}, idempotency: {} }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })

    const scenario = (name, ok, detail = '') => scenarios.push({ name, ok, detail })

    // --- Reports: export basari + HIZLI CIFT TIKLAMA ---
    await page.goto(BASE + '/management/reports', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=Ada Lovelace', { timeout: 20000 })
    const dlBtn = page.locator('button[aria-label^="Download CSV"]')
    await dlBtn.click()
    await dlBtn.click({ force: true }).catch(() => {})
    await dlBtn.click({ force: true }).catch(() => {})
    await page.waitForTimeout(900)
    scenario('Reports: hizli cift tiklama TEK export acar', exportCalls === 1, `cagri=${exportCalls}`)
    scenario('Reports: basari mesaji GERCEK dosya adini soyler',
        await page.locator('text=/Downloaded temmuz-raporu\\.csv/').count() > 0)

    // --- Reports: JSON hata blobu dosya gibi INMEZ ---
    jsonErrorMode = true
    exportCalls = 0
    /*
     * Onceki BASARI toast'i ("Downloaded …") ~3 sn ekranda kalir; hata
     * olcumu onu gorup yanilir. Toast'larin kaybolmasi BEKLENIR —
     * bu bir olcum kosulu, urun davranisi degil.
     */
    await page.waitForFunction(
        () => document.querySelectorAll('.ant-message-notice').length === 0,
        null, { timeout: 10000 }
    ).catch(() => {})
    await dlBtn.click()
    await page.waitForTimeout(800)
    scenario('Reports: JSON hata blobu BASARI gibi gosterilmez',
        await page.locator('text=/Report window too large/').count() > 0
        && await page.locator('text=/Downloaded/').count() === 0)
    jsonErrorMode = false

    // --- Reports: filtre apply/reset ---
    const beforeReset = await page.locator('.ant-table-row').count()
    const clearBtn = page.locator('button:has-text("Clear")').first()
    if (await clearBtn.count()) await clearBtn.click().catch(() => {})
    await page.waitForTimeout(400)
    scenario('Reports: filtre reset sonrasi tablo KORUNUR',
        (await page.locator('.ant-table-row').count()) >= Math.min(1, beforeReset))

    // --- Customers: sozlesme alanlari + 1 Ocak gun kaymasi ---
    /*
     * TIMEZONE RISKI tam olarak GIDIS-DONUSTE: backend'den gelen
     * `2026-01-01T00:00:00` forma dayjs olarak girer, geri gonderilirken
     * `toISOString()` kullanilsaydi UTC+3'te 2025-12-31'e duserdi.
     * Bu yuzden takvim UI'sini surmeye gerek yok — mevcut kaydi ACIP
     * KAYDETMEK riski birebir kapsar ve AntD picker overlay'ine
     * takilmaz. (Ayni kural birim testlerinde de kilitli.)
     */
    await page.goto(BASE + '/customers', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=Vakko', { timeout: 20000 })
    await page.getByRole('button', { name: 'Edit Vakko' }).click()
    const custDialog = page.getByRole('dialog')
    await custDialog.waitFor({ state: 'visible' })
    const shownDate = await custDialog.locator('.ant-picker input').first().inputValue()
    scenario('Customers: sozlesme tarihi forma AYNI GUN yuklenir',
        shownDate === '2026-01-01', `gosterilen=${shownDate}`)
    await custDialog.getByRole('button', { name: /^Update$/ }).click()
    await page.waitForTimeout(900)
    scenario('Customers: kaydetmede tarih AYNI GUN gonderilir (UTC kaymasi yok)',
        customerPayload?.contract_start_date === '2026-01-01',
        `gonderilen=${customerPayload?.contract_start_date}`)
    scenario('Customers: sozlesme suresi korunur',
        customerPayload?.contract_duration_days === 100,
        `gonderilen=${customerPayload?.contract_duration_days}`)

    // --- Projects: baslangic tarihi alani gercekten yonetilebilir ---
    await page.goto(BASE + '/projects', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=ATM Yenileme', { timeout: 20000 })
    await page.getByRole('button', { name: 'Edit ATM Yenileme' }).click()
    const projDialog = page.getByRole('dialog')
    await projDialog.waitFor({ state: 'visible' })
    const projDate = await projDialog.locator('.ant-picker input').first().inputValue()
    scenario('Projects: baslangic tarihi alani VAR ve dolu gelir',
        projDate === '2026-01-01', `gosterilen=${projDate}`)

    // --- Developer Portal: kopyalama erisilebilir adlari ---
    await page.goto(BASE + '/developer', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.dp-nav', { timeout: 20000 })
    /*
     * Portal tek sayfada TEK bolum cizer; varsayilan Overview'da kod
     * blogu yoktur. Kopyalama butonlarini gormek icin kod iceren bir
     * bolume gecilir.
     */
    await page.locator('.dp-nav-item', { hasText: 'Getting Started' }).first().click()
    await page.waitForSelector('.dp-code', { timeout: 10000 })
    const copyNames = await page.evaluate(() =>
        [...document.querySelectorAll('button[aria-label^="Copy "]')]
            .map((b) => b.getAttribute('aria-label'))
    )
    scenario('Portal: kopyalama butonlari NEYI kopyaladigini soyler',
        copyNames.length > 0 && new Set(copyNames).size > 1,
        `${copyNames.length} buton / ${new Set(copyNames).size} farkli ad`)

    scenario('Davranis turunda beklenmedik network istegi yok', unexpected.length === 0,
        unexpected.slice(0, 2).join(' '))
    scenario('Davranis turunda console/pageerror yok', errs.length === 0, errs.slice(0, 2).join(' | '))
    await ctx.close()
}

await browser.close()

// ============================== Rapor =======================================
const fail = []
for (const r of results) {
    if (r.status !== 'OK') { fail.push(`${r.tag}: ${r.status} — ${r.detail || ''}`); continue }
    if (r.bodyOverflow > 1) fail.push(`${r.tag}: govde yatay tasma ${r.bodyOverflow}px`)
    if (r.smallTargets.length) fail.push(`${r.tag}: kucuk hedef ${JSON.stringify(r.smallTargets)}`)
    if (r.unnamedButtons.length) fail.push(`${r.tag}: adsiz buton ${JSON.stringify(r.unnamedButtons)}`)
    if (r.clippedActions.length) fail.push(`${r.tag}: kirpilan aksiyon ${JSON.stringify(r.clippedActions)}`)
    if (r.modalOverflows) fail.push(`${r.tag}: modal viewport'u asiyor`)
    if (r.brokenImages) fail.push(`${r.tag}: bozuk gorsel ${r.brokenImages}`)
    if (r.focus.found && !r.focus.visible) fail.push(`${r.tag}: odak halkasi gorunmuyor`)
    if (r.consoleErrors.length) fail.push(`${r.tag}: konsol hatasi ${JSON.stringify(r.consoleErrors)}`)
    if (r.deprecations.length) fail.push(`${r.tag}: AntD deprecation ${JSON.stringify(r.deprecations)}`)
    if (r.rejections.length) fail.push(`${r.tag}: unhandled rejection ${JSON.stringify(r.rejections)}`)
    if (r.unexpectedNetwork.length) fail.push(`${r.tag}: mocklanmayan istek ${JSON.stringify(r.unexpectedNetwork)}`)
}
for (const s of scenarios) if (!s.ok) fail.push(`SENARYO — ${s.name} ${s.detail}`)

console.log(JSON.stringify({ matrix: results.length, results, scenarios }, null, 2))
console.log('\n===== OZET =====')
console.log(`Matris: ${results.length} kombinasyon (${VIEWPORTS.length} viewport x 2 tema x ${SURFACES.length} yuzey)`)
console.log(`Davranis senaryosu: ${scenarios.length} (gecen: ${scenarios.filter((s) => s.ok).length})`)
for (const s of scenarios) console.log(`  ${s.ok ? 'PASS' : 'FAIL'} — ${s.name}${s.detail ? ` [${s.detail}]` : ''}`)
if (fail.length) {
    console.log(`\nSONUC: FAIL — ${fail.length} bulgu`)
    for (const f of fail.slice(0, 40)) console.log('  - ' + f)
    process.exit(1)
}
console.log('\nSONUC: PASS — tasma 0, kirpilan aksiyon 0, adsiz buton 0, odak gorunur, '
    + 'konsol temiz, deprecation 0, beklenmedik istek 0, tum senaryolar gecti')
