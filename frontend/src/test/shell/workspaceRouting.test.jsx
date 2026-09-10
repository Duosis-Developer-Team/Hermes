/**
 * =============================================================================
 * Workspace adresleme — `?workspace=` giris boyunca KAYBOLMAZ
 * =============================================================================
 * hermes-test'te host'un tenant'i (Duosis) disindaki tenant'lar
 * `/?workspace=<slug>` ile acilir. Parametre iki gecisle kayboluyor ve
 * giris SESSIZCE Duosis'e dusuyordu:
 *   1. Oturumsuz kullanicinin korunan sayfadan `/login`e yonlendirilmesi,
 *   2. Microsoft'a gidip `/auth/callback`e donus (parametre `state`te).
 * Kilitlenen sozlesmeler bu iki gecis + bicim dogrulamasidir. Slug yetki
 * VERMEZ (sunucu aktif uyelik ister); burada yalnizca TASINMASI test edilir.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/api', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        authService: { ...actual.authService, microsoftLogin: vi.fn() },
    }
})
vi.mock('../../hooks/useTaskPermissions', () => ({
    useTaskPermissions: () => ({
        isLoading: false, canAccessAny: true, isTaskAdmin: false,
        assignableUserIds: [], assignableGroupIds: [],
        scopes: { task: {}, issue: {} },
    }),
}))

import {
    buildMicrosoftAuthorizeUrl, decodeSsoState, encodeSsoState,
    loginPathFor, readWorkspace,
} from '../../api/workspace'
import { ProtectedRoute, TaskProtectedRoute } from '../../App'
import AuthCallbackPage from '../../pages/AuthCallbackPage'
import { authService } from '../../services/api'
import { useAuthStore } from '../../stores/authStore'

const resetStore = () => {
    useAuthStore.setState({
        user: null, tenant: null, memberships: [],
        isAuthenticated: false, permissions: null,
    })
}

const LocationProbe = () => {
    const loc = useLocation()
    return <div data-testid="where">{loc.pathname + loc.search}</div>
}

// =============================================================================
// 1) Bicim — gecersiz slug hicbir yere TASINMAZ
// =============================================================================

describe('workspace yardimcilari', () => {
    it('gecerli slug okunur, gecersiz olan yok sayilir', () => {
        expect(readWorkspace('?workspace=acme')).toBe('acme')
        expect(readWorkspace('?workspace=tech-art2')).toBe('tech-art2')
        expect(readWorkspace('')).toBeNull()
        expect(readWorkspace('?workspace=')).toBeNull()
        expect(readWorkspace('?workspace=ACME')).toBeNull()
        expect(readWorkspace('?workspace=../evil')).toBeNull()
        expect(readWorkspace('?workspace=-acme')).toBeNull()
    })

    it('giris adresi workspace KORUNARAK uretilir', () => {
        expect(loginPathFor('?workspace=acme&x=1')).toBe('/login?workspace=acme')
        expect(loginPathFor('?x=1')).toBe('/login')
        expect(loginPathFor('')).toBe('/login')
    })

    it('SSO state gidis-donus korunur, sahte state reddedilir', () => {
        expect(decodeSsoState(encodeSsoState('acme'))).toBe('acme')
        expect(encodeSsoState(null)).toBeNull()
        expect(encodeSsoState('../x')).toBeNull()
        expect(decodeSsoState(null)).toBeNull()
        expect(decodeSsoState('acme')).toBeNull()        // onek yok
        expect(decodeSsoState('ws:../evil')).toBeNull()
    })

    it('workspace yokken authorize adresi ESKISIYLE BIREBIR aynidir', () => {
        const legacy = 'https://login.microsoftonline.com/tid/oauth2/v2.0/authorize?client_id=cid&response_type=code&redirect_uri=https://hermes.duosis.com/auth/callback&response_mode=query&scope=User.Read&prompt=select_account'
        expect(buildMicrosoftAuthorizeUrl({
            tenantId: 'tid', clientId: 'cid',
            origin: 'https://hermes.duosis.com',
        })).toBe(legacy)
    })

    it('workspace varsa yalnizca state eklenir', () => {
        const url = buildMicrosoftAuthorizeUrl({
            tenantId: 'tid', clientId: 'cid',
            origin: 'https://hermes.duosis.com', workspace: 'acme',
        })
        expect(url.endsWith('&state=ws%3Aacme')).toBe(true)
        // redirect_uri DEGISMEZ — Azure'da kayitli olan sabit adres.
        expect(url).toContain('redirect_uri=https://hermes.duosis.com/auth/callback&')
    })
})

// =============================================================================
// 2) Oturumsuz yonlendirme `?workspace=`i dusurmez
// =============================================================================

describe('korunan sayfadan girise yonlendirme', () => {
    beforeEach(resetStore)

    const renderAt = (entry, guard) => render(
        <MemoryRouter initialEntries={[entry]}>
            <Routes>
                <Route path="/login" element={<LocationProbe />} />
                <Route path="/time-entry" element={guard} />
            </Routes>
        </MemoryRouter>,
    )

    it('ProtectedRoute workspace KORUR', () => {
        renderAt('/time-entry?workspace=acme',
            <ProtectedRoute><div>GIZLI</div></ProtectedRoute>)
        expect(screen.getByTestId('where').textContent)
            .toBe('/login?workspace=acme')
        expect(screen.queryByText('GIZLI')).toBeNull()
    })

    it('TaskProtectedRoute workspace KORUR', () => {
        renderAt('/time-entry?workspace=acme',
            <TaskProtectedRoute><div>GIZLI</div></TaskProtectedRoute>)
        expect(screen.getByTestId('where').textContent)
            .toBe('/login?workspace=acme')
    })

    it('workspace yoksa duz /login (Duosis davranisi degismez)', () => {
        renderAt('/time-entry',
            <ProtectedRoute><div>GIZLI</div></ProtectedRoute>)
        expect(screen.getByTestId('where').textContent).toBe('/login')
    })
})

// =============================================================================
// 3) Microsoft donusu workspace'i sunucuya ACIKCA iletir
// =============================================================================

describe('Microsoft callback', () => {
    beforeEach(() => {
        resetStore()
        authService.microsoftLogin.mockReset()
        authService.microsoftLogin.mockResolvedValue({
            user: { id: 'u1', tenant: { id: 't1', slug: 'acme' } },
        })
    })

    const renderCallback = (query) => render(
        <MemoryRouter initialEntries={[`/auth/callback${query}`]}>
            <Routes>
                <Route path="/auth/callback" element={<AuthCallbackPage />} />
                <Route path="/" element={<LocationProbe />} />
                <Route path="/login" element={<LocationProbe />} />
            </Routes>
        </MemoryRouter>,
    )

    const redirectUri = () => window.location.origin + '/auth/callback'

    it('state icindeki workspace sunucuya gider', async () => {
        renderCallback('?code=abc&state=ws%3Aacme')
        await waitFor(() => expect(authService.microsoftLogin).toHaveBeenCalled())
        expect(authService.microsoftLogin).toHaveBeenCalledWith(
            { code: 'abc', redirect_uri: redirectUri() },
            { workspace: 'acme' },
        )
    })

    it('state yoksa workspace gonderilmez (host belirler)', async () => {
        renderCallback('?code=abc')
        await waitFor(() => expect(authService.microsoftLogin).toHaveBeenCalled())
        expect(authService.microsoftLogin).toHaveBeenCalledWith(
            { code: 'abc', redirect_uri: redirectUri() },
            { workspace: null },
        )
    })

    it('uydurma state bir workspace degeri URETMEZ', async () => {
        renderCallback('?code=abc&state=ws%3A..%2Fevil')
        await waitFor(() => expect(authService.microsoftLogin).toHaveBeenCalled())
        expect(authService.microsoftLogin.mock.calls[0][1]).toEqual({ workspace: null })
    })
})
