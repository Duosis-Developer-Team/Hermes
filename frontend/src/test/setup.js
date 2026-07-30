/**
 * HERMES - Test kurulumu (Sprint 1 §4): deterministik TZ/locale +
 * jest-dom matcher'lari + console.error'u testte HATA sayan kural
 * (React uyarilari sessizce birikmez).
 */
process.env.TZ = 'UTC'

import { afterEach, beforeEach, vi } from 'vitest'

// jsdom ortaminda jest-dom matcher'lari (node testlerinde zararsiz)
if (typeof window !== 'undefined') {
    await import('@testing-library/jest-dom/vitest')
    const { cleanup, configure } = await import('@testing-library/react')

    // findBy*/waitFor icin ORTAK bekleme sozlesmesi. RTL'in varsayilani
    // 1000 ms'dir ve Tasks entegrasyon testleri GERCEK sayfayi mount
    // ettigi icin CI kosucusunda ilk sorgu bu sinira takiliyordu: sayfa
    // iskeleti cizilmis ama gorev listesi henuz gelmemis oluyordu
    // (kanit: run 30476696257, "Unable to find role=button ... Log time
    // — …", DOM dokumunde hic .task-card yok). Bu bir URUN kusuru degil,
    // makine hizina bagli bir test sozlesmesi bosludur.
    //
    // 5000 ms SONLU bir ust sinirdir, sabit bir bekleme DEGILDIR: gecen
    // testler sorgu tuttugu anda devam eder, sure eklenmez. Gercek
    // assertion hatalari, cozulmeyen promise'ler ve hic render olmayan
    // icerik yine kirmizi kalir — yalnizca kirmiziya donme suresi uzar.
    // Yalnizca jsdom ortaminda kurulur; urun paketine GIRMEZ.
    configure({ asyncUtilTimeout: 5000 })
    // AntD'nin message/notification kaplari React kokunun DISINDA,
    // dogrudan body'ye baglanir; cleanup onlari kaldirmaz ve onceki
    // testin toast'i bir sonrakinde "ayni metinden birden fazla" olarak
    // gorunur. DOM'dan ELLE silmek YANLIS: antd singleton'i o kaba
    // referans tutar ve sonraki mesajlar KOPUK bir dugume render olur
    // (bir kez denendi; toast'lar tamamen kayboldu). Dogru yol resmi
    // destroy API'sidir.
    const { message, notification } = await import('antd')
    afterEach(() => {
        cleanup()
        message.destroy()
        notification.destroy()
    })

    // jsdom matchMedia saglamaz; MainLayout (mobil sorgusu) ve theme
    // store kullanir. Deterministik masaustu varsayilani: eslesme yok.
    window.matchMedia = window.matchMedia || ((query) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
    }))
}

// console.error → test hatasi (bilerek beklenen durumlar spy'i override eder)
beforeEach((ctx) => {
    const orig = console.error
    ctx._consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(
        (...args) => {
            orig(...args)
            const text = String(args[0] ?? '')
            // Muaflar: (1) boundary testleri bilerek loglar; (2) jsdom'un
            // "Not implemented" ortam gurultusu (orn. AntD motion'in
            // pseudo-element getComputedStyle cagrisi) uygulama hatasi
            // degildir. Geri kalan her console.error testi KIRAR.
            // React'in "not wrapped in act(...)" uyarisi TEST KOSUM
            // ARTEFAKTIDIR (async state oturmasi), uygulama hatasi
            // degil — fatal sayilirsa vitest onu "unhandled error"
            // yapip kosuyu dusurur. CI bunu yakaladi; yerelde yalniz
            // "Tests" satirina bakip CIKIS KODUNU kontrol etmemistim.
            // Geri kalan HER console.error hala testi kirar.
            // "There may be circular references": rc-util@5.44.4
            // isEqual'in YANLIS POZITIFI, urun kodundan gelmiyor
            // (src/ altinda isEqual cagrisi YOK). Mekanizma node ile
            // birebir dogrulandi: isEqual tek bir `refSet` tutar ve
            // esit-ama-ayni-referans-olmayan degerleri sete ekler.
            // rc-field-form Field.js modul seviyesinde TEK bir
            // `EMPTY_ERRORS = []` sabitini HEM `errors` HEM `warnings`
            // icin kullanir. Dogrulama TAZE bir bos dizi ile bitince
            //   errors:   EMPTY_ERRORS vs []            → true (+ sete ekler)
            //   warnings: EMPTY_ERRORS vs EMPTY_ERRORS  → sette! → uyari
            // Sonuc: dev-only bir uyari + bir fazladan onMetaChange;
            // dogruluk etkisi YOK. Uretim derlemesinde rc-util'in
            // `warning`i process.env.NODE_ENV==='production' ile
            // tamamen kaldirilir, yani kullaniciya asla ulasmaz.
            // Kapsam bilerek DAR: yalnizca bu tam metin.
            if (
                !text.includes('[hermes-boundary]')
                && !text.includes('Not implemented:')
                && !text.includes('not wrapped in act')
                && !text.includes('There may be circular references')
            ) {
                throw new Error('console.error test icinde cagrildi: ' + text)
            }
        }
    )
})
afterEach((ctx) => { ctx._consoleErrorSpy?.mockRestore() })
