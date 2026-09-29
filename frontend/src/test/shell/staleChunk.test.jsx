/**
 * =============================================================================
 * Eski surum parcasi korumasi (deploy sonrasi acik pencere)
 * =============================================================================
 *   1. Tembel yukleme hatasi taninir; siradan hata taninmaz.
 *   2. Bir kez yenilenir; 30 sn icinde ikinci deneme YAPILMAZ (dongu yok).
 *   3. Hata sinirinda parca hatasi hata ekrani yerine "guncelleniyor" gosterir.
 * =============================================================================
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { isChunkLoadError, reloadForNewVersion, resetStaleChunkGuardForTests } from '../../utils/staleChunk'
import { AppErrorBoundary } from '../../components/common/ErrorBoundaries'

const fakeWin = () => {
    const store = {}
    return {
        sessionStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v } },
        location: { reload: vi.fn() },
    }
}

describe('stale chunk', () => {
    it('hata sinifini tanir', () => {
        expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/LoginPage-abc.js'))).toBe(true)
        expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
        expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
        expect(isChunkLoadError(null)).toBe(false)
    })

    it('bir kez yeniler, dongu yok', () => {
        resetStaleChunkGuardForTests()
        const w = fakeWin()
        expect(reloadForNewVersion(w)).toBe(true)
        // Ayni sayfa omrunde tekrar sorulursa: zaten planli.
        expect(reloadForNewVersion(w)).toBe(true)
        expect(w.location.reload).toHaveBeenCalledTimes(1)
        // Yenilemeden SONRA (yeni sayfa omru) 30 sn icinde: dongu kilidi.
        resetStaleChunkGuardForTests()
        expect(reloadForNewVersion(w)).toBe(false)
        expect(w.location.reload).toHaveBeenCalledTimes(1)
    })
})

describe('hata siniri', () => {
    const origReload = window.location
    let reload
    beforeEach(() => {
        resetStaleChunkGuardForTests()
        window.sessionStorage.clear()
        reload = vi.fn()
        Object.defineProperty(window, 'location', { configurable: true, value: { ...origReload, reload } })
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })
    afterEach(() => {
        Object.defineProperty(window, 'location', { configurable: true, value: origReload })
        vi.restoreAllMocks()
    })

    it('parca hatasinda yeniler ve guncelleniyor gosterir', () => {
        const Boom = () => { throw new TypeError('Failed to fetch dynamically imported module: /assets/x.js') }
        render(<AppErrorBoundary><Boom /></AppErrorBoundary>)
        expect(reload).toHaveBeenCalledTimes(1)
        expect(screen.getByText('Hermes was updated')).toBeInTheDocument()
    })

    it('siradan hatada yenilemez, hata ekrani', () => {
        const Boom = () => { throw new Error('boom') }
        render(<AppErrorBoundary><Boom /></AppErrorBoundary>)
        expect(reload).not.toHaveBeenCalled()
        expect(screen.getByText('Hermes ran into an unexpected error')).toBeInTheDocument()
        expect(screen.getByText('Refreshing the page usually fixes this. If it persists, contact your administrator.')).toBeInTheDocument()
    })
})
