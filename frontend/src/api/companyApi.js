/**
 * HERMES - Sirket hesaplari + modul erisimi (docs/tenant-platform/01).
 *
 * Sirket hesabi (dis musteriye verilen TEK hesap) auth'ta yasar; talepleri
 * icin musteri kaydi + destek ekibi core'dadir.
 */
import { authClient, coreClient } from './httpClient'

export const companyService = {
    list: async () => (await authClient.get('/api/v1/auth/companies')).data,
    create: async (payload) => (await authClient.post('/api/v1/auth/companies', payload)).data,
    update: async (id, payload) => (await authClient.patch(`/api/v1/auth/companies/${id}`, payload)).data,
    resetPassword: async (id, password) => {
        await authClient.post(`/api/v1/auth/companies/${id}/password`, { password })
    },
    /** { provider, items: [{ account_id, display_name, group_id, group_name, configured }] } */
    supportList: async () => (await coreClient.get('/api/v1/core/companies/support')).data,
    setSupport: async (id, payload) => (await coreClient.put(`/api/v1/core/companies/${id}/support`, payload)).data,
    /** { logos: { account_id: etag } } */
    logos: async () => (await coreClient.get('/api/v1/core/companies/logos')).data,
    uploadLogo: async (id, file) => {
        const form = new FormData()
        form.append('file', file)
        const { data } = await coreClient.put(`/api/v1/core/companies/${id}/logo`, form, {
            headers: { 'Content-Type': 'multipart/form-data' },
        })
        return data
    },
    deleteLogo: async (id) => { await coreClient.delete(`/api/v1/core/companies/${id}/logo`) },
}

export const moduleAccessService = {
    /** [{ module, everyone, grants: [{ type: 'user'|'group', id }] }] */
    list: async () => (await authClient.get('/api/v1/auth/module-access')).data,
    set: async (module, payload) => (await authClient.put(`/api/v1/auth/module-access/${module}`, payload)).data,
}
