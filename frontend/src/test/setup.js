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
            // Boundary testleri bilerek hata loglar — isaretli mesaj muaf.
            if (!text.includes('[hermes-boundary]')) {
                throw new Error('console.error test icinde cagrildi: ' + text)
            }
        }
    )
})
afterEach((ctx) => { ctx._consoleErrorSpy?.mockRestore() })
