/**
 * =============================================================================
 * Sprint 3 — Shell characterization testleri
 * =============================================================================
 * Kapsam: sidebar collapse + persist, tema toggle + persist, mobil
 * drawer davranisi, RBAC menu gorunurlugu, aktif rota isareti, prefetch
 * sozlesmesi, offline banner, uzun icerik tasmasi.
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
                        </Route>
                    </Routes>
                </MemoryRouter>
            </ConfigProvider>
        </QueryClientProvider>
    )
}

const sider = () => document.querySelector('.main-sider')

beforeEach(() => {
    localStorage.clear()
    resetAuthStore()
    useThemeStore.setState({ theme: 'dark' })
    document.documentElement.setAttribute('data-theme', 'dark')
})
afterEach(() => vi.clearAllMocks())

describe('shell iskeleti', () => {
    it('sidebar + header + route icerigi birlikte render olur', () => {
        renderShell()
        expect(sider()).toBeTruthy()
        expect(document.querySelector('.main-header')).toBeTruthy()
        expect(screen.getByText('ROUTE-CONTENT')).toBeInTheDocument()
    })

    it('route icerigi transition sarmalayicisinda (shell sabit)', () => {
        renderShell()
        const wrap = document.querySelector('.route-transition')
        expect(wrap).toBeTruthy()
        expect(within(wrap).getByText('ROUTE-CONTENT')).toBeInTheDocument()
    })
})

describe('sidebar collapse + persist', () => {
    it('toggle collapsed sinifini uygular ve tercihi persist eder', () => {
        renderShell()
        expect(sider().className).not.toContain('ant-layout-sider-collapsed')

        fireEvent.click(screen.getByRole('button', { name: /Toggle navigation/i }))
        expect(sider().className).toContain('ant-layout-sider-collapsed')
        expect(localStorage.getItem('hermes-sidebar-collapsed')).toBe('1')

        fireEvent.click(screen.getByRole('button', { name: /Toggle navigation/i }))
        expect(localStorage.getItem('hermes-sidebar-collapsed')).toBe('0')
    })

    it('kayitli collapsed tercihi mount aninda geri yuklenir', () => {
        localStorage.setItem('hermes-sidebar-collapsed', '1')
        renderShell()
        expect(sider().className).toContain('ant-layout-sider-collapsed')
    })

    it('collapsed durumda logo ikonu DOM da kalir (crossfade, distortion yok)', () => {
        localStorage.setItem('hermes-sidebar-collapsed', '1')
        renderShell()
        expect(document.querySelector('.sidebar-logo--icon')).toBeTruthy()
        expect(document.querySelector('.sidebar-logo--full')).toBeTruthy()
    })
})

describe('tema kontrolu', () => {
    it('erisilebilir adli buton temayi degistirir ve persist eder', () => {
        renderShell()
        const btn = screen.getByRole('button', { name: /Switch to light theme/i })
        fireEvent.click(btn)
        expect(useThemeStore.getState().theme).toBe('light')
        expect(document.documentElement.getAttribute('data-theme')).toBe('light')
        expect(localStorage.getItem('hermes-theme')).toBe('light')
        // Etiket yeni duruma gore degisir (yon anlamini korur)
        expect(screen.getByRole('button', { name: /Switch to dark theme/i })).toBeInTheDocument()
    })
})

describe('RBAC menu gorunurlugu (Sprint 3te DEGISMEDI)', () => {
    it('izinsiz kullanici yonetim gruplarini GORMEZ', () => {
        renderShell({ permissions: [] })
        expect(screen.queryByText('MANAGEMENT')).not.toBeInTheDocument()
        expect(screen.queryByText('CONFIGURATION')).not.toBeInTheDocument()
        expect(screen.getAllByText('Time Entry').length).toBeGreaterThan(0)
    })

    it('reports.view yalnizca MANAGEMENT grubunu acar', () => {
        renderShell({ permissions: ['reports.view'] })
        expect(screen.getByText('MANAGEMENT')).toBeInTheDocument()
        expect(screen.queryByText('CONFIGURATION')).not.toBeInTheDocument()
        expect(screen.getAllByText('Dashboard').length).toBeGreaterThan(0)
        expect(screen.queryByText('API Management')).not.toBeInTheDocument()
    })

    it('customers.manage CONFIGURATION grubunu acar', () => {
        renderShell({ permissions: ['customers.manage'] })
        expect(screen.getByText('CONFIGURATION')).toBeInTheDocument()
        expect(screen.getAllByText('Customers').length).toBeGreaterThan(0)
    })

    it('izinler henuz YUKLENMEDIYSE (null) menu kapali kalir (fail-closed)', () => {
        renderShell({ permissions: null })
        expect(screen.queryByText('MANAGEMENT')).not.toBeInTheDocument()
    })
})

describe('aktif rota', () => {
    it('bulundugumuz route menude secili', () => {
        renderShell({ permissions: ['customers.manage'], route: '/customers' })
        const selected = document.querySelector('.ant-menu-item-selected')
        expect(selected).toBeTruthy()
        expect(selected.textContent).toContain('Customers')
    })
})

describe('prefetch sozlesmesi (§7)', () => {
    it('yalnizca kod chunk yukler; izin YOKSA o rota haritada olsa bile menude yok', async () => {
        const { loaderByPath } = await import('../../routes/loaders')
        // Harita rotalari kapsar…
        expect(Object.keys(loaderByPath)).toContain('/api-management')
        // …ama izinsiz kullanicida o nav ogesi hic render edilmez,
        // dolayisiyla prefetch tetiklenemez (yapisal guvence).
        renderShell({ permissions: [] })
        expect(screen.queryByText('API Management')).not.toBeInTheDocument()
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
