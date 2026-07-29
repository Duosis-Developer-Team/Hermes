/**
 * HERMES - Auth domain API (Sprint 1 §10 — services/api.js'ten tasindi).
 * Davranis birebir ayni; yalnizca ev degisti. Tuketiciler ister buradan
 * ister (gecis boyunca) services/api.js facade'inden import eder.
 */
import { authClient } from './httpClient'

export const authService = {
    /**
     * Login — E-posta ve şifre ile giriş.
     *
     * [KRİTİK-6] Backend artık token döndürmez; HttpOnly cookie set eder.
     * Response yalnızca { user } içerir.
     *
     * @returns {{ user: object }}
     */
    login: async (email, password) => {
        const formData = new URLSearchParams()
        formData.append('username', email)
        formData.append('password', password)

        const response = await authClient.post('/api/v1/auth/token', formData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
        // response.data = { user: {...} }
        return response.data
    },

    /**
     * Microsoft SSO Login.
     *
     * [KRİTİK-6] Backend HttpOnly cookie set eder; response yalnızca { user }.
     *
     * @param {Object} data { code, redirect_uri }
     * @returns {{ user: object }}
     */
    microsoftLogin: async (data) => {
        const response = await authClient.post('/api/v1/auth/microsoft', data)
        return response.data
    },

    /**
     * Oturumu kapat.
     * Backend cookie'yi siler; store logout() ile UI state temizlenir.
     */
    logout: async () => {
        await authClient.post('/api/v1/auth/logout')
    },

    /**
     * Mevcut kullanıcı bilgisi
     */
    getMe: async () => {
        const response = await authClient.get('/api/v1/auth/users/me')
        return response.data
    },

    /**
     * Kullanıcı listesi (Admin)
     */
    getUsers: async (params = {}) => {
        const response = await authClient.get('/api/v1/auth/users', { params })
        return response.data
    },

    /**
     * Kullanıcı oluştur (Admin)
     */
    createUser: async (userData) => {
        const response = await authClient.post('/api/v1/auth/users', userData)
        return response.data
    },

    /**
     * Kullanıcı güncelle (Admin)
     */
    updateUser: async (userId, userData) => {
        const response = await authClient.put(`/api/v1/auth/users/${userId}`, userData)
        return response.data
    },

    /**
     * Kullanıcı sil (Admin)
     */
    deleteUser: async (userId) => {
        await authClient.delete(`/api/v1/auth/users/${userId}`)
    },

    /**
     * Lightweight user lookup for any authenticated user.
     * Used by feature modules (e.g. Tasks) for assigner/assignee display.
     * params: { ids?: string[], include_inactive?: boolean }
     */
    lookupUsers: async (params = {}) => {
        const { ids, include_inactive } = params
        const search = new URLSearchParams()
        if (Array.isArray(ids)) ids.forEach(id => search.append('ids', id))
        if (include_inactive) search.append('include_inactive', 'true')
        const qs = search.toString()
        const url = qs ? `/api/v1/auth/users/lookup?${qs}` : '/api/v1/auth/users/lookup'
        const response = await authClient.get(url)
        return response.data
    },
}
