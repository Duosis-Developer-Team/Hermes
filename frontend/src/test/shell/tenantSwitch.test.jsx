/**
 * =============================================================================
 * WS8 — Tenant degisimi: eski tenant'in verisi YENI ekranda GORUNMEZ
 * =============================================================================
 * Pack §10'un en somut frontend gereksinimi: organizasyon degistirince
 * onceki tenant'in cache'lenmis yaniti bir an bile render EDILMEMELI.
 *
 * Iki bagimsiz savunma test edilir:
 *   1. Anahtar uzayi tenant'a gore bolunur — A'nin girisi B baglaminda
 *      okunamaz (biri kacirsa bile digeri tutar).
 *   2. Switch aninda ucusan sorgular iptal edilir ve cache bosaltilir.
 */
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { queryClient } from '../../query/queryClient'
import {
    getTenantScope, queryKeys, setTenantScope,
} from '../../query/queryKeys'
import { useAuthStore } from '../../stores/authStore'

const TENANT_A = { id: 'aaaa-1111', slug: 'acme', display_name: 'Acme' }
const TENANT_B = { id: 'bbbb-2222', slug: 'globex', display_name: 'Globex' }

const resetStore = () => {
    useAuthStore.setState({
        user: null, tenant: null, memberships: [],
        isAuthenticated: false, permissions: null,
    })
    setTenantScope(null)
    queryClient.clear()
}

describe('tenant kapsamli query anahtarlari', () => {
    beforeEach(resetStore)

    it('her anahtar aktif tenant ile baslar', () => {
        setTenantScope(TENANT_A.id)
        expect(queryKeys.tasks.all).toEqual(['t', TENANT_A.id, 'tasks'])
        expect(queryKeys.customers.all).toEqual(['t', TENANT_A.id, 'customers'])
        expect(queryKeys.tasks.detail('x')).toEqual(
            ['t', TENANT_A.id, 'tasks', 'detail', 'x'],
        )
    })

    it('tenant degisince AYNI mantiksal anahtar FARKLI olur', () => {
        setTenantScope(TENANT_A.id)
        const aKey = queryKeys.tasks.all
        setTenantScope(TENANT_B.id)
        const bKey = queryKeys.tasks.all

        expect(aKey).not.toEqual(bKey)
        // Bu, A'nin cache girisinin B baglaminda OKUNAMAMASI demektir.
        expect(JSON.stringify(aKey)).not.toBe(JSON.stringify(bKey))
    })

    it('oturum yokken anahtar anonim kapsamda kalir', () => {
        expect(getTenantScope()).toBe('anon')
        expect(queryKeys.tasks.all[1]).toBe('anon')
    })
})

describe('applyTenantSwitch', () => {
    beforeEach(resetStore)

    it("A'nin cache verisi B'ye GECMEZ", () => {
        useAuthStore.getState().login({ id: 'u1' }, TENANT_A)
        queryClient.setQueryData(queryKeys.tasks.all, [{ id: 1, title: 'A gorevi' }])
        expect(queryClient.getQueryData(queryKeys.tasks.all)).toHaveLength(1)

        useAuthStore.getState().applyTenantSwitch(TENANT_B)

        // Yeni tenant baglaminda ayni mantiksal anahtar BOS.
        expect(queryClient.getQueryData(queryKeys.tasks.all)).toBeUndefined()
        // Ve cache tamamen bosaltildigi icin A'nin girisi de yok.
        expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    })

    it('ucusan sorgular IPTAL edilir', () => {
        const cancelSpy = vi.spyOn(queryClient, 'cancelQueries')
        const clearSpy = vi.spyOn(queryClient, 'clear')

        useAuthStore.getState().login({ id: 'u1' }, TENANT_A)
        useAuthStore.getState().applyTenantSwitch(TENANT_B)

        expect(cancelSpy).toHaveBeenCalled()
        expect(clearSpy).toHaveBeenCalled()
        // Iptal, temizlikten ONCE olmali: aksi halde ucusan bir yanit
        // temizlikten SONRA gelip yeni tenant'in cache'ine yazilirdi.
        expect(cancelSpy.mock.invocationCallOrder[0])
            .toBeLessThan(clearSpy.mock.invocationCallOrder[0])

        cancelSpy.mockRestore()
        clearSpy.mockRestore()
    })

    it('izinler tenant degisince SIFIRLANIR (fail-closed)', () => {
        useAuthStore.getState().login({ id: 'u1' }, TENANT_A)
        useAuthStore.getState().setPermissions(['users.manage'])
        expect(useAuthStore.getState().can('users.manage')).toBe(true)

        useAuthStore.getState().applyTenantSwitch(TENANT_B)

        // A'nin yetkisi B'de OTOMATIK gecerli sayilmaz; yeniden
        // cozulene kadar her kontrol false doner.
        expect(useAuthStore.getState().permissions).toBeNull()
        expect(useAuthStore.getState().can('users.manage')).toBe(false)
    })

    it('tenant store state ile query kapsamini birlikte tasir', () => {
        useAuthStore.getState().login({ id: 'u1' }, TENANT_A)
        expect(getTenantScope()).toBe(TENANT_A.id)

        useAuthStore.getState().applyTenantSwitch(TENANT_B)
        expect(useAuthStore.getState().tenant).toEqual(TENANT_B)
        expect(getTenantScope()).toBe(TENANT_B.id)
    })
})

describe('logout', () => {
    beforeEach(resetStore)

    it('cache bosaltilir ve kapsam anonime doner', () => {
        useAuthStore.getState().login({ id: 'u1' }, TENANT_A)
        queryClient.setQueryData(queryKeys.customers.all, [{ id: 'c1' }])

        useAuthStore.getState().logout()

        expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
        expect(getTenantScope()).toBe('anon')
        expect(useAuthStore.getState().tenant).toBeNull()
    })
})

describe('organizasyon secici kosulu', () => {
    beforeEach(resetStore)

    it('tek uyelikte secici gosterilmez, birden fazlada gosterilir', () => {
        useAuthStore.getState().setMemberships([{ tenant_id: TENANT_A.id }])
        expect(useAuthStore.getState().hasMultipleTenants()).toBe(false)

        useAuthStore.getState().setMemberships([
            { tenant_id: TENANT_A.id }, { tenant_id: TENANT_B.id },
        ])
        expect(useAuthStore.getState().hasMultipleTenants()).toBe(true)
    })
})

describe('izole QueryClient de kapsamli anahtar kullanir', () => {
    it('test client A ve B icin ayri girisler tutar', () => {
        const client = new QueryClient()
        setTenantScope(TENANT_A.id)
        client.setQueryData(queryKeys.tasks.all, ['A'])
        setTenantScope(TENANT_B.id)
        client.setQueryData(queryKeys.tasks.all, ['B'])

        setTenantScope(TENANT_A.id)
        expect(client.getQueryData(queryKeys.tasks.all)).toEqual(['A'])
        setTenantScope(TENANT_B.id)
        expect(client.getQueryData(queryKeys.tasks.all)).toEqual(['B'])
        setTenantScope(null)
    })
})
