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

    /** Askiya alma: gerekce + yazili slug onayi ZORUNLU. */
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
