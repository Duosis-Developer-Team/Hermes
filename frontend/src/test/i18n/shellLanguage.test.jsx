/**
 * HERMES - Dil dugmesi kabukta GERCEKTEN metni degistiriyor mu?
 *
 * Sozluk testleri anahtarlarin varligini kilitler; bu test kullanicinin
 * gordugu seyi kilitler: dugmeye basinca gezinme metni Turkce olur ve
 * tekrar basinca Ingilizce'ye doner.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
vi.mock('../../routes/loaders', () => ({
    routeLoaders: {},
    loaderByPath: {},
}))

import MainLayout from '../../components/layout/MainLayout'
import { useAuthStore } from '../../stores/authStore'
import { useLocaleStore } from '../../stores/localeStore'
import { makeTestQueryClient } from '../utils'

const renderShell = () => {
    useAuthStore.setState({
        user: { id: 'u1', email: 'a@x.com', full_name: 'Ada', is_admin: false },
        isAuthenticated: true,
        permissions: ['reports.view'],
    })
    return render(
        <QueryClientProvider client={makeTestQueryClient()}>
            <ConfigProvider>
                <MemoryRouter initialEntries={['/time-entry']}>
                    <Routes>
                        <Route path="/" element={<MainLayout />}>
                            <Route path="time-entry" element={<div>ROUTE</div>} />
                        </Route>
                    </Routes>
                </MemoryRouter>
            </ConfigProvider>
        </QueryClientProvider>,
    )
}

describe('kabuk dil dugmesi', () => {
    beforeEach(() => {
        useLocaleStore.getState().setLocale('en')
    })

    it('dil dugmesi tema dugmesinin yaninda ve mevcut dili gosterir', () => {
        renderShell()
        expect(screen.getByRole('button', { name: /Turkish/i })).toBeInTheDocument()
        expect(screen.getByText('EN')).toBeInTheDocument()
    })

    it('basinca gezinme metni Turkce olur, tekrar basinca Ingilizce', async () => {
        const user = userEvent.setup()
        renderShell()
        expect(screen.getByText('Time Entry')).toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: /Turkish/i }))
        expect(await screen.findByText('Zaman Girişi')).toBeInTheDocument()
        expect(screen.queryByText('Time Entry')).toBeNull()
        expect(screen.getByText('TR')).toBeInTheDocument()

        // Dil degisince dugmenin ETIKETI de cevrilir: artik
        // "İngilizce'ye geç" yazar. Bu bilincli — etiket her zaman
        // KULLANICININ o an okudugu dilde olur.
        await user.click(screen.getByRole('button', { name: /İngilizce/i }))
        expect(await screen.findByText('Time Entry')).toBeInTheDocument()
        expect(screen.getByText('EN')).toBeInTheDocument()
    })
})
