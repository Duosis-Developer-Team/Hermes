/**
 * =============================================================================
 * HERMES QA — TUM ana Admin yuzeyleri (Sprint 6B.2 completion)
 * =============================================================================
 * GERCEK Chromium ile 4 viewport x 2 tema x 10 yuzey. jsdom'un
 * ANLATAMADIGI seyleri olcer: govde yatay tasmasi, dokunma hedefi boyutu,
 * gercek odak halkasi, modalin viewport'a sigmasi, konsol temizligi ve
 * AntD deprecation uyarilari.
 *
 * URUN BAGIMLILIGI DEGILDIR: Playwright ayri bir dizinde kurulur, API
 * tamamen yakalanir. Gercek kimlik bilgisi ya da canli ortam GEREKMEZ ve
 * hicbir gercek veriye dokunulmaz — bu yuzden sonuc "local/mocked browser
 * QA" olarak adlandirilir, canli authenticated QA DEGIL.
 *
 * Kullanim:
 *   cd frontend && npx vite build && npx vite preview --port 4174 &
 *   mkdir -p /tmp/hermes-qa && cd /tmp/hermes-qa && npm i -D playwright
 *   cp scripts/qa/admin-surfaces-qa.mjs /tmp/hermes-qa/ && \
 *     QA_BASE=http://localhost:4174 node admin-surfaces-qa.mjs
 * =============================================================================
 */
import { chromium } from 'playwright'

const BASE = process.env.QA_BASE || 'http://localhost:4174'

const VIEWPORTS = [
    { name: '390x844', width: 390, height: 844, mobile: true },
    { name: '768x1024', width: 768, height: 1024, mobile: true },
    { name: '1280x800', width: 1280, height: 800, mobile: false },
    { name: '1920x1080', width: 1920, height: 1080, mobile: false },
]

const USERS = [
    { id: 'u1', full_name: 'Ada Lovelace', email: 'ada@duosis.com', is_admin: true, is_active: true, role: 'ADMIN' },
    { id: 'u2', full_name: 'Bob Bit', email: 'bob@duosis.com', is_admin: false, is_active: true, role: 'USER' },
    // Uzun icerik: layout bozulmasini yakalamak icin.
    {
        id: 'u3',
        full_name: 'Wolfeschlegelsteinhausenbergerdorff Uzunca Kullanici Adi Ornegi',
        email: 'cok.uzun.eposta.adresi.ornegi.testi@subdomain.duosis.com.tr',
        is_admin: false, is_active: false, role: 'USER',
    },
]
const GROUPS = [
    { id: 'g1', name: 'Technical Team', description: 'Builds things', is_active: true, member_count: 2 },
    { id: 'g2', name: 'Cok Uzun Bir Grup Adi Ile Tasma Testi Yapiyoruz Burada', description: null, is_active: true, member_count: 0 },
]
const DICT = [
    { id: 'd1', name: 'Coding', code: 'COD', description: 'Writing code', is_active: true },
    { id: 'd2', name: 'Legacy Task', code: 'LEG', description: 'Old', is_active: false },
]
const CUSTOMERS = [
    { id: 'c1', name: 'Vakko', code: 'VKK', contact_person: 'Ada', email: 'ada@vakko.com', is_active: true },
]
const PROJECTS = [
    {
        id: 'p1', name: 'ATM Yenileme', code: 'ATM', customer_id: 'c1',
        customer_name: 'Vakko', is_active: true, contract_duration_days: 100,
        contract_start_date: '2026-01-01',
    },
]
const ROLES = [
    { id: 'r1', code: 'system-admin', name: 'System Admin', description: 'Full', permissions: ['users.manage'], is_active: true, is_system: true, member_count: 1 },
    { id: 'r2', code: 'report-viewer', name: 'Report Viewer', description: 'Reads', permissions: [], is_active: true, is_system: false, member_count: 3 },
]
const PERMISSIONS = [
    'users.manage', 'roles.manage', 'groups.manage', 'reference.manage',
    'customers.manage', 'projects.manage', 'tasks.permissions.manage',
    'reports.view', 'api.manage',
]

/**
 * Yuzeyler. `open` alani, o yuzeyde bir modal/panel acmak icin
 * kullanilacak buton desenidir (varsa).
 */
