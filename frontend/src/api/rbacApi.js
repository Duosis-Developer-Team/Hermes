/**
 * HERMES - RBAC domain API (Sprint 1 §10 — services/api.js'ten tasindi).
 */
import { authClient } from './httpClient'

export const rbacService = {
    /** Oturum sahibinin efektif izinleri + rolleri. */
    getMyPermissions: async () => {
        const response = await authClient.get('/api/v1/auth/rbac/me')
        return response.data
    },

    /** İzin kataloğu (rol editörünü besler). */
    getPermissionCatalog: async () => {
        const response = await authClient.get('/api/v1/auth/rbac/permission-catalog')
        return response.data
    },

    listRoles: async (includeInactive = false) => {
        const response = await authClient.get('/api/v1/auth/rbac/roles', {
            params: includeInactive ? { include_inactive: true } : {},
        })
        return response.data
    },

    createRole: async (payload) => {
        const response = await authClient.post('/api/v1/auth/rbac/roles', payload)
        return response.data
    },

    updateRole: async (roleId, payload) => {
        const response = await authClient.patch(`/api/v1/auth/rbac/roles/${roleId}`, payload)
        return response.data
    },

    deactivateRole: async (roleId) => {
        const response = await authClient.delete(`/api/v1/auth/rbac/roles/${roleId}`)
        return response.data
    },

    getUserRoles: async (userId) => {
        const response = await authClient.get(`/api/v1/auth/rbac/users/${userId}/roles`)
        return response.data
    },

    /** Kullanıcının rol kümesini REPLACE eder. */
    setUserRoles: async (userId, roleIds) => {
        const response = await authClient.put(`/api/v1/auth/rbac/users/${userId}/roles`, {
            role_ids: roleIds,
        })
        return response.data
    },
}
