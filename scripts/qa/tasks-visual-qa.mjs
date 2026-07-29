/**
 * =============================================================================
 * HERMES - Tasks gorsel QA harness (Sprint 5)
 * =============================================================================
 * URUN BAGIMLILIGI DEGILDIR (playwright repo disinda ad-hoc kurulur —
 * kurulum icin scripts/qa/shell-visual-qa.mjs basligina bakin).
 *
 * NOT (mock sadakati): Tasks yuzeyindeki core uclari DUZ DIZI doner.
 * Zarf ({data: []}) dondurmek sayfayi "not iterable" / "map is not a
 * function" ile route error boundary'ye dusurur — yani yanlis mock,
 * yanlis "kusur" uretir. Bu harness gercek sekli kullanir.
 *
 * Sprint 5 — Tasks gorsel QA (gercek Chromium, deterministik mock).
 * Senaryolar: bos/normal/yogun/uzun metin/loading/API error, pending +
 * in_progress + completed, admin vs normal vs erisimsiz kullanici,
 * direct /tasks navigation, focus-visible, reduced-motion.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const BASE = process.env.QA_BASE || 'http://localhost:4174'
const OUT = process.env.QA_OUT || './tasks-shots'
mkdirSync(OUT, { recursive: true })

const mkTask = (i, over = {}) => ({
    id: `t${i}`, task_code: `TASK-${i}`, task_type: 'task',
    title: `Gorev ${i} basligi`, description: `Aciklama ${i}`,
    status: 'pending', priority: 'medium',
    customer_name: 'Vakko', project_name: 'ATM',
    assignee_user_id: 'u1', assigner_user_id: 'u2',
    scheduled_date: '2026-07-29', due_date: '2026-08-05', ...over,
})
const LONG = mkTask(99, {
    title: 'Cok uzun bir gorev basligi buraya yaziliyor ve tasma davranisini olcuyoruz '.repeat(2),
    customer_name: 'Cok Uzun Musteri Unvani Anonim Sirketi',
    project_name: 'Cok Uzun Proje Adi Buraya Yazildi Tasma Testi',
})

// GERCEK API sekli (snake_case) — useTaskPermissions.scopeView ile birebir.
const PERMS_FULL = { is_admin: false,
    task: { can_access: true, can_assign: true, assignable_user_ids: ['u2'], assignable_group_ids: [] },
    issue: { can_access: true, can_assign: false, assignable_user_ids: [], assignable_group_ids: [] } }
const PERMS_NOASSIGN = { is_admin: false,
    task: { can_access: true, can_assign: false, assignable_user_ids: [], assignable_group_ids: [] },
    issue: { can_access: true, can_assign: false, assignable_user_ids: [], assignable_group_ids: [] } }
const PERMS_NONE = { is_admin: false,
    task: { can_access: false, can_assign: false },
    issue: { can_access: false, can_assign: false } }

const SCEN = {
  empty:      { tasks: [], perms: PERMS_FULL },
  normal:     { tasks: [mkTask(1), mkTask(2,{status:'in_progress'}), mkTask(3,{status:'completed'})], perms: PERMS_FULL },
  dense:      { tasks: Array.from({length:9},(_,i)=>mkTask(i+10)), perms: PERMS_FULL },
  long:       { tasks: [LONG], perms: PERMS_FULL },
  noassign:   { tasks: [mkTask(1)], perms: PERMS_NOASSIGN },
  noaccess:   { tasks: [], perms: PERMS_NONE },
  permsnull:  { tasks: [], perms: null },
  error:      { tasks: null, perms: PERMS_FULL },
}
const VPS = [
  { name:'390x844', width:390, height:844 },
  { name:'768x1024', width:768, height:1024 },
  { name:'1280x800', width:1280, height:800 },
  { name:'1920x1080', width:1920, height:1080 },
]
const results = []
const browser = await chromium.launch()

for (const [name, scen] of Object.entries(SCEN)) {
  const vps = name === 'normal' ? VPS : [VPS[2]]
  const themes = (name === 'normal' || name === 'dense') ? ['dark','light'] : ['dark']
  for (const vp of vps) for (const theme of themes) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height },
        reducedMotion: name === 'normal' && vp.name === '1280x800' ? 'reduce' : 'no-preference' })
    const page = await ctx.newPage()
    const errors = []
    page.on('console', m => { if (m.type()==='error') errors.push(m.text().slice(0,110)) })
    page.on('pageerror', e => errors.push('pageerror: '+e.message.slice(0,110)))
    await page.route('**/api/**', async (route) => {
      const url = route.request().url()
      if (scen.tasks === null && url.includes('task'))
        return route.fulfill({ status: 500, contentType:'application/json', body:'{"detail":"hata"}' })
      // Tasks yuzeyindeki TUM core uclari DUZ DIZI doner (servisler
      // response.data'yi aynen gecer). Zarf dondurmek sayfayi
      // "not iterable"/"map is not a function" ile error boundary'ye
      // dusurur — mock sadakati sonucun gecerliligi icin sart.
      let body = []
      if (url.includes('/auth/users/me')) body = { id:'u1', email:'ada@duosis.com', full_name:'Ada Lovelace', is_admin:false }
      else if (url.includes('/rbac/me')) body = { permissions: [], roles: [] }
      else if (url.includes('permissions/me')) {
        if (scen.perms === null) return new Promise(() => {}) // hic cevap verme → null durumu
        body = scen.perms
      }
      // GERCEK sekil: /core/tasks DUZ DIZI doner (taskService.list →
      // response.data). Zarf dondurmek sayfayi "not iterable" ile
      // error boundary'ye dusurur — mock sadakati onemli.
      else if (/\/core\/tasks(\?|$)/.test(url)) body = scen.tasks || []

      await route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(body) })
    })
    await page.addInitScript(t => localStorage.setItem('hermes-theme', t), theme)

    // DIRECT navigation — hard refresh senaryosu (§11)
    await page.goto(BASE + '/tasks', { waitUntil: 'domcontentloaded' }) // legacy → /project-management
    await page.waitForTimeout(2200)

    const tag = `${name}-${vp.name}-${theme}`
    const checks = await page.evaluate(() => {
      const doc = document.documentElement
      const cards = [...document.querySelectorAll('.task-card')]
      const clipped = cards.filter(c => {
        const t = c.querySelector('.task-card-title-text')
        return t && t.scrollWidth > t.clientWidth + 1 && getComputedStyle(t).overflow === 'visible'
      }).length
      return {
        url: location.pathname,
        blank: document.body.innerText.trim().length < 20,
        hasShell: !!document.querySelector('.main-header'),
        cards: cards.length,
        hOverflow: doc.scrollWidth > doc.clientWidth + 1,
        clippedTitles: clipped,
        canvas: getComputedStyle(doc).getPropertyValue('--h-bg-canvas').trim(),
        bodyBg: getComputedStyle(document.body).backgroundColor,
        // Yetkisiz kontrol sizmasi: atama yetkisi yokken "Assigned by Me"
        assignedByMeVisible: document.body.innerText.includes('Assigned by Me'),
        cardAria: cards[0]?.getAttribute('aria-label') ?? null,
      }
    })
    await page.screenshot({ path: `${OUT}/${tag}.png` })
    let focusInfo = null
    if (name === 'normal' && vp.name === '1280x800' && theme === 'dark') {
      await page.locator('.task-card').first().focus().catch(()=>{})
      focusInfo = await page.evaluate(() => {
        const el = document.activeElement
        const cs = el ? getComputedStyle(el) : null
        return cs ? { tag: el.tagName, outline: cs.outlineStyle, cls: el.className.slice(0,40) } : null
      })
      await page.screenshot({ path: `${OUT}/${tag}-focus.png` })
    }
    results.push({ id: tag, ...checks, focusInfo, consoleErrors: errors.length, firstError: errors[0] ?? null })
    await ctx.close()
  }
}
await browser.close()
console.log(JSON.stringify(results, null, 1))
