/**
 * Surum notlari (CTO 05.10):
 *   1. Tek kaynak: APP_VERSION = listenin ilk kaydi; surumler gecerli
 *      bicimde (1.0, 1.2.5), tekil ve YENIDEN ESKIYE sirali.
 *   2. Her surumun her metni IKI sozlukte de var (ham anahtar gorunmez).
 *   3. Kabuktaki rozet "Hermes v1.0" der ve /patch-notes'a gider.
 *   4. Sayfa: surum basligi, one cikanlar ve tum degisiklikler; oturumsuz
 *      (standalone) baglamda da acilir.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { screen, within } from '@testing-library/react'

import {
    APP_VERSION, CHANGE_KINDS, RELEASES, changeCounts, compareVersions, formatVersion,
    isValidVersion, versionAnchor,
} from '../../features/releases/releases'
import { dictionaries } from '../../i18n'
import VersionBadge from '../../components/layout/VersionBadge'
import PatchNotesPage from '../../pages/PatchNotesPage'
import { LandingFooter } from '../../pages/landing/LandingChrome'
import { renderWithProviders } from '../utils'

const lookup = (dict, key) => key.split('.').reduce((n, p) => (n == null ? n : n[p]), dict)

describe('surum modeli', () => {
    it('APP_VERSION ilk kayittir ve bicim gecerlidir', () => {
        expect(APP_VERSION).toBe(RELEASES[0].version)
        expect(formatVersion(APP_VERSION)).toMatch(/^v\d+\.\d+(\.\d+)?$/)
        for (const r of RELEASES) {
            expect(isValidVersion(r.version)).toBe(true)
            expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        }
    })

    it('surumler tekil ve yeniden eskiye sirali', () => {
        const versions = RELEASES.map((r) => r.version)
        expect(new Set(versions).size).toBe(versions.length)
        for (let i = 1; i < versions.length; i += 1) {
            expect(compareVersions(versions[i - 1], versions[i])).toBeGreaterThan(0)
        }
    })

    it('surum karsilastirma ve capa', () => {
        expect(compareVersions('1.10', '1.9')).toBeGreaterThan(0)
        expect(compareVersions('1.2.5', '1.2')).toBeGreaterThan(0)
        expect(compareVersions('2.0', '1.9.9')).toBeGreaterThan(0)
        expect(compareVersions('1.0', '1.0.0')).toBe(0)
        expect(isValidVersion('v1.0')).toBe(false)
        expect(versionAnchor('1.2.5')).toBe('v1-2-5')
    })

    it('her metin iki sozlukte de var', () => {
        const missing = []
        for (const r of RELEASES) {
            const keys = [`releases.${r.key}.title`, `releases.${r.key}.summary`]
            for (const h of r.highlights || []) keys.push(`releases.${r.key}.h.${h.id}.title`, `releases.${r.key}.h.${h.id}.body`)
            for (const kind of CHANGE_KINDS) {
                for (const id of r.changes?.[kind] || []) keys.push(`releases.${r.key}.${kind}.${id}`)
            }
            for (const [loc, dict] of Object.entries(dictionaries)) {
                for (const k of keys) if (typeof lookup(dict, k) !== 'string') missing.push(`${loc}:${k}`)
            }
        }
        expect(missing).toEqual([])
    })
})

describe('surum rozeti', () => {
    it('"Hermes v1.0" der ve surum notlarina gider', () => {
        renderWithProviders(<VersionBadge />)
        const link = screen.getByRole('link', { name: new RegExp(formatVersion(APP_VERSION).replace('.', '\\.')) })
        expect(link).toHaveAttribute('href', '/patch-notes')
        expect(link).toHaveTextContent(`Hermes ${formatVersion(APP_VERSION)}`)
    })
})

describe('surum notlari sayfasi', () => {
    it.each([false, true])('standalone=%s: baslik, one cikanlar ve tum degisiklikler', (standalone) => {
        renderWithProviders(<PatchNotesPage standalone={standalone} />, { route: '/patch-notes' })
        const latest = RELEASES[0]
        const article = document.getElementById(versionAnchor(latest.version))
        expect(within(article).getByRole('heading', { level: 1 })).toHaveTextContent(`Hermes ${formatVersion(latest.version)}`)
        expect(within(article).getAllByRole('heading', { level: 3 }).length)
            .toBe(latest.highlights.length + CHANGE_KINDS.filter((k) => latest.changes[k]?.length).length)
        const counts = changeCounts(latest)
        const total = CHANGE_KINDS.reduce((n, k) => n + counts[k], 0)
        // Degisiklik satirlari (ozet hapciklari haric) eksiksiz.
        expect(article.querySelectorAll('.pn-group li')).toHaveLength(total)
        // Ham i18n anahtari ekrana sizmaz.
        expect(article.textContent).not.toMatch(/releases\.|patchNotes\./)
    })
})

describe('landing alt bilgisi', () => {
    it('surum notlarina baglanti verir', () => {
        renderWithProviders(<LandingFooter onCookiePrefs={() => {}} />)
        expect(screen.getByRole('link', { name: 'Patch notes' })).toHaveAttribute('href', '/patch-notes')
    })
})

describe('masaustu uygulamasi', () => {
    it('rozet kosesi pencere surukleme alani DEGIL (tiklama calisir)', () => {
        // Kabuk .main-header'i surukleme alani yapar; kose adanin disinda.
        const css = readFileSync(join('src', 'components/layout/MainLayout.css'), 'utf8')
        expect(css).toMatch(/\.main-header__corner,\s*\.main-header__corner \*\s*\{\s*-webkit-app-region:\s*no-drag;/)
        const shell = readFileSync(join('..', 'desktop/src/windowChrome.js'), 'utf8')
        expect(shell).toMatch(/\.main-header \{ -webkit-app-region: drag; \}/)
    })
})
