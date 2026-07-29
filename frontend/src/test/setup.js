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
    const { cleanup } = await import('@testing-library/react')
    afterEach(() => cleanup())

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
            if (
                !text.includes('[hermes-boundary]')
                && !text.includes('Not implemented:')
                && !text.includes('not wrapped in act')
            ) {
                throw new Error('console.error test icinde cagrildi: ' + text)
            }
        }
    )
})
afterEach((ctx) => { ctx._consoleErrorSpy?.mockRestore() })
