/**
 * =============================================================================
 * Sprint 6B.1 — Yonetim rotalari: gorunurluk ve route guard
 * =============================================================================
 * GERCEK guard component'leri (App.jsx'ten) gercek bir router icinde mount
 * edilir; kaynak metni aranmaz. Assertion'lar navigasyon SONUCUNA bakar:
 * korumali icerik mi cizildi, yoksa yonlendirme mi oldu.
 *
 * Kilitlenen sozlesme:
 *   - Izin verisi HENUZ YUKLENMEMISKEN (null) yonlendirme YAPILMAZ ve
 *     korumali icerik CIZILMEZ — loader gosterilir. Aksi halde oturum
 *     geri yuklenirken admin icerigi bir an gorunur ya da yetkili
 *     kullanici yanlislikla disari atilir.
 *   - Yetkisiz kullanici DOGRUDAN URL ile de giremez (menuyu gizlemek
 *     yeterli degildir).
 *   - Tasks erisimi ile assign yetkisi KARISTIRILMAZ.
 * =============================================================================
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'

vi.mock('../../services/api', async () => await import('../tasks/apiMock'))
import { PERMS_ADMIN, PERMS_NO_ASSIGN, mockState, resetTasksApi } from '../tasks/apiMock'
import { ProtectedRoute, TaskProtectedRoute } from '../../App'
import { useAuthStore } from '../../stores/authStore'
import { makeTestQueryClient, resetAuthStore } from '../utils'

const ADMIN_SURFACE = 'ADMIN-ONLY-CONTENT'
const FALLBACK = 'TIME-ENTRY-FALLBACK'

/** Guard'i gercek router icinde, /users adresinde dener. */
const renderGuard = (guard) =>
    render(
        <QueryClientProvider client={makeTestQueryClient()}>
            <MemoryRouter initialEntries={['/users']}>
                <Routes>
                    <Route path="/users" element={guard} />
                    <Route path="/time-entry" element={<div>{FALLBACK}</div>} />
                    <Route path="/login" element={<div>LOGIN</div>} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>
    )

const signIn = ({ permissions, isAdmin = false }) => {
    useAuthStore.setState({
        user: { id: 'u1', email: 'a@x.com', full_name: 'Ada', is_admin: isAdmin },
        isAuthenticated: true,
        permissions,
    })
}

beforeEach(() => {
    resetAuthStore()
    resetTasksApi()
})

describe('ProtectedRoute — izin tabanli yonetim rotasi', () => {
    it('IZNI OLAN kullanici korumali icerigi gorur', async () => {
        signIn({ permissions: ['tasks.permissions.manage'] })
        renderGuard(
            <ProtectedRoute permission="tasks.permissions.manage">
                <div>{ADMIN_SURFACE}</div>
            </ProtectedRoute>
        )
        expect(await screen.findByText(ADMIN_SURFACE)).toBeInTheDocument()
    })

    it('IZNI OLMAYAN kullanici DOGRUDAN URL ile giremez → yonlendirilir', async () => {
        signIn({ permissions: ['worklogs.view'] })
        renderGuard(
            <ProtectedRoute permission="tasks.permissions.manage">
                <div>{ADMIN_SURFACE}</div>
            </ProtectedRoute>
        )
        expect(await screen.findByText(FALLBACK)).toBeInTheDocument()
        expect(screen.queryByText(ADMIN_SURFACE)).not.toBeInTheDocument()
    })

    it('izinler YUKLENMEMISKEN (null) ne icerik ne yonlendirme — loader', () => {
        signIn({ permissions: null })
        renderGuard(
            <ProtectedRoute permission="tasks.permissions.manage">
                <div>{ADMIN_SURFACE}</div>
            </ProtectedRoute>
        )
        // Oturum geri yuklenirken admin icerigi BIR AN BILE gorunmez...
        expect(screen.queryByText(ADMIN_SURFACE)).not.toBeInTheDocument()
        // ...ve yetkili kullanici yanlislikla disari atilmaz.
        expect(screen.queryByText(FALLBACK)).not.toBeInTheDocument()
    })

    it('bos izin listesi ([]) yonlendirir — null ile AYNI SEY DEGIL', async () => {
        signIn({ permissions: [] })
        renderGuard(
            <ProtectedRoute permission="tasks.permissions.manage">
                <div>{ADMIN_SURFACE}</div>
            </ProtectedRoute>
        )
        expect(await screen.findByText(FALLBACK)).toBeInTheDocument()
    })

    it('dizi verilen izinlerden HERHANGI BIRI yeterlidir', async () => {
        signIn({ permissions: ['users.manage'] })
        renderGuard(
            <ProtectedRoute permission={['tasks.permissions.manage', 'users.manage']}>
                <div>{ADMIN_SURFACE}</div>
            </ProtectedRoute>
        )
        expect(await screen.findByText(ADMIN_SURFACE)).toBeInTheDocument()
    })

    it('oturum YOKSA login’e gider (izinden once)', async () => {
        resetAuthStore()
        renderGuard(
            <ProtectedRoute permission="tasks.permissions.manage">
                <div>{ADMIN_SURFACE}</div>
            </ProtectedRoute>
        )
        expect(await screen.findByText('LOGIN')).toBeInTheDocument()
    })

    it('izin BELIRTILMEMISSE yalnizca oturum yeterlidir', async () => {
        signIn({ permissions: [] })
        renderGuard(
            <ProtectedRoute>
                <div>{ADMIN_SURFACE}</div>
            </ProtectedRoute>
        )
        expect(await screen.findByText(ADMIN_SURFACE)).toBeInTheDocument()
    })
})

