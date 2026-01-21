/**
 * =============================================================================
 * HERMES PLATFORM - API Service
 * =============================================================================
 * Axios tabanlı API istemcisi. Tüm backend istekleri bu servis üzerinden yapılır.
 * Token'ı otomatik ekler, hata yönetimi sağlar.
 * =============================================================================
 */

import axios from 'axios'
import { useAuthStore } from '../stores/authStore'


// =============================================================================
// API Base Configuration
// =============================================================================

// Servis URL'leri - Vite proxy üzerinden gider (development)
// Production'da VITE_*_API_URL environment variable'ları kullanılır
const API_URLS = {
    auth: import.meta.env.VITE_AUTH_API_URL || '',
    core: import.meta.env.VITE_CORE_API_URL || '',
    reports: import.meta.env.VITE_REPORTS_API_URL || '',
}

/**
 * Axios instance oluştur
 * @param {string} baseURL - Base URL
 */
const createApiClient = (baseURL) => {
    const client = axios.create({
        baseURL,
        timeout: 30000,
        headers: {
            'Content-Type': 'application/json',
        },
    })

    // Request interceptor - Token ekle
    client.interceptors.request.use(
        (config) => {
            const token = useAuthStore.getState().token
            if (token) {
                config.headers.Authorization = `Bearer ${token}`
            }
            return config
        },
        (error) => Promise.reject(error)
    )

    // Response interceptor - Hata yönetimi
    client.interceptors.response.use(
        (response) => response,
        (error) => {
            // 401 Unauthorized - Token geçersiz, çıkış yap
            if (error.response?.status === 401) {
                useAuthStore.getState().logout()
                // React Router yönlendirmesi için location yerine reject kullan
                // window.location.href = '/login' kaldırıldı - redirect loop'a neden oluyordu
            }
            return Promise.reject(error)
        }
    )

    return client
}

// API clients
const authApi = createApiClient(API_URLS.auth)
const coreApi = createApiClient(API_URLS.core)
const reportsApi = createApiClient(API_URLS.reports)

// =============================================================================
// AUTH SERVICE
// =============================================================================

