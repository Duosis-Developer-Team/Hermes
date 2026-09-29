/**
 * =============================================================================
 * Landing (oturumsuz ana sayfa) + indirmeler + cerez bildirimi
 * =============================================================================
 *   1. Manifest yalniz duz .dmg/.exe dosya adi kabul eder (yol/protokol yok).
 *   2. Platform algilama: Windows, Intel Mac (ipucu), varsayilan Apple Silicon.
 *   3. PublicHome: tam `/` → landing; `?workspace=`, baska yol ve masaustu
 *      → giris ekrani (tenant baglantilari bozulmaz).
 *   4. Indirme kartlari manifest'ten; olmayan platform "Coming soon",
 *      indirme linki /downloads/<dosya>.
 *   5. Cerez bildirimi "Anladim" sonrasi bir daha gorunmez.
 * =============================================================================
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router-dom'

import { detectPlatform, normalizeManifest, sizeInMb } from '../../features/landing/downloads'
import { renderWithProviders } from '../utils'

const { PublicHome } = await import('../../App')
const LandingPage = (await import('../../pages/landing/LandingPage')).default
const { CookieNotice, COOKIE_NOTICE_KEY } = await import('../../pages/landing/LandingChrome')

function Where() {
    const loc = useLocation()
    return <span data-testid="where">{loc.pathname}{loc.search}</span>
}

const MANIFEST = {
    version: '0.1.0',
    files: {
        'mac-arm64': { file: 'Hermes-0.1.0-arm64.dmg', size: 127632646 },
        'win-x64': { file: '../../etc/passwd.exe', size: 1 },
    },
}

beforeEach(() => {
    try { window.localStorage.clear() } catch { /* yok */ }
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => MANIFEST }))
})
afterEach(() => { delete window.hermesDesktop })

describe('indirme modeli', () => {
    it('manifest yalniz duz dosya adini kabul eder', () => {
        const m = normalizeManifest(MANIFEST)
        expect(m.version).toBe('0.1.0')
        expect(m.files['mac-arm64'].href).toBe('/downloads/Hermes-0.1.0-arm64.dmg')
        expect(m.files['win-x64']).toBeUndefined()
        expect(normalizeManifest(null).files).toEqual({})
        expect(normalizeManifest({ files: { 'mac-x64': { file: 'https://x.test/a.dmg' } } }).files).toEqual({})
        expect(sizeInMb(127632646)).toBe('122')
        expect(sizeInMb(null)).toBeNull()
    })

    it('platform algilama', async () => {
        expect(await detectPlatform({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32' })).toBe('win-x64')
        expect(await detectPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel' })).toBe('mac-arm64')
        expect(await detectPlatform({
            userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel',
            userAgentData: { platform: 'macOS', getHighEntropyValues: async () => ({ architecture: 'x86' }) },
        })).toBe('mac-x64')
        expect(await detectPlatform({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', platform: 'iPhone' })).toBeNull()
        expect(await detectPlatform({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', platform: 'Linux x86_64' })).toBeNull()
    })
})

describe('PublicHome', () => {
    const renderAt = (route) => renderWithProviders(
        <Routes>
            <Route path="/" element={<PublicHome />}>
                <Route path="time-entry" element={<span />} />
            </Route>
            <Route path="/login" element={<Where />} />
        </Routes>,
        { route },
    )

    it('tam / → landing', async () => {
        renderAt('/')
        expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
        expect(screen.getAllByRole('link', { name: 'Try Hermes' })[0]).toHaveAttribute('href', '/login')
    })

    it('?workspace= ve korumali yol giris ekranina gider', async () => {
        renderAt('/?workspace=techart')
        expect(await screen.findByTestId('where')).toHaveTextContent('/login?workspace=techart')
    })

    it('korumali yol giris ekranina gider', async () => {
        renderAt('/time-entry')
        expect(await screen.findByTestId('where')).toHaveTextContent('/login')
    })

    it('masaustu uygulamasinda landing yok', async () => {
        window.hermesDesktop = { getServers: () => null }
        renderAt('/')
        expect(await screen.findByTestId('where')).toHaveTextContent('/login')
    })
})

describe('Landing indirme kartlari', () => {
    it('manifest dosyalari indirilebilir, olmayanlar Yakinda', async () => {
        renderWithProviders(<LandingPage />)
        const arm = document.querySelector('[data-platform="mac-arm64"]')
        const link = await within(arm).findByRole('link', { name: /Download/ })
        expect(link).toHaveAttribute('href', '/downloads/Hermes-0.1.0-arm64.dmg')
        expect(within(arm).getByText(/Version 0.1.0/)).toBeInTheDocument()
        await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith('/downloads/manifest.json', { cache: 'no-cache' }))
        // Gecersiz ad (yol) reddedildi → Windows "Coming soon".
        const win = document.querySelector('[data-platform="win-x64"]')
        expect(within(win).getByText('Coming soon')).toBeInTheDocument()
        expect(within(win).queryByRole('link')).toBeNull()
        expect(within(document.querySelector('[data-platform="web"]')).getByRole('link')).toHaveAttribute('href', '/login')
    })
})

describe('Cerez bildirimi', () => {
    it('Anladim sonrasi gizlenir ve hatirlanir', () => {
        const { unmount } = renderWithProviders(<CookieNotice />)
        expect(screen.getByRole('region', { name: 'Cookie notice' })).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Cookie policy' })).toHaveAttribute('href', '/cerez-politikasi')
        fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
        expect(screen.queryByRole('region', { name: 'Cookie notice' })).toBeNull()
        expect(window.localStorage.getItem(COOKIE_NOTICE_KEY)).toBe('seen')
        unmount()
        renderWithProviders(<CookieNotice />)
        expect(screen.queryByRole('region', { name: 'Cookie notice' })).toBeNull()
    })
})