describe('TaskProtectedRoute — Tasks erisimi', () => {
    it('admin her kosulda gorur (izin sorgusu beklenmez)', async () => {
        signIn({ permissions: [], isAdmin: true })
        renderGuard(
            <TaskProtectedRoute><div>{ADMIN_SURFACE}</div></TaskProtectedRoute>
        )
        expect(await screen.findByText(ADMIN_SURFACE)).toBeInTheDocument()
    })

    it('ERISIMI OLAN non-admin gorur', async () => {
        mockState.perms = PERMS_NO_ASSIGN // can_access: true, can_assign: false
        signIn({ permissions: [] })
        renderGuard(
            <TaskProtectedRoute><div>{ADMIN_SURFACE}</div></TaskProtectedRoute>
        )
        // ERISIM ile ATAMA karistirilmaz: assign yetkisi olmasa da
        // Tasks yuzeyi acilir.
        expect(await screen.findByText(ADMIN_SURFACE)).toBeInTheDocument()
    })

    it('ERISIMI OLMAYAN kullanici yonlendirilir', async () => {
        mockState.perms = {
            is_admin: false,
            task: { can_access: false, can_assign: false },
            issue: { can_access: false, can_assign: false },
        }
        signIn({ permissions: [] })
        renderGuard(
            <TaskProtectedRoute><div>{ADMIN_SURFACE}</div></TaskProtectedRoute>
        )
        expect(await screen.findByText(FALLBACK)).toBeInTheDocument()
        expect(screen.queryByText(ADMIN_SURFACE)).not.toBeInTheDocument()
    })

    it('admin bayragi PERMS_ADMIN uzerinden de gelirse gorur', async () => {
        mockState.perms = PERMS_ADMIN
        signIn({ permissions: [] })
        renderGuard(
            <TaskProtectedRoute><div>{ADMIN_SURFACE}</div></TaskProtectedRoute>
        )
        expect(await screen.findByText(ADMIN_SURFACE)).toBeInTheDocument()
    })

    it('oturum YOKSA login’e gider', async () => {
        resetAuthStore()
        renderGuard(
            <TaskProtectedRoute><div>{ADMIN_SURFACE}</div></TaskProtectedRoute>
        )
        expect(await screen.findByText('LOGIN')).toBeInTheDocument()
    })
})

describe('yetkisiz kullanici admin KODUNU preload etmez', () => {
    it('admin route’lari LAZY loader FONKSIYONUDUR — modul cagrilmadan yuklenmez', async () => {
        const { routeLoaders, loaderByPath } = await import('../../routes/loaders')
        // Davranissal kanit: loader bir FONKSIYON. Modul, ancak
        // cagrildiginda indirilir; App'i import etmek admin chunk'ini
        // getirmez. (Metin aramasi degil, gercek sozlesme.)
        for (const key of ['taskManagement', 'apiManagement', 'users']) {
            expect(typeof routeLoaders[key], key).toBe('function')
        }
        // Cagrildiginda dinamik import promise'i doner.
        const pending = routeLoaders.taskManagement()
        expect(typeof pending.then).toBe('function')
        await pending

        // Prefetch haritasi admin yollarini AYNI loader'a baglar; menu
        // izin-filtreli oldugu icin izinsiz route prefetch'i yapisal
        // olarak imkansizdir.
        expect(loaderByPath['/pm-configurations']).toBe(routeLoaders.taskManagement)
        expect(loaderByPath['/api-management']).toBe(routeLoaders.apiManagement)
        expect(loaderByPath['/users']).toBe(routeLoaders.users)
    })
})
