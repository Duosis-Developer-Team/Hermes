/**
 * =============================================================================
 * HERMES - Platform Admin API istemcisi (WS9)
 * =============================================================================
 * AYRI bir istemci: tenant istemcisinin interceptor'lari (orn. tenant
 * oturumu bitince /login'e atma) platform konsolunda YANLIS davranis
 * olurdu — iki duzlemin oturumu bagimsizdir.
 *
 * `withCredentials` sart: oturum HttpOnly cookie'dedir ve o cookie
 * yalnizca /api/platform yoluna gonderilir.
 */
import axios from 'axios'

const BASE = '/api/platform/v1'

const platformClient = axios.create({
    withCredentials: true,
    headers: { 'Content-Type': 'application/json' },
})

export const platformService = {
    login: async (email, password) => {
        const { data } = await platformClient.post(`${BASE}/login`, {
            email, password,
        })
        return data
    },

    logout: async () => {
        await platformClient.post(`${BASE}/logout`)
    },

    me: async () => {
        const { data } = await platformClient.get(`${BASE}/me`)
        return data
    },

    overview: async () => {
        const { data } = await platformClient.get(`${BASE}/overview`)
        return data
    },

    listTenants: async (params = {}) => {
        const { data } = await platformClient.get(`${BASE}/tenants`, {
            params,
        })
        return data
    },

    getTenant: async (tenantId) => {
        const { data } = await platformClient.get(
            `${BASE}/tenants/${tenantId}`,
        )
        return data
    },

    /** Kiraci uyeleri: kimlik + uyelik + yonetici bayragi (is verisi yok). */
    listTenantMembers: async (tenantId) => {
        const { data } = await platformClient.get(
            `${BASE}/tenants/${tenantId}/members`,
        )
        return data.members || []
    },

    /** Askiya alma: gerekce + yazili slug onayi ZORUNLU. */
    // WS12 — tenant olusturma / duzenleme
    // -----------------------------------------------------------------
    // Ticket Hub — tenant destek yonlendirmesi
    // -----------------------------------------------------------------
    // Talep agi konfigurasyonu core_db'de yasar; auth-service dar bir S2S
    // ucundan okur/yazar. Bu uclar talep ICERIGI DONDURMEZ.
    supportProviders: async () => {
        const { data } = await platformClient.get(`${BASE}/support/providers`)
        return data
    },

    // Talep agi: "kim, kime (hangi ekibe) talep acabilir?"
    supportNetwork: async () => {
        const { data } = await platformClient.get(`${BASE}/support/network`)
        return data
    },

    setNetworkLink: async (requesterId, providerId, payload) => {
        const { data } = await platformClient.put(
            `${BASE}/support/network/${requesterId}/${providerId}`, payload,
        )
        return data
    },

    disableNetworkLink: async (requesterId, providerId, expectedVersion) => {
        const { data } = await platformClient.delete(
            `${BASE}/support/network/${requesterId}/${providerId}`,
            { params: expectedVersion ? { expected_version: expectedVersion } : {} },
        )
        return data
    },

    listPlans: async () => {
        const { data } = await platformClient.get(`${BASE}/plans`)
        return data.plans || []
    },

    createTenant: async (payload) => {
        const { data } = await platformClient.post(`${BASE}/tenants`, payload)
        return data
    },

    updateTenant: async (tenantId, payload) => {
        const { data } = await platformClient.patch(
            `${BASE}/tenants/${tenantId}`, payload,
        )
        return data
    },

    suspendTenant: async (tenantId, { reason, confirmSlug, version }) => {
        const { data } = await platformClient.post(
            `${BASE}/tenants/${tenantId}/suspend`,
            {
                reason,
                confirm_slug: confirmSlug,
                expected_version: version,
            },
        )
        return data
    },

    reactivateTenant: async (tenantId, { reason, version }) => {
        const { data } = await platformClient.post(
            `${BASE}/tenants/${tenantId}/reactivate`,
            { reason, expected_version: version },
        )
        return data
    },

    listSupportGrants: async (activeOnly = true) => {
        const { data } = await platformClient.get(`${BASE}/support-grants`, {
            params: { active_only: activeOnly },
        })
        return data.grants || []
    },

    createSupportGrant: async (
        { tenantId, mode = 'read_only', reason, durationMinutes = 15 },
    ) => {
        const { data } = await platformClient.post(`${BASE}/support-grants`, {
            tenant_id: tenantId,
            mode,
            reason,
            duration_minutes: durationMinutes,
        })
        return data.grant
    },

    revokeSupportGrant: async (grantId) => {
        await platformClient.post(
            `${BASE}/support-grants/${grantId}/revoke`,
        )
    },

    listAuditEvents: async (params = {}) => {
        const { data } = await platformClient.get(`${BASE}/audit-events`, {
            params,
        })
        return data.events || []
    },
}

export default platformService