const SURFACES = [
    { id: 'users', path: '/users', ready: 'text=ada@duosis.com', open: 'button:has-text("New User")' },
    { id: 'user-groups', path: '/users', ready: 'text=ada@duosis.com', tab: 'Groups', open: 'button:has-text("Create Group")' },
    { id: 'roles', path: '/users', ready: 'text=ada@duosis.com', tab: 'Roles', open: 'button:has-text("New Role")' },
    { id: 'customers', path: '/customers', ready: 'text=Vakko', open: 'button:has-text("New Customer")' },
    { id: 'projects', path: '/projects', ready: 'text=ATM Yenileme', open: 'button:has-text("New Project")' },
    { id: 'work-types', path: '/work-types', ready: 'text=Coding', open: 'button:has-text("New Work Type")' },
    { id: 'contract-status', path: '/management/contracts', ready: 'text=Track project contract durations', open: null },
    { id: 'pm-config-task-access', path: '/pm-configurations', ready: '.tm-section-head', section: 'Task Access', open: null },
    { id: 'pm-config-hierarchy', path: '/pm-configurations', ready: '.tm-section-head', section: 'Task Hierarchy', open: 'button[aria-label="Add assignment rule"]' },
    { id: 'pm-config-sub-projects', path: '/pm-configurations', ready: '.tm-section-head', section: 'Sub Projects', open: 'button:has-text("Create Sub Project")' },
]

const results = []
const browser = await chromium.launch()

