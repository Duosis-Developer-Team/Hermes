/**
 * =============================================================================
 * Giris ekrani — "Oturumu acik tut"
 * =============================================================================
 * Kutu Microsoft butonunun USTUNDEdir ve iki yola da uygulanir:
 *   - parola girisi: authService.login(..., { remember })
 *   - Microsoft: OAuth `state` icinde `rm:1` (callback geri okur)
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/api', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        authService: { ...actual.authService, login: vi.fn() },
    }
})

import LoginPage from '../../pages/LoginPage'
import { authService } from '../../services/api'
import { useAuthStore } from '../../stores/authStore'

const renderLogin = () => render(
    <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
    </MemoryRouter>,
)

const fillAndSubmit = async (user) => {
    await user.click(screen.getByRole('button', { name: /e-posta|email/i }))
    await user.type(await screen.findByPlaceholderText(/sirket\.com|company\.com/i), 'a@acme.com')
    await user.type(screen.getByPlaceholderText(/parolan|password/i), 'gizli-parola')
    await user.click(screen.getByRole('button', { name: /^(giri. yap|sign in)$/i }))
}

describe('Oturumu acik tut', () => {
    let originalLocation

    beforeEach(() => {
        useAuthStore.setState({
            user: null, tenant: null, memberships: [],
            isAuthenticated: false, permissions: null,
        })
        authService.login.mockReset()
        authService.login.mockResolvedValue({ user: { id: 'u1' }, tenant: { id: 't1' } })
        originalLocation = window.location
    })

    afterEach(() => {
        window.location = originalLocation
        delete window._env_
    })

    it('kutu Microsoft butonunun USTUNDE ve varsayilan olarak kapali', () => {
        renderLogin()
        const box = screen.getByRole('checkbox', { name: /oturumu a.+k tut|keep me signed in/i })
        expect(box).not.toBeChecked()
        const ms = screen.getByRole('button', { name: /microsoft/i })
        // DOM sirasinda kutu butondan ONCE gelir.
        expect(box.compareDocumentPosition(ms) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('parola girisi remember=false gonderir (kutu kapali)', async () => {
        const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 })
        renderLogin()
        await fillAndSubmit(user)
        await waitFor(() => expect(authService.login).toHaveBeenCalled())
        expect(authService.login).toHaveBeenCalledWith(
            'a@acme.com', 'gizli-parola', { remember: false },
        )
    })

    it('parola girisi remember=true gonderir (kutu acik)', async () => {
        const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 })
        renderLogin()
        await user.click(screen.getByRole('checkbox', { name: /oturumu a.+k tut|keep me signed in/i }))
        await fillAndSubmit(user)
        await waitFor(() => expect(authService.login).toHaveBeenCalled())
        expect(authService.login).toHaveBeenCalledWith(
            'a@acme.com', 'gizli-parola', { remember: true },
        )
    })

    it.each([
        [true, '&state=rm%3A1'],
        [false, null],
    ])('Microsoft girisi secimi OAuth state ile tasir (remember=%s)', async (checked, suffix) => {
        window._env_ = { VITE_AZURE_CLIENT_ID: 'cid', VITE_AZURE_TENANT_ID: 'tid' }
        const fake = { href: 'http://localhost/login', search: '', origin: 'http://localhost' }
        delete window.location
        window.location = fake

        const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 })
        renderLogin()
        if (checked) {
            await user.click(screen.getByRole('checkbox', { name: /oturumu a.+k tut|keep me signed in/i }))
        }
        await user.click(screen.getByRole('button', { name: /microsoft/i }))

        expect(fake.href).toContain('https://login.microsoftonline.com/tid/oauth2/v2.0/authorize')
        if (suffix) {
            expect(fake.href.endsWith(suffix)).toBe(true)
        } else {
            expect(fake.href).not.toContain('state=')
        }
    })
})
