#!/usr/bin/env node
/**
 * =============================================================================
 * HERMES - Frontend baseline olcumu (Sprint 0, CTO paketi 2026-07-29)
 * =============================================================================
 * Sprint 1+ premiumizasyonunun ONCE/SONRA kiyasi icin deterministik,
 * secret-safe metrikler uretir ve docs/frontend-premiumization/baseline.md
 * dosyasina yazar. Kod icerigi/deger YAZMAZ — yalniz sayilar ve path'ler.
 *
 * Kullanim (repo kokunden):  node scripts/frontend/measure-baseline.mjs
 * Not: production build metrikleri icin once `npx vite build` kosulmus
 * olmali (frontend/dist mevcutsa olculur; yoksa NOT RUN yazilir).
 * =============================================================================
 */
import { execSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join, extname, relative } from 'node:path'

const ROOT = process.cwd()
const FE = join(ROOT, 'frontend')
const SRC = join(FE, 'src')
const DIST = join(FE, 'dist')
const OUT = join(ROOT, 'docs', 'frontend-premiumization', 'baseline.md')

const sh = (cmd) => { try { return execSync(cmd, { encoding: 'utf8' }).trim() } catch { return 'NOT AVAILABLE' } }

// --- kaynak dosya gezgini -------------------------------------------------
const exts = new Set(['.js', '.jsx', '.ts', '.tsx', '.css'])
const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) { if (name !== 'node_modules') walk(p) }
    else if (exts.has(extname(name))) files.push(p)
  }
}
walk(SRC)

const read = (p) => readFileSync(p, 'utf8')
const loc = (p) => read(p).split('\n').length
const totalLoc = files.reduce((a, f) => a + loc(f), 0)
const top20 = files.map((f) => [relative(FE, f), loc(f)])
  .sort((a, b) => b[1] - a[1]).slice(0, 20)