for (const vp of VIEWPORTS) {
    for (const theme of ['dark', 'light']) {
        const ctx = await browser.newContext({
            viewport: { width: vp.width, height: vp.height },
            hasTouch: vp.mobile,
        })
        const page = await ctx.newPage()
        const consoleErrors = []
        const deprecations = []
        page.on('console', (m) => {
            const t = m.text()
            if (/deprecated/i.test(t)) deprecations.push(t.slice(0, 140))
            else if (m.type() === 'error') consoleErrors.push(t.slice(0, 160))
        })
        page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message.slice(0, 160)))

        await page.addInitScript(([t]) => {
            localStorage.setItem('hermes-theme', t)
            localStorage.setItem('hermes-sidebar-collapsed', '0')
            // Oturum BILEREK localStorage'a yazilmaz: authStore token'i
            // kasitli olarak persist ETMEZ (XSS karari). Oturum yakalanan
            // /auth/users/me yanitindan hidratlanir.
        }, [theme])

        await page.route('**/api/**', async (route) => {
            const url = route.request().url()
            let body = []
            const has = (s) => url.includes(s)
            if (has('/auth/users/me')) {
                body = USERS[0]
            } else if (has('/rbac/me')) {
                body = { permissions: PERMISSIONS, roles: [{ code: 'system-admin' }] }
            } else if (has('/rbac/permissions/catalog') || has('/catalog')) {
                body = { permissions: PERMISSIONS.map((code) => ({ code })) }
            } else if (has('/rbac/roles')) {
                body = { roles: ROLES }
            } else if (has('permissions/me')) {
                body = {
                    is_admin: true,
                    task: { can_access: true, can_assign: true },
                    issue: { can_access: true, can_assign: true },
                }
            } else if (has('/users/lookup')) {
                body = USERS
            } else if (has('/task-permissions/effective')) {
                // DIZI dondurur.
                body = []
            } else if (has('/task-permissions/users')) {
                // DIZI dondurur — `/users` ile bittigi icin asagidaki
                // genel kullanici dalindan ONCE ele alinmali.
                body = []
            } else if (has('/task-permissions')) {
                body = []
            } else if (has('/api/v1/auth/users')) {
                // auth-service kullanici listesi: govde `{ data: [...] }`.
                body = { data: USERS }
            } else if (has('/user-groups') && has('/members')) {
                body = [{ id: 'm1', user_id: 'u2', title: 'Senior Developer' }]
            } else if (has('/user-groups') || has('/groups')) {
                body = GROUPS
            } else if (has('/customers')) {
                body = CUSTOMERS
            } else if (has('/projects')) {
                body = PROJECTS
            } else if (has('/work-types')) {
                body = DICT
            } else if (has('/activity-types') || has('/platforms') || has('/work-lines')) {
                body = DICT
            } else if (has('/billable') || has('summary')) {
                body = { p1: 640 }
            } else if (has('/sub-projects')) {
                body = [{
                    id: 's1', name: 'Faz 1', description: 'Ilk faz',
                    customer_id: 'c1', project_id: 'p1',
                    customer_name: 'Vakko', project_name: 'ATM Yenileme',
                }]
            } else if (has('assignment')) {
                body = []
            } else if (has('notification-settings')) {
                body = []
            }
            await route.fulfill({
                status: 200, contentType: 'application/json', body: JSON.stringify(body),
            })
        })

        for (const surface of SURFACES) {
            const tag = `${surface.id} @ ${vp.name}/${theme}`
            const before = consoleErrors.length
            try {
                await page.goto(BASE + surface.path, { waitUntil: 'domcontentloaded' })
                await page.waitForSelector(surface.ready, { timeout: 20000 })
                if (surface.tab) {
                    await page.click(`.ant-tabs-tab:has-text("${surface.tab}")`, { timeout: 8000 })
                    await page.waitForTimeout(400)
                }
                if (surface.section) {
                    // PM Configurations AntD Tabs kullanmaz: acilir
                    // kapanir Section basliklari var.
                    await page.click(
                        `.tm-section-head:has-text("${surface.section}")`,
                        { timeout: 8000 }
                    )
                    await page.waitForTimeout(600)
                }
            } catch (e) {
                results.push({ tag, status: 'LOAD_FAILED', detail: e.message.slice(0, 140) })
                continue
            }

            const metrics = await page.evaluate(() => {
                const doc = document.documentElement
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
                /**
                 * DOKUNMA HEDEFI: elementin kendi rect'i DEGIL, kullanicinin
                 * gercekten isabet ettirebildigi alan olculur. Hit alanini
                 * `::after` gibi bir pseudo-element buyutuyorsa rect bunu
                 * GOSTERMEZ; bu yuzden merkez cevresinde 24x24'luk bir kare
                 * ornekleyip her noktanin ayni kontrole dusup dusmedigine
                 * bakiyoruz (elementFromPoint pseudo-elementi ureten
                 * ELEMENTI dondurur).
                 */
                const hitsControl = (el, dx, dy) => {
                    const r = el.getBoundingClientRect()
                    const x = r.left + r.width / 2 + dx
                    const y = r.top + r.height / 2 + dy
                    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
                        // Viewport disina tasan ornek noktasi olcumu
                        // bozmasin: bu yonde kontrol edilemiyor sayilir.
                        return true
                    }
                    const hit = document.elementFromPoint(x, y)
                    return !!hit && (hit === el || el.contains(hit) || hit.contains(el))
                }
                /**
                 * MERKEZ ONCE: eger kontrolun kendi merkezi bile ona
                 * dusmuyorsa oge o an ORTULU ya da kirpilmis demektir
                 * (orn. kapali bir Section icindeki buton). Bu bir
                 * "kucuk hedef" bulgusu DEGILDIR; o durumda oge zaten
                 * etkilesime kapalidir ve olcum disi birakilir.
                 */
                const effectiveTargetOk = (el) => {
                    // Devre disi kontrol bir dokunma hedefi DEGILDIR.
                    if (el.disabled || el.getAttribute('aria-disabled') === 'true') {
                        return null
                    }
                    const r = el.getBoundingClientRect()
                    // Kendi kutusu zaten yeterliyse ORNEKLEME YAPILMAZ:
                    // komsu ogelerin ustte olmasi (ant-space, header vb.)
                    // yanlis pozitif uretiyordu. Ornekleme yalnizca KUCUK
                    // kutulari, pseudo-element ile buyutulmus hit alanini
                    // gormek icin gerekli.
                    if (r.width >= 24 && r.height >= 24) return true
                    if (!hitsControl(el, 0, 0)) return null // ortulu/kirpilmis
                    const half = 11
                    return hitsControl(el, -half, 0) && hitsControl(el, half, 0)
                        && hitsControl(el, 0, -half) && hitsControl(el, 0, half)
                }

                const small = []
                const unnamed = []
                for (const b of document.querySelectorAll('button')) {
                    if (!isVisible(b)) continue
                    const name = accName(b)
                    const ok = effectiveTargetOk(b)
                    if (ok === false) small.push(name || '?')
                    if (!name) unnamed.push(b.className.slice(0, 60))
                }
                // Kirpilan temel aksiyon: buton viewport'un DISINDA mi?
                const clipped = []
                for (const b of document.querySelectorAll('.ant-btn-primary, [role="dialog"] .ant-btn')) {
                    if (!isVisible(b)) continue
                    const r = b.getBoundingClientRect()
                    if (r.right > window.innerWidth + 1 || r.left < -1) {
                        clipped.push(accName(b).slice(0, 40) || '?')
                    }
                }
                const brokenImg = [...document.querySelectorAll('img')]
                    .filter((i) => i.complete && i.naturalWidth === 0).length
                return {
                    theme: doc.getAttribute('data-theme'),
                    bodyOverflow: doc.scrollWidth - doc.clientWidth,
                    smallTargets: [...new Set(small)],
                    unnamedButtons: [...new Set(unnamed)],
                    clipped: [...new Set(clipped)],
                    brokenImg,
                }
            })

            /**
             * ODAK HALKASI: gercek klavye ile surulur. Programatik
             * `.focus()` `:focus-visible` tetiklemez ve AntD primary
             * butonunun VARSAYILAN box-shadow'u "halka var" gibi
             * okunuyordu — yanlis PASS uretiyordu.
             */
            let focusRing = { found: false }
            try {
                await page.keyboard.press('Tab')
                await page.keyboard.press('Tab')
                focusRing = await page.evaluate(() => {
                    const el = document.activeElement
                    if (!el || el === document.body) return { found: false }
                    const before = getComputedStyle(el, ':focus-visible')
                    return {
                        found: true,
                        tag: el.tagName.toLowerCase(),
                        focusVisible: el.matches(':focus-visible'),
                        // Halka: outline ya da :focus-visible eslesmesi.
                        visible: el.matches(':focus-visible')
                            || (before.outlineStyle !== 'none'
                                && parseFloat(before.outlineWidth) > 0),
                    }
                })
            } catch {
                focusRing = { found: false }
            }

            // Modal: acilir mi, adi var mi, viewport'a sigar mi, ESC ile kapanir mi?
            let modal = { applicable: !!surface.open }
            if (surface.open) {
                try {
                    await page.click(surface.open, { timeout: 6000 })
                    await page.waitForSelector('.ant-modal-content', { timeout: 8000 })
                    modal = await page.evaluate(() => {
                        const d = document.querySelector('[role="dialog"]')
                        const r = d?.getBoundingClientRect()
                        const footer = document.querySelector('.ant-modal-footer, [role="dialog"] .ant-btn-primary')
                        const fr = footer?.getBoundingClientRect()
                        return {
                            applicable: true, opened: true,
                            named: !!(d?.getAttribute('aria-label') || d?.getAttribute('aria-labelledby')),
                            withinViewport: !!r && r.width <= window.innerWidth + 1,
                            footerVisible: !!fr && fr.bottom <= window.innerHeight + 1,
                        }
                    })
                    await page.keyboard.press('Escape')
                    await page.waitForTimeout(250)
                } catch (e) {
                    modal = { applicable: true, opened: false, detail: e.message.slice(0, 90) }
                }
            }

            results.push({
                tag, status: 'OK', ...metrics, focusRing, modal,
                consoleErrors: consoleErrors.slice(before, before + 3),
                deprecations: [...new Set(deprecations)].slice(0, 3),
            })
        }
        await ctx.close()
    }
}
await browser.close()