export const authService = {
    /**
     * Login - E-posta ve şifre ile giriş
     */
    login: async (email, password) => {
        const formData = new URLSearchParams()
        formData.append('username', email)
        formData.append('password', password)

        const response = await authApi.post('/api/v1/auth/token', formData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
        return response.data
    },

    /**
     * Mevcut kullanıcı bilgisi
     */
    getMe: async () => {
        const response = await authApi.get('/api/v1/auth/users/me')
        return response.data
    },

    /**
     * Kullanıcı listesi (Admin)
     */
    getUsers: async (params = {}) => {
        const response = await authApi.get('/api/v1/auth/users', { params })
        return response.data
    },

    /**
     * Kullanıcı oluştur (Admin)
     */
    createUser: async (userData) => {
        const response = await authApi.post('/api/v1/auth/users', userData)
        return response.data
    },

    /**
     * Kullanıcı güncelle (Admin)
     */
    updateUser: async (userId, userData) => {
        const response = await authApi.put(`/api/v1/auth/users/${userId}`, userData)
        return response.data
    },

    /**
     * Kullanıcı sil (Admin)
     */
    deleteUser: async (userId) => {
        await authApi.delete(`/api/v1/auth/users/${userId}`)
    },
}

// =============================================================================
// CORE SERVICE - Müşteriler
// =============================================================================

export const customerService = {
    getAll: async (params = {}) => {
        const response = await coreApi.get('/api/v1/core/customers', { params })
        return response.data
    },

    getById: async (id) => {
        const response = await coreApi.get(`/api/v1/core/customers/${id}`)
        return response.data
    },

    create: async (data) => {
        const response = await coreApi.post('/api/v1/core/customers', data)
        return response.data
    },

    update: async (id, data) => {
        const response = await coreApi.put(`/api/v1/core/customers/${id}`, data)
        return response.data
    },

    delete: async (id) => {
        await coreApi.delete(`/api/v1/core/customers/${id}`)
    },
}

// =============================================================================
// CORE SERVICE - İş Tipleri
// =============================================================================

export const workTypeService = {
    getAll: async (params = {}) => {
        const response = await coreApi.get('/api/v1/core/work-types', { params })
        return response.data
    },

    create: async (data) => {
        const response = await coreApi.post('/api/v1/core/work-types', data)
        return response.data
    },

    update: async (id, data) => {
        const response = await coreApi.put(`/api/v1/core/work-types/${id}`, data)
        return response.data
    },

    delete: async (id) => {
        await coreApi.delete(`/api/v1/core/work-types/${id}`)
    },
}

// =============================================================================
// CORE SERVICE - Projeler
// =============================================================================

export const projectService = {
    getAll: async (params = {}) => {
        const response = await coreApi.get('/api/v1/core/projects', { params })
        return response.data
    },

    getById: async (id) => {
        const response = await coreApi.get(`/api/v1/core/projects/${id}`)
        return response.data
    },

    create: async (data) => {
        const response = await coreApi.post('/api/v1/core/projects', data)
        return response.data
    },

    update: async (id, data) => {
        const response = await coreApi.put(`/api/v1/core/projects/${id}`, data)
        return response.data
    },

    delete: async (id) => {
        await coreApi.delete(`/api/v1/core/projects/${id}`)
    },
}

// =============================================================================
// CORE SERVICE - Zaman Girişleri
// =============================================================================

export const workLogService = {
    /**
     * Kullanıcının kendi girişleri
     */
    getMyLogs: async (params = {}) => {
        const response = await coreApi.get('/api/v1/core/work-logs', { params })
        return response.data
    },

    /**
     * Tüm girişler (Admin)
     */
    getAllLogs: async (params = {}) => {
        const response = await coreApi.get('/api/v1/core/work-logs/all', { params })
        return response.data
    },

    /**
     * Yeni giriş oluştur
     */
    create: async (data) => {
        const response = await coreApi.post('/api/v1/core/work-logs', data)
        return response.data
    },

    /**
     * Giriş güncelle
     */
    update: async (id, data) => {
        const response = await coreApi.put(`/api/v1/core/work-logs/${id}`, data)
        return response.data
    },

    /**
     * Giriş sil
     */
    delete: async (id) => {
        await coreApi.delete(`/api/v1/core/work-logs/${id}`)
    },
}

// =============================================================================
// CORE SERVICE - Activity Types
// =============================================================================

export const activityTypeService = {
    getAll: async (params = {}) => {
        const response = await coreApi.get('/api/v1/core/activity-types', { params })
        return response.data
    },

    create: async (data) => {
        const response = await coreApi.post('/api/v1/core/activity-types', data)
        return response.data
    },

    update: async (id, data) => {
        const response = await coreApi.put(`/api/v1/core/activity-types/${id}`, data)
        return response.data
    },

    delete: async (id) => {
        await coreApi.delete(`/api/v1/core/activity-types/${id}`)
    },
}

// =============================================================================
// CORE SERVICE - Platforms
// =============================================================================

export const platformService = {
    getAll: async (params = {}) => {
        const response = await coreApi.get('/api/v1/core/platforms', { params })
        return response.data
    },

    create: async (data) => {
        const response = await coreApi.post('/api/v1/core/platforms', data)
        return response.data
    },

    update: async (id, data) => {
        const response = await coreApi.put(`/api/v1/core/platforms/${id}`, data)
        return response.data
    },

    delete: async (id) => {
        await coreApi.delete(`/api/v1/core/platforms/${id}`)
    },
}

// =============================================================================
// CORE SERVICE - Work Lines
// =============================================================================

export const workLineService = {
    getAll: async (params = {}) => {
        const response = await coreApi.get('/api/v1/core/work-lines', { params })
        return response.data
    },

    create: async (data) => {
        const response = await coreApi.post('/api/v1/core/work-lines', data)
        return response.data
    },

    update: async (id, data) => {
        const response = await coreApi.put(`/api/v1/core/work-lines/${id}`, data)
        return response.data
    },

    delete: async (id) => {
        await coreApi.delete(`/api/v1/core/work-lines/${id}`)
    },
}

// =============================================================================
// CORE SERVICE - Timesheets
// =============================================================================

export const timesheetService = {
    getPeriodStatus: async (date) => {
        const response = await coreApi.get('/api/v1/core/timesheets/period-status', {
            params: { date }
        })
        return response.data
    },

    submitTimesheet: async (data) => {
        const response = await coreApi.post('/api/v1/core/timesheets/submit', data)
        return response.data
    },
}

// =============================================================================
// REPORTS SERVICE
// =============================================================================

export const reportsService = {
    /**
     * Dashboard verileri
     */
    getDashboard: async (params = {}) => {
        const response = await coreApi.get('/api/v1/core/dashboard', { params })
        return response.data
    },

    /**
     * CSV export (dosya indirme)
     */
    exportExcel: async (params = {}, customFilename = null) => {
        try {
            const response = await coreApi.get('/api/v1/core/reports/export/excel/v1', {
                params,
                responseType: 'blob',
            })

            // Check if response is actually JSON error (unexpected 401/500 treated as blob)
            if (response.data.type === 'application/json') {
                const text = await response.data.text()
                const errorData = JSON.parse(text)
                throw new Error(errorData.detail || errorData.error?.message || 'Download failed')
            }

            // Create blob with explicit CSV type
            const blob = new Blob([response.data], {
                type: 'text/csv;charset=utf-8;'
            })
            const url = window.URL.createObjectURL(blob)

            // Filename generation
            let filename = customFilename

            if (!filename) {
                // Fallback to date based
                const dateStr = new Date().toISOString().split('T')[0]
                filename = `hermes_rapor_${dateStr}.csv`
            }

            // Ensure extension
            if (!filename.endsWith('.csv')) {
                filename = filename.replace(/\.[^/.]+$/, "") + ".csv"
            }

            console.log(`DEBUG: Final filename: ${filename}`)

            // Manual DOM manipulation
            const link = document.createElement('a')
            link.href = url
            link.setAttribute('download', filename)
            link.style.visibility = 'hidden'
            link.style.position = 'absolute'
            document.body.appendChild(link)
            link.click()

            setTimeout(() => {
                document.body.removeChild(link)
                window.URL.revokeObjectURL(url)
            }, 2000)
        } catch (error) {
            console.error('Export failed:', error)
            throw error
        }
    },
}

export default {
    authService,
    customerService,
    workTypeService,
    projectService,
    workLogService,
    activityTypeService,
    platformService,
    workLineService,
    timesheetService,
    reportsService,
}

