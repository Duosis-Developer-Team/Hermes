/**
 * =============================================================================
 * HERMES - Tasks modal KLAVYE/FOCUS QA harness (Sprint 5C)
 * =============================================================================
 * URUN BAGIMLILIGI DEGILDIR (playwright repo disinda ad-hoc kurulur —
 * kurulum icin scripts/qa/shell-visual-qa.mjs basligina bakin).
 *
 * NEDEN AYRI BIR HARNESS: jsdom su uc seyi GUVENILIR olcemez —
 *   1. Tab / Shift+Tab focus TUZAGI (jsdom'da tarayici tab-order motoru yok),
 *   2. arka plan icerigin gercekten tiklanamiyor olmasi (mask hit-testing),
 *   3. `aria-labelledby` ile hesaplanan gercek erisilebilir ad
 *      (rc-util `useId` NODE_ENV=test altinda TUM diyaloglara sabit
 *      "test-id" verir → jsdom'da adlar birbirine karisir).
 * Bunlar burada GERCEK Chromium'da olculur.
 *
 * NOT (mock sadakati — tasks-visual-qa.mjs ile ayni kural): Tasks core
 * uclari DUZ DIZI doner. Zarf dondurmek sayfayi error boundary'ye
 * dusurur; yanlis mock yanlis "kusur" uretir.
 *
 * Kullanim:
 *   cd frontend && npx vite build && npx vite preview --port 4174 &
 *   QA_BASE=http://localhost:4174 node scripts/qa/tasks-a11y-qa.mjs
 * =============================================================================
 */
import { chromium } from 'playwright'

const BASE = process.env.QA_BASE || 'http://localhost:4174'

const mkTask = (over = {}) => ({
    id: 't1', task_code: 'TASK-1', task_type: 'task',
    title: 'Gorev basligi', description: 'Gorev aciklamasi',
    status: 'in_progress', priority: 'medium',
    customer_id: 'c1', project_id: 'p1', sub_project_id: null,
    customer_name: 'Vakko', project_name: 'ATM Yenileme',
    assignee_user_id: 'u1', assigner_user_id: 'u1',
    scheduled_date: '2026-07-27', due_date: '2026-07-31', ...over,
})

const TASKS = [
    mkTask(),
    mkTask({
        id: 't3', task_code: 'TASK-3', title: 'Biten gorev',
        status: 'completed',
    }),
]

// GERCEK API sekli (snake_case) — useTaskPermissions.scopeView ile birebir.
const PERMS = {
    is_admin: false,
    task: {
        can_access: true, can_assign: true,
        assignable_user_ids: ['u2'], assignable_group_ids: [],
    },
    issue: {
        can_access: true, can_assign: true,
        assignable_user_ids: ['u2'], assignable_group_ids: [],
    },
}
const USERS = [
    { id: 'u1', full_name: 'Ada Lovelace', email: 'ada@duosis.com' },
    { id: 'u2', full_name: 'Grace Hopper', email: 'grace@duosis.com' },
]

const results = []
const record = (id, data) => results.push({ id, ...data })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const consoleErrors = []
page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 140))
})
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message.slice(0, 140)))

await page.route('**/api/**', async (route) => {
    const url = route.request().url()
    let body = []
    if (url.includes('/auth/users/me')) {
        body = { id: 'u1', email: 'ada@duosis.com', full_name: 'Ada Lovelace', is_admin: false }
    } else if (url.includes('/rbac/me')) {
        body = { permissions: [], roles: [] }
    } else if (url.includes('/users/lookup')) {
        body = USERS
    } else if (url.includes('permissions/me')) {
        body = PERMS
    } else if (/\/core\/tasks(\?|$)/.test(url)) {
        body = TASKS
    } else if (url.includes('/customers')) {
        body = [{ id: 'c1', name: 'Vakko', code: 'VAK' }]
    } else if (url.includes('/projects')) {
        body = [{ id: 'p1', customer_id: 'c1', name: 'ATM Yenileme' }]
    } else if (url.includes('/work-types')) {
        body = [{ id: 'w1', name: 'Development' }]
    } else if (url.includes('/activity-types')) {
        body = [{ id: 'a1', name: 'Coding' }]
    } else if (url.includes('/platforms')) {
        body = [{ id: 'pf1', name: 'Backend' }]
    } else if (url.includes('/work-lines')) {
        body = [{ id: 'wl1', name: 'Delivery' }]
    }
    await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(body),
    })
})

await page.goto(BASE + '/project-management/tasks', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.task-card', { timeout: 15000 })

/** Acik diyalogun gercek erisilebilir adi + aria-modal. */
const dialogFacts = () =>
    page.evaluate(() => {
        const wraps = Array.from(document.querySelectorAll('.ant-modal-wrap'))
            .filter((w) => w.style.display !== 'none')
        const dlg = wraps.at(-1)?.querySelector('[role="dialog"]')
        if (!dlg) return null
        const labelledBy = dlg.getAttribute('aria-labelledby')
        const labelEl = labelledBy ? document.getElementById(labelledBy) : null
        return {
            ariaModal: dlg.getAttribute('aria-modal'),
            accessibleName: labelEl ? labelEl.textContent.trim() : null,
            uniqueId: labelledBy,
        }
    })

/** Focus'un modal icinde kalip kalmadigini N kez Tab basarak olcer. */
const tabTrap = async (steps, shift = false) => {
    const inside = []
    for (let i = 0; i < steps; i++) {
        await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab')
        inside.push(
            await page.evaluate(() => {
                const wraps = Array.from(document.querySelectorAll('.ant-modal-wrap'))
                    .filter((w) => w.style.display !== 'none')
                const dlg = wraps.at(-1)
                const el = document.activeElement
                return !!(dlg && el && (dlg.contains(el) || dlg === el))
            })
        )
    }
    return inside
}

/** Arka plandaki bir kart modal acikken tiklanabilir mi? */
const backgroundHitTest = () =>
    page.evaluate(() => {
        const card = document.querySelector('.task-card')
        if (!card) return { reachable: null }
        const r = card.getBoundingClientRect()
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + 8)
        return {
            // Kartin ustundeki nokta modal mask/wrap tarafindan
            // kapatiliyorsa arka plan ETKILESIM ALMAZ.
            reachable: !!(top && card.contains(top)),
            topEl: top ? top.className.toString().slice(0, 40) : null,
        }
    })