// ============================ Rapor =====================================
const fail = []
for (const r of results) {
    if (r.status !== 'OK') { fail.push(`${r.tag}: ${r.status} — ${r.detail || ''}`); continue }
    if (r.bodyOverflow > 1) fail.push(`${r.tag}: govde yatay tasma ${r.bodyOverflow}px`)
    if (r.smallTargets.length) fail.push(`${r.tag}: kucuk dokunma hedefi ${JSON.stringify(r.smallTargets)}`)
    if (r.unnamedButtons.length) fail.push(`${r.tag}: adsiz buton ${JSON.stringify(r.unnamedButtons)}`)
    if (r.clipped.length) fail.push(`${r.tag}: kirpilan aksiyon ${JSON.stringify(r.clipped)}`)
    if (r.brokenImg) fail.push(`${r.tag}: bozuk gorsel ${r.brokenImg}`)
    if (r.focusRing.found && !r.focusRing.visible) fail.push(`${r.tag}: odak halkasi GORUNMUYOR`)
    if (r.modal.applicable && !r.modal.opened) fail.push(`${r.tag}: modal acilmadi (${r.modal.detail || ''})`)
    if (r.modal.opened && !r.modal.named) fail.push(`${r.tag}: modalin erisilebilir adi YOK`)
    if (r.modal.opened && !r.modal.withinViewport) fail.push(`${r.tag}: modal viewport'u asiyor`)
    if (r.modal.opened && !r.modal.footerVisible) fail.push(`${r.tag}: modal footer GORUNMUYOR`)
    if (r.consoleErrors.length) fail.push(`${r.tag}: konsol hatasi ${JSON.stringify(r.consoleErrors)}`)
    if (r.deprecations.length) fail.push(`${r.tag}: AntD deprecation ${JSON.stringify(r.deprecations)}`)
}

console.log(JSON.stringify({ combinations: results.length, results }, null, 2))
console.log('\n===== OZET =====')
console.log(`Matris: ${results.length} kombinasyon `
    + `(${VIEWPORTS.length} viewport x 2 tema x ${SURFACES.length} yuzey)`)
const loadFailed = results.filter((r) => r.status !== 'OK').length
console.log(`Yuklenemeyen: ${loadFailed}`)
if (fail.length) {
    console.log(`SONUC: FAIL — ${fail.length} bulgu`)
    for (const f of fail.slice(0, 60)) console.log('  - ' + f)
    if (fail.length > 60) console.log(`  ... (+${fail.length - 60} daha)`)
    process.exit(1)
}
console.log('SONUC: PASS — tasma 0, kirpilan aksiyon 0, adsiz buton 0, '
    + 'odak gorunur, modal erisilebilir, konsol temiz, deprecation 0')
