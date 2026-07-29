# Sprint 3 — Gerçek Tarayıcı Görsel QA Sonucu

> Sprint 1 ve 2'den devreden görsel QA borcu **kapatıldı**. Ölçüm gerçek
> Chromium ile yapıldı (`scripts/qa/shell-visual-qa.mjs`), backend'e
> bağlanılmadan (tüm `/api` istekleri sahte JSON ile karşılandı).
> Playwright **ürün bağımlılığı değildir** — repo dışında ad-hoc kuruldu.

## Nasıl tekrarlanır

```bash
cd frontend && npx vite build && npx vite preview --port 4174 &
mkdir -p /tmp/hermes-qa && cd /tmp/hermes-qa
npm i -D playwright && npx playwright install chromium
QA_BASE=http://localhost:4174 QA_OUT=./shots \
  node <repo>/scripts/qa/shell-visual-qa.mjs
```

23 screenshot üretir (`$QA_OUT/`) ve her kombinasyon için makine
kontrollerini JSON olarak basar.

## Matris sonucu (son koşum, tüm düzeltmeler sonrası)

| Kombinasyon | Yatay taşma | Sidebar/içerik çakışma | Tema (canvas↔body) | Ek kontrol |
|---|---|---|---|---|
| 390×844 dark, drawer açık | yok | yok | OK | drawer açıldı, body scroll kilitli |
| 390×844 light, drawer açık | yok | yok | OK | drawer açıldı, body scroll kilitli |
| 768×1024 dark, drawer açık | yok | yok | OK | drawer açıldı, body scroll kilitli |
| 768×1024 light, drawer açık | yok | yok | OK | drawer açıldı, body scroll kilitli |
| 1440×900 dark, expanded+collapsed+focus | yok | yok | OK | collapsed=72px, focus halkası görünür |
| 1440×900 dark **reduced-motion** | yok | yok | OK | collapsed=72px, focus görünür |
| 1440×900 light | yok | yok | OK | collapsed=72px, focus görünür |
| 1920×1080 dark | yok | yok | OK | collapsed=72px, focus görünür |
| 1920×1080 light | yok | yok | OK | collapsed=72px, focus görünür |

Her kombinasyonda aktif rota doğru işaretlendi (`Time Entry`), header ve
sidebar `z-index: 100` (merkezi `--h-z-shell`), uzun kullanıcı adı
ellipsis'le kesildi (taşma yok).

## QA'nın YAKALADIĞI kusurlar (birim testler göremezdi)

1. **Header, sidebar logosunu örtüyordu.** Header'ın `z-index`'i shell
   katmanına bağlanınca sider ile eşitlendi; DOM sırası gereği header
   üste çizildi ve logo görünmez oldu. → Header artık sidebar'ı örtmüyor,
   yanında başlıyor (`margin-left: var(--h-sidebar-width)`, collapsed
   varyantıyla birlikte).
2. **Tema drift'i (önceden var olan):** app canvas `#1D2125`, shell
   yüzeyleri `#111720` idi — sayfa arka planı sidebar'dan **açıktı**,
   derinlik hiyerarşisi ters. → `--bg-primary` alias'ı `--h-bg-canvas`'a
   köprülendi (silinmedi); 9/9 kombinasyonda drift 0.
3. **Collapsed genişlik uyuşmazlığı:** sider 72px'e indirildi ama içerik
   boşluğu 80px'te kalmıştı (8px açık). → İki taraf da aynı token'dan.
4. **`min-height` eski 56px header varsayımına dayalıydı** → token.
5. **Collapsed'da grup başlıkları "MA…"/"CO…" diye kırpılıyordu** → ikon
   ritmini bozmayan ince ayırıcı çizgi.

## Bilinen ortam artefaktı

Her koşumda **1 console error**: `GET /env-config.js 404`. Bu dosya
`index.html`'de referanslı ve container başlangıcında üretiliyor; ham
`vite preview` dist'inde yok. Uygulama hatası değildir — gerçek
deployment'ta üretilir. Yine de raporda gizlenmedi.

## Kapsanmayan

- Ekran okuyucu ile gerçek sesli okuma testi (araç yok).
- Gerçek dokunmatik cihaz jest testleri (emülasyon kullanıldı).
- Backend'li uçtan uca akışlar (QA harness'i API'yi mock'lar) — bunlar
  toplu push sonrası hermes-dev'de doğrulanacak.
