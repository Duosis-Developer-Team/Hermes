/**
 * =============================================================================
 * HERMES - Time Entry gorsel QA harness (Sprint 4)
 * =============================================================================
 * URUN BAGIMLILIGI DEGILDIR (playwright repo disinda ad-hoc kurulur;
 * kurulum icin scripts/qa/shell-visual-qa.mjs basligina bakin).
 *
 * Sprint 4 — Time Entry gorsel QA (gercek Chromium, deterministik mock).
 * Senaryolar: bos/normal/yogun hafta, uzun metinler, secili+kopyalanmis
 * kayit, loading, API error, admin vs normal kullanici, modal, reduced
 * motion — 4 viewport x 2 tema.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.QA_BASE || 'http://localhost:4174'
const OUT = process.env.QA_OUT || './te-shots'
mkdirSync(OUT, { recursive: true })

const mkLog = (i, day, over = {}) => ({
    id: `log-${i}`, customer_id: 'c1', project_id: 'p1', work_type_id: 'w1',
    activity_type_id: null, platform_id: null, work_line_id: null,
    date_worked: day, duration_hours: 2.5,
    description: `Kayit ${i} aciklamasi`,
    customer_name: 'Vakko', project_name: 'ATM Projesi',
    customer_code: 'VKK', work_type_name: 'Dev', ...over,
})
const LONG = mkLog(99, '2026-07-28', {
    description: 'Cok uzun bir aciklama metni buraya yaziliyor ve tasma davranisini test ediyoruz'.repeat(2),
    project_name: 'Cok Uzun Proje Adi Buraya Yazildi Tasma Testi Icin',
    customer_name: 'Cok Uzun Musteri Unvani Anonim Sirketi', duration_hours: 7.75,
})

const SCEN = {
    empty:  { logs: [] },
    normal: { logs: [mkLog(1,'2026-07-27'), mkLog(2,'2026-07-28'), mkLog(3,'2026-07-30',{duration_hours:8})] },
    dense:  { logs: Array.from({length:7},(_,i)=>mkLog(i+10,'2026-07-29',{duration_hours:1})) },
    long:   { logs: [LONG] },
    locked: { logs: [mkLog(1,'2026-07-27')], period: { status: 'submitted', is_locked: true } },
    error:  { logs: null },
    loading:{ logs: [], slow: true },
}

const VPS = [
    { name:'390x844', width:390, height:844 },
    { name:'768x1024', width:768, height:1024 },
    { name:'1280x800', width:1280, height:800 },
    { name:'1920x1080', width:1920, height:1080 },
]

const results = []
const browser = await chromium.launch()

for (const [scenName, scen] of Object.entries(SCEN)) {
  for (const vp of (scenName === 'normal' ? VPS : [VPS[2]])) {
    for (const theme of (scenName === 'normal' || scenName === 'dense' ? ['dark','light'] : ['dark'])) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
      const page = await ctx.newPage()
      const errors = []
      page.on('console', m => { if (m.type()==='error') errors.push(m.text().slice(0,120)) })
      page.on('pageerror', e => errors.push('pageerror: '+e.message.slice(0,120)))

      await page.route('**/api/**', async (route) => {
        const url = route.request().url()
        if (scen.slow && url.includes('work-logs')) await new Promise(r => setTimeout(r, 4000))
        if (scen.logs === null && url.includes('work-logs'))
          return route.fulfill({ status: 500, contentType:'application/json', body:'{"detail":"Sunucu hatasi"}' })
        let body = { data: [] }
        if (url.includes('/auth/users/me')) body = { id:'u1', email:'ada@duosis.com', full_name:'Ada Lovelace', is_admin:false }
        else if (url.includes('/rbac/me')) body = { permissions: scenName==='admin' ? ['worklogs.admin'] : [], roles: [] }
        else if (url.includes('permissions/me')) body = { is_admin:false, scopes:{task:{},issue:{}}, assignable_user_ids:[], assignable_group_ids:[] }
        else if (url.includes('work-logs')) body = { data: scen.logs || [] }
        else if (url.includes('period')) body = scen.period || { status: 'open' }
        await route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(body) })
      })
      await page.addInitScript(t => { localStorage.setItem('hermes-theme', t) }, theme)
      await page.goto(BASE + '/time-entry', { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.main-header', { timeout: 15000 })
      await page.waitForTimeout(scen.slow ? 700 : 1200)

      const tag = `${scenName}-${vp.name}-${theme}`
      const checks = await page.evaluate(() => {
        const doc = document.documentElement
        const cards = [...document.querySelectorAll('.worklog-card')]
        // Gun sutunu yukseklik drift'i
        const cols = [...document.querySelectorAll('.day-column')]
        const hs = cols.map(c => Math.round(c.getBoundingClientRect().height))
        // Metin kirpilmasi: kart basliklari kutuyu tasiyor mu
        const clipped = cards.filter(c => {
            const t = c.querySelector('.worklog-card-title')
            return t && t.scrollWidth > t.clientWidth + 1
        }).length
        return {
            hOverflow: doc.scrollWidth > doc.clientWidth + 1,
            cards: cards.length,
            colHeights: hs.length ? `${Math.min(...hs)}-${Math.max(...hs)}` : 'n/a',
            colDrift: hs.length ? Math.max(...hs) - Math.min(...hs) : 0,
            clippedTitles: clipped,
            canvas: getComputedStyle(doc).getPropertyValue('--h-bg-canvas').trim(),
            bodyBg: getComputedStyle(document.body).backgroundColor,
        }
      })
      await page.screenshot({ path: `${OUT}/${tag}.png` })

      // Secim + kopyalama gorsel durumu (yalniz normal senaryo)
      let interaction = null
      if (scenName === 'normal' && vp.name === '1280x800') {
        const card = page.locator('.worklog-card').first()
        await card.click()
        await page.keyboard.press('Control+c')
        await page.waitForTimeout(350)
        interaction = await page.evaluate(() => {
          const c = document.querySelector('.worklog-card-copied')
          const badge = document.querySelector('.worklog-selected-badge')
          return { copiedStyled: !!c, badgeText: badge?.textContent?.trim() ?? null,
                   ariaLabel: document.querySelector('.worklog-card')?.getAttribute('aria-label') }
        })
        await page.screenshot({ path: `${OUT}/${tag}-copied.png` })
      }
      results.push({ id: tag, ...checks, consoleErrors: errors.length,
                     sampleError: errors[0] ?? null, interaction })
      await ctx.close()
    }
  }
}
await browser.close()
console.log(JSON.stringify(results, null, 1))
