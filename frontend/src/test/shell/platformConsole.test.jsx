/**
 * =============================================================================
 * WS9 — Platform konsolu: duzlem ayriligi ve destek banner'i
 * =============================================================================
 * Frontend tarafinda kilitlenen sozlesmeler:
 *   1. Tenant oturumu platform konsoluna erisim VERMEZ (iki store
 *      birbirinden bagimsizdir).
 *   2. Destek oturumu banner'i KAPATILAMAZ ve tenant/mod/kalan sureyi
 *      metinle soyler.
 *   3. Platform izinleri fail-closed'dir.
 */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '../../stores/authStore'
import { usePlatformAuthStore } from '../../stores/platformAuthStore'
import SupportSessionBanner from '../../pages/platform/SupportSessionBanner'

const resetStores = () => {
    useAuthStore.setState({
        user: null, tenant: null, memberships: [],
        isAuthenticated: false, permissions: null,
    })
    usePlatformAuthStore.setState({
        admin: null, permissions: null, isAuthenticated: false,
    })
}

describe('duzlem ayriligi', () => {
    beforeEach(resetStores)

    it('tenant oturumu platform oturumu ACMAZ', () => {
        useAuthStore.getState().login(
            { id: 'u1', is_admin: true },
            { id: 't1', slug: 'acme', display_name: 'Acme' },
        )

        // Tenant tarafinda tam yetkili olmak platform duzleminde
        // HICBIR sey ifade etmez.
        expect(useAuthStore.getState().isAuthenticated).toBe(true)
        expect(usePlatformAuthStore.getState().isAuthenticated).toBe(false)
        expect(usePlatformAuthStore.getState().can('platform.tenants.view'))
            .toBe(false)
    })

    it('platform oturumu tenant oturumu ACMAZ', () => {
        usePlatformAuthStore.getState().login(
            { id: 'ops1', email: 'ops@hermes.dev' },
            ['platform.tenants.view'],
        )

        expect(usePlatformAuthStore.getState().isAuthenticated).toBe(true)
        expect(useAuthStore.getState().isAuthenticated).toBe(false)
        // Platform operatoru tenant izinlerine sahip DEGILDIR.
        expect(useAuthStore.getState().can('users.manage')).toBe(false)
    })

    it('platform izinleri fail-closed', () => {
        // Izinler yuklenmeden hicbir sey yapilabilir sayilmaz.
        expect(usePlatformAuthStore.getState().can('platform.tenants.manage'))
            .toBe(false)

        usePlatformAuthStore.getState().login({ id: 'ops1' },
                                              ['platform.tenants.view'])
        expect(usePlatformAuthStore.getState().can('platform.tenants.view'))
            .toBe(true)
        // Sahip OLMADIGI izin false doner.
        expect(usePlatformAuthStore.getState().can('platform.tenants.manage'))
            .toBe(false)
    })

    it('platform logout tenant oturumuna DOKUNMAZ', () => {
        useAuthStore.getState().login({ id: 'u1' },
                                      { id: 't1', display_name: 'Acme' })
        usePlatformAuthStore.getState().login({ id: 'ops1' }, [])

        usePlatformAuthStore.getState().logout()

        expect(usePlatformAuthStore.getState().isAuthenticated).toBe(false)
        // Tenant oturumu etkilenmedi: iki duzlem bagimsiz.
        expect(useAuthStore.getState().isAuthenticated).toBe(true)
    })
})

describe('destek oturumu banner', () => {
    const session = {
        id: 'g1',
        tenant: { id: 't1', slug: 'acme', display_name: 'Acme Ltd' },
        mode: 'read_only',
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }

    it('tenant adini, modu ve kalan sureyi METINLE gosterir', () => {
        render(<SupportSessionBanner session={session} onEnd={() => {}} />)

        expect(screen.getByText(/Support session active/i)).toBeInTheDocument()
        expect(screen.getByText('Acme Ltd')).toBeInTheDocument()
        // Mod renkle DEGIL metinle de belirtilir (erisilebilirlik).
        expect(screen.getByText('read-only')).toBeInTheDocument()
    })

    it('GIZLEME aksiyonu YOKTUR — yalnizca sonlandirma vardir', () => {
        render(<SupportSessionBanner session={session} onEnd={() => {}} />)

        const buttons = screen.getAllByRole('button')
        const labels = buttons.map((b) => b.textContent.toLowerCase())
        expect(labels.some((l) => l.includes('end session'))).toBe(true)
        // "hide"/"dismiss"/"close" gibi bir kacis yolu OLMAMALI:
        // operator baska bir sirketin verisine baktigini unutamamali.
        expect(labels.some((l) => /hide|dismiss|close/.test(l))).toBe(false)
    })

    it('oturum yoksa hicbir sey render etmez', () => {
        const { container } = render(
            <SupportSessionBanner session={null} onEnd={() => {}} />,
        )
        expect(container).toBeEmptyDOMElement()
    })

    it('sure dolunca onExpire cagrilir ve durum degisir', () => {
        const onExpire = vi.fn()
        const expired = {
            ...session,
            expires_at: new Date(Date.now() - 1000).toISOString(),
        }
        render(
            <SupportSessionBanner
                session={expired} onEnd={() => {}} onExpire={onExpire}
            />,
        )
        expect(onExpire).toHaveBeenCalled()
        expect(screen.getByText(/Support session expired/i)).toBeInTheDocument()
    })
})
