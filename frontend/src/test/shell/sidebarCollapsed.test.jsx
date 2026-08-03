/**
 * =============================================================================
 * Sprint 8 §A — Collapsed sidebar davranislari (GERCEK mount)
 * =============================================================================
 * KAPATILAN KUSURLAR:
 *   1. AntD Menu `type: 'group'` basliklarini collapsed modda da cizer —
 *      72px'lik kolonda "MANAGEMENT/CONFIGURATION" metinleri kirpilmis
 *      gri bloklar olarak gorunuyordu. Cozum CSS gizleme DEGIL: collapsed
 *      sider icin gruplar DOM seviyesinde duzlestirilir (divider +
 *      cocuklar), expanded ve mobil drawer gruplu kalir.
 *   2. Duzlestirme RBAC gorunurlugunu DEGISTIRMEMELI: izinsiz kullanicida
 *      grup da divider da olmamali (bosluk artigi birakmamali).
 *
 * Harness shell.test.jsx ile ayni: MainLayout izole, rota icerigi stub.
 * =============================================================================
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider } from 'antd'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../../hooks/useTaskPermissions', () => ({
    useTaskPermissions: () => ({
        isLoading: false, canAccessAny: true, isTaskAdmin: false,
        assignableUserIds: [], assignableGroupIds: [], scopes: { task: {}, issue: {} },
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

const ADMIN_PERMS = ['reports.view', 'customers.manage']

const renderShell = ({ permissions = [], collapsed = false } = {}) => {
    if (collapsed) localStorage.setItem('hermes-sidebar-collapsed', '1')
    useAuthStore.setState({
        user: { id: 'u1', email: 'a@x.com', full_name: 'Ada', is_admin: false },
        isAuthenticated: true,
        permissions,
    })
    return render(
        <QueryClientProvider client={makeTestQueryClient()}>
            <ConfigProvider>
                <MemoryRouter initialEntries={['/time-entry']}>
                    <Routes>
                        <Route path="/" element={<MainLayout />}>
                            <Route path="time-entry" element={<div>ROUTE-CONTENT</div>} />
                        </Route>
                    </Routes>
                </MemoryRouter>
            </ConfigProvider>
        </QueryClientProvider>
    )
}

const sider = () => document.querySelector('.main-sider')
const groupTitles = () => sider().querySelectorAll('.ant-menu-item-group-title')
const dividers = () => sider().querySelectorAll('.ant-menu-item-divider')
const menuItems = () => sider().querySelectorAll('li.ant-menu-item')

beforeEach(() => {
    localStorage.clear()
    resetAuthStore()
    useThemeStore.setState({ theme: 'dark' })
})
afterEach(() => vi.clearAllMocks())

describe('collapsed sider grup basliklari', () => {
    it('expanded: yonetim gruplarinin basliklari GORUNUR', () => {
        renderShell({ permissions: ADMIN_PERMS })
        expect(groupTitles().length).toBeGreaterThanOrEqual(2)
        expect(screen.getByText('MANAGEMENT')).toBeInTheDocument()
        expect(screen.getByText('CONFIGURATION')).toBeInTheDocument()
    })

    it('collapsed: grup basligi DOM da HIC yok (gizlenmis degil, cizilmemis)', () => {
        renderShell({ permissions: ADMIN_PERMS, collapsed: true })
        expect(sider().className).toContain('ant-layout-sider-collapsed')
        expect(groupTitles().length).toBe(0)
    })

    it('collapsed: grup COCUKLARI kaybolmaz (madde sayisi expanded ile ayni)', () => {
        const first = renderShell({ permissions: ADMIN_PERMS })
        const expandedCount = menuItems().length
        expect(expandedCount).toBeGreaterThan(0)
        first.unmount()
        localStorage.clear()

        renderShell({ permissions: ADMIN_PERMS, collapsed: true })
        expect(menuItems().length).toBe(expandedCount)
    })

    it('collapsed: gruplarin yerinde ayirici (divider) var — hiyerarsi ipucu korunur', () => {
        renderShell({ permissions: ADMIN_PERMS, collapsed: true })
        expect(dividers().length).toBeGreaterThanOrEqual(2)
    })

    it('collapsed: ART ARDA divider yok (menu zaten gruplardan once bir tane koyar)', () => {
        // Duzlestirme, mevcut divider'in hemen ardina ikinci bir divider
        // eklerse cift cizgi olusur — final denetimde yakalanan kusur.
        renderShell({ permissions: ADMIN_PERMS, collapsed: true })
        for (const d of dividers()) {
            const next = d.nextElementSibling
            expect(next?.classList?.contains('ant-menu-item-divider') ?? false).toBe(false)
        }
    })

    it('toggle ile basliklar kaybolur ve GERI GELIR (kalici DOM hasari yok)', () => {
        renderShell({ permissions: ADMIN_PERMS })
        expect(groupTitles().length).toBeGreaterThanOrEqual(2)

        fireEvent.click(screen.getByRole('button', { name: /Toggle navigation/i }))
        expect(groupTitles().length).toBe(0)

        fireEvent.click(screen.getByRole('button', { name: /Toggle navigation/i }))
        expect(groupTitles().length).toBeGreaterThanOrEqual(2)
    })
})

describe('RBAC + collapsed etkilesimi', () => {
    it('izinsiz kullanici collapsed modda divider ARTIGI gormez', () => {
        renderShell({ permissions: [], collapsed: true })
        expect(groupTitles().length).toBe(0)
        expect(dividers().length).toBe(0)
    })

    it('izinler yuklenmemisken (null) de artik yok (fail-closed korunur)', () => {
        renderShell({ permissions: null, collapsed: true })
        expect(groupTitles().length).toBe(0)
        expect(dividers().length).toBe(0)
    })
})

describe('collapsed logo', () => {
    it('ikon logo collapsed durumda DOM da (crossfade cifti korunur)', () => {
        renderShell({ collapsed: true })
        expect(document.querySelector('.sidebar-logo--icon')).toBeTruthy()
        expect(document.querySelector('.sidebar-logo--full')).toBeTruthy()
    })
})
