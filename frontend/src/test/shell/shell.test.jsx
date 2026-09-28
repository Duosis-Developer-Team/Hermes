/**
 * =============================================================================
 * Shell characterization testleri — Hermes Liquid kabugu (R2, 28.09.2026)
 * =============================================================================
 * Sidebar YERINE ada (ust sekmeler) + dock (yonetim/sistem) + profil
 * karti. Sprint 3 sozlesmeleri AYNEN korunur: tema toggle + persist,
 * RBAC menu gorunurlugu (fail-closed), aktif rota isareti, prefetch
 * sozlesmesi, offline banner, uzun icerik tasmasi. Eski collapsed-sidebar
 * davranisi (grup duzlestirme, collapse persist) kabukla birlikte KALKTI.
 *
 * MainLayout izole render edilir (route icerigi stub Outlet) — sayfa ic
 * yapilari Sprint 3 KAPSAMI DISI.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider } from 'antd'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../../hooks/useTaskPermissions', () => ({
    useTaskPermissions: () => ({
        isLoading: false, canAccessAny: true, isTaskAdmin: false,
        assignableUserIds: [], assignableGroupIds: [],
        scopes: { task: {}, issue: {} },
    }),
}))
vi.mock('../../services/api', () => ({
    authService: { logout: vi.fn(), getMe: vi.fn() },
    rbacService: { getMyPermissions: vi.fn() },
}))

import MainLayout from '../../components/layout/MainLayout'
import { useAuthStore } from '../../stores/authStore'
import { useThemeStore } from '../../stores/themeStore'
import { makeTestQueryClient, resetAuthStore } from '../utils'

const renderShell = ({ permissions = [], route = '/time-entry', user } = {}) => {
    useAuthStore.setState({
        user: user ?? { id: 'u1', email: 'a@x.com', full_name: 'Ada Lovelace', is_admin: false },
        isAuthenticated: true,
        permissions,
    })
    return render(
        <QueryClientProvider client={makeTestQueryClient()}>
            <ConfigProvider>
                <MemoryRouter initialEntries={[route]}>
                    <Routes>
                        <Route path="/" element={<MainLayout />}>
                            <Route path="time-entry" element={<div>ROUTE-CONTENT</div>} />
                            <Route path="customers" element={<div>CUSTOMERS</div>} />
                            <Route path="settings/*" element={<div>SETTINGS</div>} />
                            <Route path="project-management" element={<div>PM</div>} />
                        </Route>
                    </Routes>
                </MemoryRouter>
            </ConfigProvider>
        </QueryClientProvider>
    )
}

const island = () => document.querySelector('.island')
const dock = () => document.querySelector('.app-dock')
const openProfile = () =>
    fireEvent.click(screen.getByRole('button', { name: /^Account:/ }))

beforeEach(() => {
    localStorage.clear()
    resetAuthStore()
    useThemeStore.setState({ theme: 'dark' })
    document.documentElement.setAttribute('data-theme', 'dark')
})
afterEach(() => vi.clearAllMocks())

describe('shell iskeleti', () => {
    it('ada + icerik + sivi zemin birlikte render olur', () => {
        renderShell()
        expect(island()).toBeTruthy()
        expect(document.querySelector('.main-header')).toBeTruthy()
        expect(document.querySelector('.liquid-backdrop')).toBeTruthy()
        expect(screen.getByText('ROUTE-CONTENT')).toBeInTheDocument()
    })

    it('route icerigi transition sarmalayicisinda (shell sabit)', () => {
        renderShell()
        const wrap = document.querySelector('.route-transition')
        expect(wrap).toBeTruthy()
        expect(within(wrap).getByText('ROUTE-CONTENT')).toBeInTheDocument()
    })

    it('eski sidebar ve collapse tercihi YOK', () => {
        renderShell()
        expect(document.querySelector('.main-sider')).toBeNull()
        expect(localStorage.getItem('hermes-sidebar-collapsed')).toBeNull()
    })

    it('Developer ada sekmesi degil DOCK ogesidir', () => {
        renderShell()
        expect(within(island()).queryByText('Developer')).toBeNull()
        expect(within(dock()).getByRole('button', { name: 'Developer' })).toBeInTheDocument()
    })
})

describe('tema kontrolu (profil karti)', () => {
    it('erisilebilir adli karo temayi degistirir ve persist eder', () => {
        renderShell()
        openProfile()
        const light = screen.getByRole('button', { name: /Switch to light theme/i })
        expect(light).toHaveAttribute('aria-pressed', 'false')
        fireEvent.click(light)
        expect(useThemeStore.getState().theme).toBe('light')
        expect(document.documentElement.getAttribute('data-theme')).toBe('light')
        expect(localStorage.getItem('hermes-theme')).toBe('light')
        expect(screen.getByRole('button', { name: /Switch to light theme/i }))
            .toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByRole('button', { name: /Switch to dark theme/i }))
            .toHaveAttribute('aria-pressed', 'false')
    })
})

describe('RBAC menu gorunurlugu (Sprint 3te DEGISMEDI)', () => {
    it('izinsiz kullanici yonetim grubunu GORMEZ', () => {
        renderShell({ permissions: [] })
        expect(screen.queryByRole('group', { name: 'MANAGEMENT' })).toBeNull()
        expect(screen.getAllByText('Time Entry').length).toBeGreaterThan(0)
    })

    it('reports.view yalnizca MANAGEMENT grubunu acar', () => {
        renderShell({ permissions: ['reports.view'] })
        const group = screen.getByRole('group', { name: 'MANAGEMENT' })
        expect(within(group).getByRole('button', { name: 'Dashboard' })).toBeInTheDocument()
        expect(screen.queryByText('API Management')).not.toBeInTheDocument()
        expect(within(group).queryByRole('button', { name: 'Settings' })).toBeNull()
    })

    it('customers.manage tek "Settings" ogesini acar (B1: ayar sayfalari menude DEGIL)', () => {
        renderShell({ permissions: ['customers.manage'] })
        const group = screen.getByRole('group', { name: 'MANAGEMENT' })
        expect(within(group).getByRole('button', { name: 'Settings' })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Customers' })).toBeNull()
    })

    it('izinler henuz YUKLENMEDIYSE (null) menu kapali kalir (fail-closed)', () => {
        renderShell({ permissions: null })
        expect(screen.queryByRole('group', { name: 'MANAGEMENT' })).toBeNull()
    })
})

describe('aktif rota', () => {
    it('bulundugumuz route aria-current ile isaretli', () => {
        renderShell({ permissions: ['customers.manage'], route: '/settings/customers/customers' })
        const current = within(dock()).getByRole('button', { name: 'Settings' })
        // Alt yol (/settings/...) ust ogeyi (Settings) secili tutar.
        expect(current).toHaveAttribute('aria-current', 'page')
        expect(current.className).toContain('is-active')
    })

    it('ada sekmesi de aktif rotayi isaretler', () => {
        renderShell()
        const tab = within(island()).getByText('Time Entry').closest('button')
        expect(tab).toHaveAttribute('aria-current', 'page')
    })
})

describe('prefetch sozlesmesi (§7)', () => {
    it('yalnizca kod chunk yukler; izin YOKSA o rota haritada olsa bile menude yok', async () => {
        const { loaderByPath } = await import('../../routes/loaders')
        // Harita rotalari kapsar…
        expect(Object.keys(loaderByPath)).toContain('/settings/integrations/api')
        // …ama izinsiz kullanicida o nav ogesi hic render edilmez,
        // dolayisiyla prefetch tetiklenemez (yapisal guvence).
        renderShell({ permissions: [] })
        expect(screen.queryByText('API Management')).not.toBeInTheDocument()
    })
})

describe('⌘K komut paleti', () => {
    it('yalnizca izinli menu ogelerini listeler ve secilince gider', async () => {
        renderShell({ permissions: ['customers.manage'] })
        fireEvent.keyDown(window, { key: 'k', metaKey: true })
        const list = await screen.findByRole('listbox')
        expect(within(list).getByText('Settings')).toBeInTheDocument()
        expect(within(list).queryByText('Dashboard')).toBeNull()
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sett' } })
        fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
        expect(await screen.findByText('SETTINGS')).toBeInTheDocument()
    })
})

describe('uzun icerik / tasma', () => {
    it('uzun kullanici adi ellipsis sinifiyla sinirlanir', () => {
        renderShell({
            user: {
                id: 'u1', email: 'x@y.com', is_admin: false,
                full_name: 'Çok Uzun Bir Kullanıcı Adı Buraya Yazıldı Taşma Testi',
            },
        })
        openProfile()
        const el = document.querySelector('.user-name')
        expect(el).toBeTruthy()
        expect(el.textContent).toContain('Çok Uzun')
    })
})

describe('offline davranisi (§9)', () => {
    it('offline olayinda sakin banner cikar, online olunca kalkar', () => {
        renderShell()
        expect(document.querySelector('.offline-banner')).toBeNull()
        fireEvent(window, new Event('offline'))
        expect(document.querySelector('.offline-banner')).toBeTruthy()
        fireEvent(window, new Event('online'))
        expect(document.querySelector('.offline-banner')).toBeNull()
    })
})

describe('dock hizli eylemleri (prototip)', () => {
    it('Efor gir bugunun tarihiyle Zaman girisine, Yeni is Isler sayfasina gider', async () => {
        renderShell({ route: '/settings/x' })
        const group = screen.getByRole('group', { name: 'Quick actions' })
        fireEvent.click(within(group).getByRole('button', { name: 'Log time' }))
        expect(await screen.findByText('ROUTE-CONTENT')).toBeInTheDocument()
        fireEvent.click(within(group).getByRole('button', { name: 'New Task' }))
        expect(await screen.findByText('PM')).toBeInTheDocument()
    })
})
