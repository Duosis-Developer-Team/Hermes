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
 *
 * [KRİTİK-6] withCredentials: true — tarayıcı, HttpOnly cookie'yi
 * her istekte otomatik olarak backend'e gönderir.
 * Manuel token ekleme / Authorization header'ı KALDIRILDI.
 *
 * @param {string} baseURL - Base URL
 */
const createApiClient = (baseURL) => {
    const client = axios.create({
        baseURL,
        timeout: 30000,
        withCredentials: true, // HttpOnly cookie otomatik gönderilir
        headers: {
            'Content-Type': 'application/json',
        },
    })

    // Request interceptor — token ekleme yok; cookie otomatik gönderilir
    client.interceptors.request.use(
        (config) => config,
        (error) => Promise.reject(error)
    )

    // Response interceptor — 401'de UI state'ini temizle
    client.interceptors.response.use(
        (response) => response,
        (error) => {
            if (error.response?.status === 401) {
                // Cookie backend tarafından zaten geçersiz/süresi dolmuş.
                // Yalnızca UI state'ini temizle; cookie'yi silmek için /auth/logout çağrılmalı.
                useAuthStore.getState().logout()
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

        const response = await authApi.post('/api/v1/auth/token', formData, {
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
        const response = await authApi.post('/api/v1/auth/microsoft', data)
        return response.data
    },

    /**
     * Oturumu kapat.
     * Backend cookie'yi siler; store logout() ile UI state temizlenir.
     */
    logout: async () => {
        await authApi.post('/api/v1/auth/logout')
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
     * @param {object} data - log payload
     * @param {string|null} targetUserId - admin: create on behalf of this user
     */
    create: async (data, targetUserId = null) => {
        const params = targetUserId ? { target_user_id: targetUserId } : {}
        const response = await coreApi.post('/api/v1/core/work-logs', data, { params })
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

    /**
     * Proje bazında toplam billable saat özeti (Admin)
     * @returns {{ success: boolean, data: { [projectId: string]: number } }}
     */
    getBillableSummary: async () => {
        const response = await coreApi.get('/api/v1/core/work-logs/billable-summary')
        return response.data
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
            // Build URLSearchParams to handle repeated array keys correctly
            const { user_ids, customer_ids, project_ids, work_type_ids, platform_ids, ...scalarParams } = params
            const urlParams = new URLSearchParams()
            Object.entries(scalarParams).forEach(([k, v]) => {
                if (v !== null && v !== undefined) urlParams.append(k, v)
            })
            if (Array.isArray(user_ids) && user_ids.length > 0) {
                user_ids.forEach(id => urlParams.append('user_ids', id))
            }
            if (Array.isArray(customer_ids) && customer_ids.length > 0) {
                customer_ids.forEach(id => urlParams.append('customer_ids', id))
            }
            if (Array.isArray(project_ids) && project_ids.length > 0) {
                project_ids.forEach(id => urlParams.append('project_ids', id))
            }
            if (Array.isArray(work_type_ids) && work_type_ids.length > 0) {
                work_type_ids.forEach(id => urlParams.append('work_type_ids', id))
            }
            if (Array.isArray(platform_ids) && platform_ids.length > 0) {
                platform_ids.forEach(id => urlParams.append('platform_ids', id))
            }

            const response = await coreApi.get(
                `/api/v1/core/reports/export/excel/v1?${urlParams.toString()}`,
                { responseType: 'blob' }
            )

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
    /**
     * Rapor 2: Aylık Detaylı Global Rapor
     */
    exportGlobalDetailed: async (month) => {
        try {
            const response = await coreApi.get('/api/v1/core/reports/export/global/detailed_v2', {
                params: { month }, // YYYY-MM
                responseType: 'blob',
            })
            await handleFileDownload(response, `hermes_global_rapor_${month}.csv`)
        } catch (error) {
            console.error('Export failed:', error)
            throw error
        }
    },

    /**
     * Rapor 3: Customer x User Matrix
     */
    exportGlobalMatrix: async (startDate, endDate) => {
        try {
            const response = await coreApi.get('/api/v1/core/reports/export/global/matrix', {
                params: { start_date: startDate, end_date: endDate },
                responseType: 'blob',
            })
            await handleFileDownload(response, `hermes_matrix_rapor_${startDate}_${endDate}.csv`)
        } catch (error) {
            console.error('Export failed:', error)
            throw error
        }
    },

    // JSON Data Endpoints for Dashboard
    getJsonUserLogs: async (params = {}) => {
        const { user_ids, customer_ids, project_ids, work_type_ids, platform_ids, ...rest } = params
        const urlParams = new URLSearchParams()
        // Scalar params
        Object.entries(rest).forEach(([key, value]) => {
            if (value !== null && value !== undefined) urlParams.append(key, value)
        })
        // Multi-value array params (repeated keys for FastAPI List[] support)
        if (Array.isArray(user_ids) && user_ids.length > 0) {
            user_ids.forEach(id => urlParams.append('user_ids', id))
        }
        if (Array.isArray(customer_ids) && customer_ids.length > 0) {
            customer_ids.forEach(id => urlParams.append('customer_ids', id))
        }
        if (Array.isArray(project_ids) && project_ids.length > 0) {
            project_ids.forEach(id => urlParams.append('project_ids', id))
        }
        if (Array.isArray(work_type_ids) && work_type_ids.length > 0) {
            work_type_ids.forEach(id => urlParams.append('work_type_ids', id))
        }
        if (Array.isArray(platform_ids) && platform_ids.length > 0) {
            platform_ids.forEach(id => urlParams.append('platform_ids', id))
        }
        const response = await coreApi.get(`/api/v1/core/reports/json/user-logs?${urlParams.toString()}`)
        return response.data
    },

    getJsonGlobalDetailed: async (month) => {
        const response = await coreApi.get('/api/v1/core/reports/json/global-detailed', {
            params: { month }
        })
        return response.data
    },

    getJsonMatrix: async (startDate, endDate) => {
        const response = await coreApi.get('/api/v1/core/reports/json/matrix', {
            params: { start_date: startDate, end_date: endDate }
        })
        return response.data
    },
}

// Helper for file download
const handleFileDownload = async (response, defaultFilename) => {
    // Check if response is actually JSON error
    if (response.data.type === 'application/json') {
        const text = await response.data.text()
        const errorData = JSON.parse(text)
        throw new Error(errorData.detail || errorData.error?.message || 'Download failed')
    }

    // Create blob
    const blob = new Blob([response.data], {
        type: 'text/csv;charset=utf-8;'
    })
    const url = window.URL.createObjectURL(blob)

    // Filename from header or default
    let filename = defaultFilename
    const disposition = response.headers['content-disposition']
    if (disposition && disposition.indexOf('filename=') !== -1) {
        const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition)
        if (matches != null && matches[1]) {
            filename = matches[1].replace(/['"]/g, '')
        }
    }

    // Download link
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', filename)
    document.body.appendChild(link)
    link.click()

    setTimeout(() => {
        document.body.removeChild(link)
        window.URL.revokeObjectURL(url)
    }, 2000)
}

// =============================================================================
// CORE SERVICE - Plan Times
// =============================================================================

export const planTimeService = {
    /**
     * Admin: Yeni plan time oluştur ve kullanıcılara ata
     * @param {{ customer_id, project_id, start_date, end_date, start_time, end_time, recurrence, description, user_ids }} data
     */
    create: async (data) => {
        const response = await coreApi.post('/api/v1/core/plan-times', data)
        return response.data
    },

    /**
     * Kullanıcının kendi plan time atamalarını getir (haftalık takvim için)
     * @param {{ start_date?: string, end_date?: string }} params
     */
    getMyPlanTimes: async (params = {}) => {
        const response = await coreApi.get('/api/v1/core/plan-times/my', { params })
        return response.data
    },

    /**
     * Admin: Tüm plan time olaylarını getir
     */
    getAll: async (params = {}) => {
        const response = await coreApi.get('/api/v1/core/plan-times', { params })
        return response.data
    },

    /**
     * Kullanıcının plan time olayına yanıtı (accept/reject)
     * @param {string} planTimeId
     * @param {'accepted'|'rejected'} status
     */
    respond: async (planTimeId, status) => {
        const response = await coreApi.patch(`/api/v1/core/plan-times/${planTimeId}/respond`, { status })
        return response.data
    },

    /**
     * Admin: Plan time güncelle
     */
    update: async (planTimeId, data) => {
        const response = await coreApi.patch(`/api/v1/core/plan-times/${planTimeId}`, data)
        return response.data
    },

    /**
     * Admin: Plan time sil
     */
    delete: async (planTimeId) => {
        await coreApi.delete(`/api/v1/core/plan-times/${planTimeId}`)
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