// --- desen sayaclari ------------------------------------------------------
let inlineStyle = 0, importantCount = 0, transitionAll = 0, oldInvalidation = 0
const hexColors = new Set()
for (const f of files) {
  const s = read(f)
  inlineStyle += (s.match(/style=\{\{/g) || []).length
  importantCount += (s.match(/!important/g) || []).length
  transitionAll += (s.match(/transition:\s*all/g) || []).length
  oldInvalidation += (s.match(/invalidateQueries\(\s*\[/g) || []).length
  for (const m of s.match(/#[0-9a-fA-F]{3,8}\b/g) || []) hexColors.add(m.toLowerCase())
}

// --- route envanteri ------------------------------------------------------
const appSrc = existsSync(join(SRC, 'App.jsx')) ? read(join(SRC, 'App.jsx')) : ''
const routes = [...appSrc.matchAll(/path="([^"]+)"/g)].map((m) => m[1])
const lazyCount = (appSrc.match(/React\.lazy|lazy\(/g) || []).length

// --- test envanteri -------------------------------------------------------
const testFiles = files.filter((f) => /\.test\.|__tests__/.test(f))

// --- API servis boyutlari -------------------------------------------------
const apiFiles = files.filter((f) => /services\//.test(f))
  .map((f) => [relative(FE, f), loc(f)]).sort((a, b) => b[1] - a[1])

// --- dis asset istekleri --------------------------------------------------
let externalRefs = 0
const externalHosts = new Set()
for (const f of files) {
  for (const m of read(f).matchAll(/https?:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.[^/"']+)/g)) {
    externalRefs++; externalHosts.add(m[1])
  }
}
const indexHtml = existsSync(join(FE, 'index.html')) ? read(join(FE, 'index.html')) : ''
for (const m of indexHtml.matchAll(/https?:\/\/([^/"']+)/g)) externalHosts.add(m[1])

// --- production build (dist varsa) ---------------------------------------
let buildRows = [], buildTotals = null
if (existsSync(join(DIST, 'assets'))) {
  const assets = readdirSync(join(DIST, 'assets'))
    .filter((n) => n.endsWith('.js') || n.endsWith('.css'))
  let rawJs = 0, gzJs = 0, rawCss = 0, gzCss = 0
  for (const n of assets) {
    const buf = readFileSync(join(DIST, 'assets', n))
    const gz = gzipSync(buf).length
    // Hash'li dosya adi deterministik degildir; turunu ve boyutu yaz.
    buildRows.push([n.replace(/-[A-Za-z0-9_-]{8,}\./, '-<hash>.'), buf.length, gz])
    if (n.endsWith('.js')) { rawJs += buf.length; gzJs += gz } else { rawCss += buf.length; gzCss += gz }
  }
  buildRows.sort((a, b) => b[1] - a[1])
  buildTotals = { rawJs, gzJs, rawCss, gzCss, chunks: buildRows.length }
}

const kb = (n) => (n / 1024).toFixed(1) + ' KB'

// --- rapor ----------------------------------------------------------------
const pkg = JSON.parse(read(join(FE, 'package.json')))
const head = sh('git rev-parse --short HEAD')
const lines = []
const P = (s = '') => lines.push(s)

P('# Hermes Frontend Baseline (Sprint 0)')
P()
P('> Uretici: `node scripts/frontend/measure-baseline.mjs` — tekrar')
P('> calistirilabilir; sayilar guncel HEAD uzerinden yeniden uretilir.')
P()
P(`- Olculen HEAD: \`${head}\``)
P(`- Node: \`${sh('node --version')}\` / npm: \`${sh('npm --version')}\``)
P(`- Dependencies: ${Object.keys(pkg.dependencies || {}).length} runtime, ${Object.keys(pkg.devDependencies || {}).length} dev`)
P(`- Scripts: ${Object.keys(pkg.scripts || {}).join(', ')}`)
P()
P('## Kaynak metrikleri')
P()
P(`| Metrik | Deger |`)
P(`|---|---:|`)
P(`| Toplam kaynak dosya (.js/.jsx/.ts/.tsx/.css) | ${files.length} |`)
P(`| Toplam LOC | ${totalLoc} |`)
P(`| Route sayisi (App.jsx path=) | ${routes.length} |`)
P(`| Lazy route | ${lazyCount} (0 = tum route'lar statik import) |`)
P(`| Inline style (style={{) | ${inlineStyle} |`)
P(`| !important | ${importantCount} |`)
P(`| transition: all | ${transitionAll} |`)
P(`| Benzersiz ham hex renk | ${hexColors.size} |`)
P(`| Eski dizi-bicimli invalidateQueries([...]) | ${oldInvalidation} |`)
P(`| Test dosyasi | ${testFiles.length} |`)
P(`| Dis host referansi (fonts/cdn) | ${externalRefs} adet / host'lar: ${[...externalHosts].sort().join(', ') || 'yok'} |`)
P()
P('## En buyuk 20 kaynak dosya')
P()
P('| Dosya | LOC |')
P('|---|---:|')
for (const [f, n] of top20) P(`| ${f} | ${n} |`)
P()
P('## API servis katmani')
P()
P('| Dosya | LOC |')
P('|---|---:|')
for (const [f, n] of apiFiles) P(`| ${f} | ${n} |`)
P()
P('## Production build')
P()
if (buildTotals) {
  P('| Metrik | Raw | Gzip |')
  P('|---|---:|---:|')
  P(`| JS toplam | ${kb(buildTotals.rawJs)} | ${kb(buildTotals.gzJs)} |`)
  P(`| CSS toplam | ${kb(buildTotals.rawCss)} | ${kb(buildTotals.gzCss)} |`)
  P(`| Chunk sayisi | ${buildTotals.chunks} | |`)
  P()
  P('### En buyuk 10 chunk')
  P()
  P('| Asset | Raw | Gzip |')
  P('|---|---:|---:|')
  for (const [n, raw, gz] of buildRows.slice(0, 10)) P(`| ${n} | ${kb(raw)} | ${kb(gz)} |`)
} else {
  P('NOT RUN — frontend/dist yok. Once `npx vite build` kosun, sonra bu scripti tekrar calistirin.')
}
P()
P('## Lint / test durumu (durust)')
P()
P('- `npm run lint`: script tanimli fakat ESLint CONFIG DOSYASI YOK — komut hata verir (Sprint 1 kapsaminda kurulacak).')
P(`- \`npm test\` (vitest): ${testFiles.length} test dosyasi mevcut (Developer Portal gercek-durum kilitleri).`)
P('- Kritik is akislari (Time Entry, Tasks, RBAC) icin frontend testi YOK — Sprint 1+ plani.')
P()

mkdirSync(join(ROOT, 'docs', 'frontend-premiumization'), { recursive: true })
writeFileSync(OUT, lines.join('\n') + '\n')
console.log(`baseline yazildi: ${relative(ROOT, OUT)}`)
console.log(`ozet: ${files.length} dosya, ${totalLoc} LOC, ${routes.length} route, lazy=${lazyCount}, !important=${importantCount}, hex=${hexColors.size}`)