const closeAnyModal = async () => {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
}

// ── 1. Log Time modali ───────────────────────────────────────────────────
{
    const trigger = page.locator('button[aria-label="Log time — Biten gorev"]')
    await trigger.focus()
    await trigger.click()
    await page.waitForSelector('.log-time-modal', { timeout: 8000 })
    await page.waitForTimeout(300)
    const facts = await dialogFacts()
    const bg = await backgroundHitTest()
    const fwd = await tabTrap(14)
    const back = await tabTrap(8, true)
    await closeAnyModal()
    const focusBack = await page.evaluate(
        () => document.activeElement?.getAttribute('aria-label') ?? null
    )
    record('logtime', {
        ...facts,
        backgroundReachable: bg.reachable,
        backgroundTopEl: bg.topEl,
        tabStaysInside: fwd.every(Boolean),
        shiftTabStaysInside: back.every(Boolean),
        escapeClosed: (await page.locator('.log-time-modal').count()) === 0
            || !(await page.locator('.log-time-modal').first().isVisible()),
        focusReturnedTo: focusBack,
    })
}

// ── 2. Edit modali ───────────────────────────────────────────────────────
{
    const trigger = page.locator('button[aria-label="Edit — Gorev basligi"]')
    await trigger.focus()
    await trigger.click()
    await page.getByRole('dialog', { name: 'Edit Task' })
        .waitFor({ state: 'visible', timeout: 8000 })
    await page.waitForTimeout(300)
    const facts = await dialogFacts()
    const bg = await backgroundHitTest()
    const fwd = await tabTrap(16)
    const back = await tabTrap(8, true)
    await closeAnyModal()
    const focusBack = await page.evaluate(
        () => document.activeElement?.getAttribute('aria-label') ?? null
    )
    record('edit', {
        ...facts,
        backgroundReachable: bg.reachable,
        backgroundTopEl: bg.topEl,
        tabStaysInside: fwd.every(Boolean),
        shiftTabStaysInside: back.every(Boolean),
        focusReturnedTo: focusBack,
    })
}

// ── 3. Delete onay modali ────────────────────────────────────────────────
{
    const trigger = page.locator('button[aria-label="Delete — Gorev basligi"]')
    await trigger.focus()
    await trigger.click()
    await page.getByRole('dialog', { name: /Delete Task/ })
        .waitFor({ state: 'visible', timeout: 8000 })
    await page.waitForTimeout(300)
    const facts = await dialogFacts()
    const bg = await backgroundHitTest()
    const fwd = await tabTrap(8)
    const back = await tabTrap(6, true)
    await closeAnyModal()
    const focusBack = await page.evaluate(
        () => document.activeElement?.getAttribute('aria-label') ?? null
    )
    record('delete', {
        ...facts,
        backgroundReachable: bg.reachable,
        backgroundTopEl: bg.topEl,
        tabStaysInside: fwd.every(Boolean),
        shiftTabStaysInside: back.every(Boolean),
        focusReturnedTo: focusBack,
    })
}

// ── 4. Create modali (Assigned by Me kapsami) ────────────────────────────
{
    await page.getByRole('tab', { name: 'Assigned by Me' }).click()
    await page.waitForTimeout(400)
    await page.locator('button[aria-label="New work item"]').click()
    await page.getByRole('menuitem', { name: 'New Task' }).click()
    await page.getByRole('dialog', { name: 'Create Task' })
        .waitFor({ state: 'visible', timeout: 8000 })
    await page.waitForTimeout(300)
    const facts = await dialogFacts()
    const bg = await backgroundHitTest()
    const fwd = await tabTrap(18)
    const back = await tabTrap(8, true)
    await closeAnyModal()
    record('create', {
        ...facts,
        backgroundReachable: bg.reachable,
        backgroundTopEl: bg.topEl,
        tabStaysInside: fwd.every(Boolean),
        shiftTabStaysInside: back.every(Boolean),
    })
}

// ── 5. Kart aksiyonlarinin erisilebilir adlari + global kisayol yoklugu ──
{
    await page.waitForTimeout(300)
    const names = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.task-card-action-btn')).map((b) =>
            b.getAttribute('aria-label')
        )
    )
    await page.keyboard.press('Control+c')
    await page.keyboard.press('Control+v')
    await page.keyboard.press('Meta+c')
    await page.keyboard.press('Meta+v')
    await page.waitForTimeout(300)
    const modalsAfterShortcuts = await page.evaluate(
        () =>
            Array.from(document.querySelectorAll('.ant-modal-wrap')).filter(
                (w) => w.style.display !== 'none'
            ).length
    )
    record('surface', {
        actionButtonNames: names,
        allNamed: names.every(Boolean),
        modalsAfterClipboardShortcuts: modalsAfterShortcuts,
        clipboardTextOnSurface: await page.evaluate(() =>
            /copied|clipboard|Ctrl\+C|Ctrl\+V/i.test(document.body.innerText)
        ),
    })
}

record('console', { errors: consoleErrors.length, first: consoleErrors[0] ?? null })

await browser.close()
console.log(JSON.stringify(results, null, 1))
