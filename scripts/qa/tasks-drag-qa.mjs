/**
 * =============================================================================
 * HERMES - Board SURUKLE-BIRAK QA harness (Sprint 5C+)
 * =============================================================================
 * URUN BAGIMLILIGI DEGILDIR (playwright repo disinda ad-hoc kurulur —
 * kurulum icin scripts/qa/shell-visual-qa.mjs basligina bakin).
 *
 * NEDEN AYRI: jsdom'da PointerEvent sinifi ve eleman geometrisi YOKTUR;
 * entegrasyon testleri bunlari ortam duzeyinde taklit eder. Burada
 * GERCEK Chromium, GERCEK layout ve GERCEK fare hareketi kullanilir —
 * yani aktivasyon kisiti (6px), carpisma tespiti ve birakma hedefi
 * taklit edilmeden olculur.
 *
 * Olculen dort davranis (CTO kapisi):
 *   1. basarili surukleme → tek istek, payload == kartin INDIGI kolon
 *   2. API hatasi → optimistic geri alinir, kart tek kolonda kalir
 *   3. yetkisiz surukleme → istek YOK, kolon degismez
 *   4. pending sirasinda tekrarli surukleme → TEK istek
 *
 * NOT: dnd-kit birakma hedefini isaretcinin konumuna gore DEGIL,
 * suruklenen kartin dikdortgenine en yakin kolona gore secer
 * (closestCorners). Bu yuzden burada "hangi kolonu hedefledim"
 * iddiasinda BULUNULMAZ; olculen degismez sudur: istek payload'indaki
 * status, kartin gercekten INDIGI kolonla AYNIDIR ve baslangictan
 * FARKLIDIR. Kesin hedef secimi (in_progress/completed/rejected ayri
 * ayri) geometrinin deterministik oldugu jsdom entegrasyon paketinde
 * dogrulanir; buranin isi gercek pointer yasam dongusudur.
 *
 * NOT (mock sadakati): Tasks core uclari DUZ DIZI doner; zarf dondurmek
 * sayfayi error boundary'ye dusurur.
 *
 * Kullanim:
 *   cd frontend && npx vite build && npx vite preview --port 4174 &
 *   QA_BASE=http://localhost:4174 node scripts/qa/tasks-drag-qa.mjs
 * =============================================================================
 */
import { chromium } from 'playwright'

const BASE = process.env.QA_BASE || 'http://localhost:4174'

const TASK = {
    id: 't1', task_code: 'TASK-1', task_type: 'task',
    title: 'Surukletilecek gorev', description: 'Aciklama',
    status: 'pending', priority: 'medium',
    customer_id: 'c1', project_id: 'p1', sub_project_id: null,
    customer_name: 'Vakko', project_name: 'ATM Yenileme',
    assignee_user_id: 'u1', assigner_user_id: 'u2',
    scheduled_date: '2026-07-27', due_date: '2026-07-31',
}
// Ne atanan ne atayan → surukleyemez.
const FOREIGN = { ...TASK, id: 't2', task_code: 'TASK-2', title: 'Yabanci gorev',
    assignee_user_id: 'u3', assigner_user_id: 'u2' }

const PERMS = {
    is_admin: false,
    task: { can_access: true, can_assign: true, assignable_user_ids: ['u2'], assignable_group_ids: [] },
    issue: { can_access: true, can_assign: true, assignable_user_ids: ['u2'], assignable_group_ids: [] },
}
const USERS = [
    { id: 'u1', full_name: 'Ada Lovelace', email: 'ada@duosis.com' },
    { id: 'u2', full_name: 'Grace Hopper', email: 'grace@duosis.com' },
    { id: 'u3', full_name: 'Alan Turing', email: 'alan@duosis.com' },
]

const results = []
const browser = await chromium.launch()

/**
 * Senaryo kurar: sunucu durumu, status ucunun davranisi ve istek sayaci.
 * @param mode 'ok' | 'error' | 'slow'
 */
async function scenario({ name, tasks, mode }) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    const consoleErrors = []
    page.on('console', (m) => {
        if (m.type() === 'error' && !m.text().includes('env-config')) {
            consoleErrors.push(m.text().slice(0, 120))
        }
    })
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message.slice(0, 120)))

    const statusCalls = []
    let server = tasks.map((t) => ({ ...t }))
    let releaseSlow = null
    const slowGate = new Promise((r) => { releaseSlow = r })

    await page.route('**/api/**', async (route) => {
        const req = route.request()
        const url = req.url()
        const json = (body, status = 200) =>
            route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

        if (/\/tasks\/[^/]+\/status/.test(url) && req.method() === 'PATCH') {
            const id = url.match(/\/tasks\/([^/]+)\/status/)[1]
            const payload = JSON.parse(req.postData() || '{}')
            statusCalls.push({ id, status: payload.status })
            if (mode === 'error') {
                return json({ detail: 'Status change refused.' }, 409)
            }
            if (mode === 'slow') await slowGate
            server = server.map((t) => (t.id === id ? { ...t, status: payload.status } : t))
            return json({ id, status: payload.status })
        }
        if (url.includes('/auth/users/me')) {
            return json({ id: 'u1', email: 'ada@duosis.com', full_name: 'Ada Lovelace', is_admin: false })
        }
        if (url.includes('/rbac/me')) return json({ permissions: [], roles: [] })
        if (url.includes('/users/lookup')) return json(USERS)
        if (url.includes('permissions/me')) return json(PERMS)
        if (/\/core\/tasks(\?|$)/.test(url)) return json(server)
        return json([])
    })

    await page.goto(BASE + '/project-management/tasks', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.task-card', { timeout: 15000 })
    return { page, ctx, statusCalls, consoleErrors, releaseSlow, server: () => server }
}

