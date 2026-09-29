/**
 * Developer Portal — render kilidi (29.09 iki dilli yeniden tasarim).
 *
 * Kaynak-metin taramalari (portalFacts / portalReality) GERCEKLIGI
 * kilitler; bu dosya kullanicinin GORDUGUNU kilitler:
 *   - sayfa iki dilde de acilir, dil degisince icerik de degisir;
 *   - "API anahtari al" yalnizca api.manage izninde API Yonetimi'ne gider,
 *     digerlerine kimden isteyecegi soylenir;
 *   - her bolum eksik sozluk anahtari OLMADAN cizilir;
 *   - ekranda gercek token bicimi yoktur (yalnizca yer tutucu).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router-dom'

import { renderWithProviders, resetAuthStore } from '../utils'
import { useAuthStore } from '../../stores/authStore'
import { useLocaleStore } from '../../stores/localeStore'
import en from '../../i18n/en'
import tr from '../../i18n/tr'

const CAPABILITIES = {
    api_version: 'v1',
    scopes: { 'tasks:read': 'Read tasks', 'tasks:write': 'Create and update tasks' },
    errors: [
        { code: 'invalid_token', status: 401, description: 'Token invalid.' },
        { code: 'resource_not_found', status: 404, description: 'Not found.' },
    ],
    pagination: { default_limit: 25, max_limit: 100 },
}

vi.mock('../../services/api', () => ({
    apiManagementService: {
        getPublicCapabilities: vi.fn(() => Promise.resolve(CAPABILITIES)),
        getPublicOpenApiInfo: vi.fn(() => Promise.resolve({ version: '1.2.0' })),
        getPublicHealth: vi.fn(() => Promise.resolve({ status: 'ok' })),
    },
}))

// Import mock'tan SONRA (vi.mock hoist edilir, yine de okunur kalsin).
const { default: DeveloperPortalPage } = await import('../../pages/developer/DeveloperPortalPage')

function Where() {
    const loc = useLocation()
    return <span data-testid="where">{loc.pathname}{loc.hash}</span>
}

function renderPortal(route = '/developer') {
    return renderWithProviders(
        <Routes>
            <Route path="/developer" element={<><DeveloperPortalPage /><Where /></>} />
            <Route path="*" element={<Where />} />
        </Routes>,
        { route },
    )
}

const SECTION_KEYS = [
    'overview', 'getting-started', 'mcp', 'api-reference', 'authentication',
    'scopes', 'code-examples', 'pagination', 'idempotency', 'errors',
    'rate-limits', 'compatibility', 'changelog', 'limitations',
]

describe('Developer Portal sayfasi', () => {
    beforeEach(() => {
        resetAuthStore()
        useLocaleStore.getState().setLocale('en')
    })
    afterEach(() => {
        useLocaleStore.getState().setLocale('en')
    })

    it('Ingilizce karsilama: baslik, uc eylem, canli surum rozeti', async () => {
        renderPortal()
        expect(screen.getByRole('heading', { level: 1, name: en.devPortal.hero.title })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Make your first request/ })).toBeInTheDocument()
        expect(screen.getAllByRole('button', { name: /Connect with MCP/ }).length).toBeGreaterThan(0)
        expect(await screen.findByText('OpenAPI 1.2.0')).toBeInTheDocument()
        // Ne yapabilirsin kartlari
        expect(screen.getByText(en.devPortal.overview.uc.reports.title)).toBeInTheDocument()
        expect(screen.getByText(en.devPortal.overview.uc.ai.title)).toBeInTheDocument()
    })

    it('Turkce secilince icerik Turkce olur (menu degil sayfa)', () => {
        useLocaleStore.getState().setLocale('tr')
        renderPortal()
        expect(screen.getByRole('heading', { level: 1, name: tr.devPortal.hero.title })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /İlk isteğini at \(5 dk\)/ })).toBeInTheDocument()
        expect(screen.getAllByRole('button', { name: /MCP ile bağlan/ }).length).toBeGreaterThan(0)
        expect(screen.getByText(tr.devPortal.overview.title)).toBeInTheDocument()
        expect(screen.queryByText(en.devPortal.hero.title)).toBeNull()
    })

    it('api.manage izni olan "API anahtari al" ile API Yonetimi ne gider', () => {
        useAuthStore.setState({ permissions: ['api.manage'] })
        renderPortal()
        fireEvent.click(screen.getByRole('button', { name: /Get an API key/ }))
        expect(screen.getByTestId('where').textContent).toBe('/settings/integrations/api')
    })

    it('izni olmayan API Yonetimi ne yonlenmez; kimden isteyecegi soylenir', () => {
        useAuthStore.setState({ permissions: [] })
        renderPortal()
        expect(screen.queryByRole('button', { name: /Get an API key/ })).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: /How to get an API key/ }))
        expect(screen.getByTestId('where').textContent).toBe('/developer#getting-started')
        expect(screen.getByText(en.devPortal.start.s1.askTitle)).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Open API Management/ })).toBeNull()
    })

    it('eski baglantilar birlestirilen bolume acilir', () => {
        renderPortal('/developer#api-explorer')
        expect(screen.getByRole('heading', { level: 2, name: en.devPortal.ref.title })).toBeInTheDocument()
    })

    it('menu aramasi bolumleri suzer (iki dilde de)', () => {
        useLocaleStore.getState().setLocale('tr')
        renderPortal()
        fireEvent.change(screen.getByLabelText(tr.devPortal.nav.searchAria), { target: { value: 'hata' } })
        const nav = screen.getByRole('navigation', { name: tr.devPortal.nav.aria })
        expect(nav.textContent).toContain(tr.devPortal.nav.errors)
        expect(nav.textContent).not.toContain(tr.devPortal.nav.changelog)
    })

    it.each(['en', 'tr'])('her bolum eksik sozluk anahtari olmadan cizilir (%s)', async (locale) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        useLocaleStore.getState().setLocale(locale)
        for (const key of SECTION_KEYS) {
            const { unmount } = renderPortal(`/developer#${key}`)
            // Canli katalogla cizilen bolumler veri gelince yeniden cizilir.
            await screen.findAllByText('OpenAPI 1.2.0')
            await waitFor(() => expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0))
            const body = document.body.textContent
            // Ham anahtar ekrana dusmez.
            expect(body, key).not.toMatch(/devPortal\.[a-zA-Z]/)
            // Gercek token bicimi yok: yalnizca x'lerden olusan yer tutucu.
            for (const m of body.matchAll(/hms_(?:dev|live)_([A-Za-z0-9]{8,})/g)) {
                expect(m[1], key).toMatch(/^x+$/)
            }
            unmount()
        }
        const missing = warn.mock.calls.filter((c) => String(c[0]).includes('[i18n]'))
        expect(missing).toEqual([])
        warn.mockRestore()
    })
})
