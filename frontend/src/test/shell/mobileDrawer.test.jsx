/**
 * Sprint 3 §10 — Mobil navigasyon drawer davranislari:
 * acilir/kapanir, route secilince kapanir, Escape ile kapanir,
 * body scroll kilidi ve focus'un TETIKLEYICIYE donusu.
 *
 * matchMedia stub'i mobil eslesme dondurecek sekilde override edilir
 * (setup.js varsayilani masaustudur).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
import { makeTestQueryClient, resetAuthStore } from '../utils'

const setMobile = (isMobile) => {
    window.matchMedia = (query) => ({
        matches: isMobile, media: query,
        addEventListener: () => {}, removeEventListener: () => {},
        addListener: () => {}, removeListener: () => {},
        dispatchEvent: () => false, onchange: null,
    })
}

const renderMobileShell = () => {
    useAuthStore.setState({
        user: { id: 'u1', email: 'a@x.com', full_name: 'Ada', is_admin: false },
        isAuthenticated: true, permissions: ['customers.manage'],
    })
    return render(
        <QueryClientProvider client={makeTestQueryClient()}>
            <ConfigProvider>
                <MemoryRouter initialEntries={['/time-entry']}>
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

const drawerEl = () => document.querySelector('.mobile-nav-drawer')
const openBtn = () => screen.getByRole('button', { name: /Toggle navigation/i })

beforeEach(() => {
    localStorage.clear()
    resetAuthStore()
    setMobile(true)
})

describe('mobil drawer', () => {
    it('mobilde ayni buton drawer acar (sidebar collapse DEGIL)', () => {
        renderMobileShell()
        expect(drawerEl()).toBeNull()
        fireEvent.click(openBtn())
        expect(drawerEl()).toBeTruthy()
        // Collapse tercihi mobilde degismedi
        expect(localStorage.getItem('hermes-sidebar-collapsed')).toBeNull()
    })

    it('route secilince drawer kapanir ve navigasyon gerceklesir', async () => {
        renderMobileShell()
        fireEvent.click(openBtn())
        const links = screen.getAllByText('Customers')
        fireEvent.click(links[links.length - 1])
        expect(await screen.findByText('CUSTOMERS')).toBeInTheDocument()
        await waitFor(() =>
            expect(document.querySelector('.mobile-nav-drawer .ant-drawer-content-wrapper'))
                .toBeNull()
        )
    })

    it('Escape drawer i kapatir', async () => {
        renderMobileShell()
        fireEvent.click(openBtn())
        expect(drawerEl()).toBeTruthy()
        fireEvent.keyDown(document.querySelector('.ant-drawer'), {
            key: 'Escape', code: 'Escape', keyCode: 27,
        })
        await waitFor(() =>
            expect(document.querySelector('.mobile-nav-drawer .ant-drawer-content-wrapper'))
                .toBeNull()
        )
    })

    it('drawer acikken body scroll kilitlenir, kapaninca serbest kalir', async () => {
        renderMobileShell()
        fireEvent.click(openBtn())
        await waitFor(() => expect(document.body.style.overflow).toBe('hidden'))
        fireEvent.keyDown(document.querySelector('.ant-drawer'), {
            key: 'Escape', code: 'Escape', keyCode: 27,
        })
        await waitFor(() => expect(document.body.style.overflow).not.toBe('hidden'))
    })

    it('kapaninca focus TETIKLEYICI butona doner (§10)', async () => {
        renderMobileShell()
        const trigger = openBtn()
        trigger.focus()
        fireEvent.click(trigger)
        expect(drawerEl()).toBeTruthy()
        fireEvent.keyDown(document.querySelector('.ant-drawer'), {
            key: 'Escape', code: 'Escape', keyCode: 27,
        })
        await waitFor(() => expect(document.activeElement).toBe(trigger))
    })
})