/** Kartin icinde bulundugu kolonun statusu. */
const columnOf = (page, code) =>
    page.evaluate((c) => {
        const card = [...document.querySelectorAll('.task-card')]
            .filter((e) => !e.closest('.tasks-board-drag-overlay'))
            .find((e) => (e.getAttribute('aria-label') || '').includes(c))
        if (!card) return null
        const col = card.closest('.tasks-board-column')
        return [...col.classList]
            .find((k) => k.startsWith('tasks-board-column-') && k !== 'tasks-board-column-body')
            ?.replace('tasks-board-column-', '') ?? null
    }, code)

/** GERCEK fare ile kart → hedef kolon. */
async function dragTo(page, code, targetStatus) {
    const card = page.locator('.task-card').filter({ has: page.locator('.task-card-code', { hasText: code }) }).first()
    const target = page.locator(`.tasks-board-column-${targetStatus} .tasks-board-column-body`).first()
    const from = await card.boundingBox()
    const to = await target.boundingBox()
    if (!from || !to) return false
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    // Aktivasyon kisitini (6px) as, sonra kademeli ilerle.
    await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2, { steps: 3 })
    // Hedefin SOL-UST bolgesine birak: kart, isaretciyi yakalandigi
    // noktadan takip ettigi icin kolonun tam merkezine nisan almak
    // kartin sag kenarini komsu kolona tasirabiliyor. Sol-ic nokta
    // her zaman tek bir kolona duser.
    await page.mouse.move(to.x + 24, to.y + 40, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(350)
    return true
}

// ── 1. Basarili surukleme ────────────────────────────────────────────────
{
    const s = await scenario({ name: 'success', tasks: [TASK], mode: 'ok' })
    const before = await columnOf(s.page, 'TASK-1')
    await dragTo(s.page, 'TASK-1', 'in_progress')
    await s.page.waitForTimeout(400)
    const after = await columnOf(s.page, 'TASK-1')
    results.push({
        id: 'success',
        columnBefore: before,
        columnAfter: after,
        movedToDifferentColumn: after !== before,
        requests: s.statusCalls,
        payloadMatchesLandedColumn:
            s.statusCalls.length === 1 && s.statusCalls[0].status === after,
        cardCount: await s.page.locator('.task-card').count(),
        consoleErrors: s.consoleErrors.length,
    })
    await s.ctx.close()
}

// ── 2. API hatasi → rollback ─────────────────────────────────────────────
{
    const s = await scenario({ name: 'error', tasks: [TASK], mode: 'error' })
    await dragTo(s.page, 'TASK-1', 'completed')
    await s.page.waitForTimeout(600)
    results.push({
        id: 'error-rollback',
        columnAfter: await columnOf(s.page, 'TASK-1'),
        requests: s.statusCalls,
        cardCount: await s.page.locator('.task-card').count(),
        errorToast: await s.page.locator('.ant-message-notice').first()
            .textContent().catch(() => null),
        consoleErrors: s.consoleErrors.length,
    })
    await s.ctx.close()
}

// ── 3. Yetkisiz surukleme ────────────────────────────────────────────────
{
    const s = await scenario({ name: 'forbidden', tasks: [FOREIGN], mode: 'ok' })
    const locked = await s.page.evaluate(() => {
        const node = document.querySelector('.tasks-board-draggable')
        return { role: node?.getAttribute('role') ?? null, cls: node?.className ?? null }
    })
    await dragTo(s.page, 'TASK-2', 'completed')
    await s.page.waitForTimeout(400)
    results.push({
        id: 'forbidden',
        draggableRole: locked.role,
        lockedClass: (locked.cls || '').includes('is-locked'),
        columnAfter: await columnOf(s.page, 'TASK-2'),
        requests: s.statusCalls,
        consoleErrors: s.consoleErrors.length,
    })
    await s.ctx.close()
}

// ── 4. Pending sirasinda tekrarli surukleme ──────────────────────────────
{
    const s = await scenario({ name: 'repeat', tasks: [TASK], mode: 'slow' })
    await dragTo(s.page, 'TASK-1', 'in_progress')
    const midColumn = await columnOf(s.page, 'TASK-1')
    // Ilk istek hala ucuyor: iki kez daha surukle.
    await dragTo(s.page, 'TASK-1', 'completed')
    await dragTo(s.page, 'TASK-1', 'rejected')
    const duringPending = { requests: [...s.statusCalls], column: await columnOf(s.page, 'TASK-1') }
    s.releaseSlow()
    await s.page.waitForTimeout(700)
    results.push({
        id: 'repeat-while-pending',
        columnAfterFirstDrag: midColumn,
        requestsWhilePending: duringPending.requests,
        columnWhilePending: duringPending.column,
        requestsTotal: s.statusCalls,
        columnFinal: await columnOf(s.page, 'TASK-1'),
        cardCount: await s.page.locator('.task-card').count(),
        consoleErrors: s.consoleErrors.length,
    })
    await s.ctx.close()
}

await browser.close()
console.log(JSON.stringify(results, null, 1))
