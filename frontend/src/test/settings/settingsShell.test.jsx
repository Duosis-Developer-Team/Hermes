/**
 * =============================================================================
 * PM rework P0 / B1 — ayarlar tek cati
 * =============================================================================
 * Kilitlenen sozlesmeler (05 B1 kabul olcutu):
 *   1. Bolum ve sayfa katalogu izne gore suzulur; izni olmayan bolum YOK.
 *   2. /settings ilk gorunur sayfaya gider; hicbiri yoksa ana ekrana;
 *      izinler yuklenmemisken (null) yonlendirme YAPMAZ.
 *   3. Kabuk yalnizca gorunur bolumleri cizer; secili sayfa Outlet'te.
 *   4. Eski adreslerin her biri yeni bir /settings yoluna eslenir ve o yol
 *      katalogda VARDIR (kopuk yonlendirme olamaz).
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import {
    LEGACY_SETTINGS_PATHS, SETTINGS_SECTIONS, firstSettingsPath,
    hasAnySettings, visibleSections,
} from '../../features/settings/sections'
import SettingsPage, { SettingsIndex } from '../../pages/settings/SettingsPage'
import { useAuthStore } from '../../stores/authStore'

const canWith = (perms) => (...wanted) => wanted.some((p) => perms.includes(p))

const signIn = (permissions) => useAuthStore.setState({
    user: { id: 'u1', email: 'a@x.com', full_name: 'Ada', is_admin: false },
    isAuthenticated: true, permissions,
})

describe('katalog', () => {
    it('izinsiz kullanici hicbir bolum gormez', () => {
        expect(visibleSections(canWith([]))).toEqual([])
        expect(firstSettingsPath(canWith([]))).toBeNull()
        expect(hasAnySettings(canWith([]))).toBe(false)
    })

    it('yalniz izinli bolum ve sayfalar kalir', () => {
        const sections = visibleSections(canWith(['reference.manage', 'projects.manage']))
        expect(sections.map((s) => s.key)).toEqual(['reference', 'customers'])
        expect(sections[1].items.map((i) => i.key)).toEqual(['projects'])   // customers.manage yok
        expect(firstSettingsPath(canWith(['projects.manage']))).toBe('/settings/customers/projects')
    })

    it('dizi izin: herhangi biri yeter (ticket entegrasyonu)', () => {
        expect(firstSettingsPath(canWith(['tickets.admin']))).toBe('/settings/integrations/tickets')
    })

    it('her eski adres katalogdaki GERCEK bir yola gider', () => {
        const paths = new Set(SETTINGS_SECTIONS.flatMap((s) => s.items.map((i) => i.path)))
        for (const [from, to] of Object.entries(LEGACY_SETTINGS_PATHS)) {
            expect(from.startsWith('/')).toBe(true)
            expect(paths.has(to), `${from} → ${to}`).toBe(true)
        }
    })
})

describe('kabuk', () => {
    beforeEach(() => useAuthStore.setState({ user: null, isAuthenticated: false, permissions: null }))

    const renderAt = (route, permissions) => {
        signIn(permissions)
        return render(
            <MemoryRouter initialEntries={[route]}>
                <Routes>
                    <Route path="/settings" element={<SettingsPage />}>
                        <Route index element={<SettingsIndex />} />
                        <Route path="organization/users" element={<div>USERS-PAGE</div>} />
                        <Route path="customers/projects" element={<div>PROJECTS-PAGE</div>} />
                    </Route>
                    <Route path="/time-entry" element={<div>HOME</div>} />
                </Routes>
            </MemoryRouter>,
        )
    }

    it('yalnizca izinli bolumleri cizer ve secili sayfayi Outlet ile gosterir', () => {
        renderAt('/settings/organization/users', ['users.manage'])
        expect(screen.getByText('Organization')).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Users' })).toHaveClass('active')
        expect(screen.getByRole('link', { name: 'Capacity' })).toBeInTheDocument()
        expect(screen.queryByText('Reference data')).toBeNull()
        expect(screen.queryByText('Integrations')).toBeNull()
        expect(screen.getByText('USERS-PAGE')).toBeInTheDocument()
    })

    it('/settings ilk gorunur sayfaya gider', () => {
        renderAt('/settings', ['projects.manage'])
        expect(screen.getByText('PROJECTS-PAGE')).toBeInTheDocument()
    })

    it('hicbir ayar izni yoksa ana ekrana doner', () => {
        renderAt('/settings', [])
        expect(screen.getByText('HOME')).toBeInTheDocument()
    })

    it('izinler yuklenmemisken (null) yonlendirmez — bekler', () => {
        renderAt('/settings', null)
        expect(screen.queryByText('HOME')).toBeNull()
        expect(screen.queryByText('PROJECTS-PAGE')).toBeNull()
    })
})
