/**
 * =============================================================================
 * HERMES PLATFORM - API Service
 * =============================================================================
 * Axios tabanlı API istemcisi. Tüm backend istekleri bu servis üzerinden yapılır.
 * Token'ı otomatik ekler, hata yönetimi sağlar.
 * =============================================================================
 */

// =============================================================================
// Sprint 1 (§10) GECIS DURUMU: bu dosya artik COMPATIBILITY FACADE'dir.
//   - HTTP istemcisi/interceptor'lar: src/api/httpClient.js (tek kaynak)
//   - Tasinan domainler: authService → src/api/authApi.js,
//     rbacService → src/api/rbacApi.js (asagida re-export edilir)
//   - Kalan domainler sonraki sprintlerde ayni desenle tasinir; tuketici
//     import'lari o zamana kadar KIRILMAZ.
// =============================================================================
import { coreClient } from '../api/httpClient'
import { authService } from '../api/authApi'
import { rbacService } from '../api/rbacApi'
import { downloadBlobResponse } from './fileDownload'

export { authService, rbacService }

const coreApi = coreClient

// =============================================================================
// AUTH SERVICE
// =============================================================================


// =============================================================================
// AUTH SERVICE - RBAC (R3)
// =============================================================================
// Rol yönetimi + izin çözümü. can() için tek kaynak: getMyPermissions.


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
        // Dizi parametreleri FastAPI List[] icin TEKRARLI anahtar olarak
        // gonderilir; bu davranis korunuyor.
        const {
            user_ids, customer_ids, project_ids, work_type_ids, platform_ids,
            ...scalarParams
        } = params
        const urlParams = new URLSearchParams()
        Object.entries(scalarParams).forEach(([k, v]) => {
            if (v !== null && v !== undefined) urlParams.append(k, v)
        })
        for (const [key, list] of Object.entries({
            user_ids, customer_ids, project_ids, work_type_ids, platform_ids,
        })) {
            if (Array.isArray(list)) list.forEach((id) => urlParams.append(key, id))
        }

        const response = await coreApi.get(
            `/api/v1/core/reports/export/excel/v1?${urlParams.toString()}`,
            { responseType: 'blob' }
        )
        // Indirme, sizinti/dosya-adi/hata-blob kurallarini tek yerde
        // uygulayan ortak yardimciya devredildi.
        const dateStr = new Date().toISOString().split('T')[0]
        return downloadBlobResponse(
            response,
            customFilename || `hermes_rapor_${dateStr}.csv`
        )
    },

    /**
     * Rapor 2: Aylık Detaylı Global Rapor
     */
    exportGlobalDetailed: async (month) => {
        const response = await coreApi.get('/api/v1/core/reports/export/global/detailed_v2', {
            params: { month }, // YYYY-MM
            responseType: 'blob',
        })
        // Hata YUKARI birakilir: cagiran taraf kullaniciya anlamli mesaj
        // gosterir. Burada `console.error` ile ham API hatasini loglamak
        // teknik icerigi konsola sizdiriyordu.
        return downloadBlobResponse(response, `hermes_global_rapor_${month}.csv`)
    },

    /**
     * Rapor 3: Customer x User Matrix
     */
    exportGlobalMatrix: async (startDate, endDate) => {
        const response = await coreApi.get('/api/v1/core/reports/export/global/matrix', {
            params: { start_date: startDate, end_date: endDate },
            responseType: 'blob',
        })
        return downloadBlobResponse(
            response, `hermes_matrix_rapor_${startDate}_${endDate}.csv`
        )
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

// =============================================================================
// CORE SERVICE - Tasks Module
// =============================================================================

export const taskPermissionService = {
    /** Current user's task capability + assignable users.
        RBAC cutover (2026-08-04): admin access/assign yonetimi ROLLERE
        tasindi — buradaki legacy admin metodlari kaldirildi (backend
        uclari 410 Gone doner). */
    getMyPermissions: async () => {
        const response = await coreApi.get('/api/v1/core/tasks/permissions/me')
        return response.data
    },
}

// =============================================================================
// CORE SERVICE - API Management (Admin → API Management)
// =============================================================================
// Dis entegrasyon client'lari + token yasam dongusu + request loglari.
// Token plaintext'i YALNIZCA create/rotate yanitinda gelir ve hicbir yerde
// cache'lenmez/saklanmaz (modal state'i kapaninca temizlenir).

export const apiManagementService = {
    listClients: async () => {
        const response = await coreApi.get('/api/v1/core/admin/api-clients')
        return response.data
    },
    createClient: async (data) => {
        const response = await coreApi.post(
            '/api/v1/core/admin/api-clients',
            data
        )
        return response.data
    },
    updateClient: async (clientId, data) => {
        const response = await coreApi.patch(
            `/api/v1/core/admin/api-clients/${clientId}`,
            data
        )
        return response.data
    },
    disableClient: async (clientId) => {
        const response = await coreApi.delete(
            `/api/v1/core/admin/api-clients/${clientId}`
        )
        return response.data
    },
    replaceBindings: async (clientId, access) => {
        const response = await coreApi.put(
            `/api/v1/core/admin/api-clients/${clientId}/bindings`,
            { access }
        )
        return response.data
    },
    createToken: async (clientId, data = {}) => {
        const response = await coreApi.post(
            `/api/v1/core/admin/api-clients/${clientId}/tokens`,
            data
        )
        return response.data
    },
    listTokens: async (clientId) => {
        const response = await coreApi.get('/api/v1/core/admin/api-tokens', {
            params: clientId ? { client_id: clientId } : {},
        })
        return response.data
    },
    revokeToken: async (tokenId) => {
        const response = await coreApi.post(
            `/api/v1/core/admin/api-tokens/${tokenId}/revoke`
        )
        return response.data
    },
    rotateToken: async (tokenId) => {
        const response = await coreApi.post(
            `/api/v1/core/admin/api-tokens/${tokenId}/rotate`
        )
        return response.data
    },
    updateTokenExpiry: async (tokenId, expiresAt) => {
        const response = await coreApi.patch(
            `/api/v1/core/admin/api-tokens/${tokenId}`,
            { expires_at: expiresAt }
        )
        return response.data
    },
    listRequestLogs: async (params = {}) => {
        const response = await coreApi.get(
            '/api/v1/core/admin/api-request-logs',
            { params }
        )
        return response.data
    },
    /** Public capabilities — scope katalogu icin (auth gerekmez). */
    getPublicCapabilities: async () => {
        const response = await coreApi.get('/api/public/v1/capabilities')
        return response.data
    },
    /** Portal header'i icin OpenAPI info blogu (surum rozeti). */
    getPublicOpenApiInfo: async () => {
        const response = await coreApi.get('/api/public/v1/openapi.json')
        return response.data?.info || {}
    },
    /** Portal "API Status" karti — canli health (auth gerekmez). */
    getPublicHealth: async () => {
        const response = await coreApi.get('/api/public/v1/health')
        return response.data
    },
    /** Stage 3F: retention politikasi + son temizlik ozeti. */
    getCleanupStatus: async () => {
        const response = await coreApi.get('/api/v1/core/admin/api-cleanup')
        return response.data
    },
    /** Stage 3F: manuel temizlik (dry_run=true hicbir sey silmez). */
    runCleanup: async (dryRun = false) => {
        const response = await coreApi.post(
            '/api/v1/core/admin/api-cleanup/run',
            null,
            { params: { dry_run: dryRun } }
        )
        return response.data
    },
}

export const taskNotificationSettingsService = {
    /** Admin: one row per work-item type (task/issue/suggestion) with the
     * e-mail rules; unconfigured types come back with defaults (all ON). */
    list: async () => {
        const response = await coreApi.get(
            '/api/v1/core/admin/notification-settings'
        )
        return response.data
    },

    /** Admin: upsert one type's e-mail rules. */
    update: async (taskType, data) => {
        const response = await coreApi.put(
            `/api/v1/core/admin/notification-settings/${taskType}`,
            data
        )
        return response.data
    },
}

export const taskAssignmentService = {
    /** Admin: list all assigner -> assignee mappings for a scope (task|issue). */
    list: async (scope = 'task') => {
        const response = await coreApi.get(
            '/api/v1/core/admin/task-assignment-relations',
            { params: { scope } }
        )
        return response.data
    },

    /** Admin: bulk create mappings. */
    create: async (data) => {
        const response = await coreApi.post(
            '/api/v1/core/admin/task-assignment-relations',
            data
        )
        return response.data
    },

    /** Admin: delete a mapping. */
    delete: async (relationId) => {
        const response = await coreApi.delete(
            `/api/v1/core/admin/task-assignment-relations/${relationId}`
        )
        return response.data
    },
}

// =============================================================================
// CORE SERVICE - Task Assignment Group Relations (assigner -> group)
// =============================================================================

export const taskAssignmentGroupService = {
    /** Admin: list all assigner -> group mappings for a scope (task|issue). */
    list: async (scope = 'task') => {
        const response = await coreApi.get(
            '/api/v1/core/admin/task-assignment-group-relations',
            { params: { scope } }
        )
        return response.data
    },

    /** Admin: create one mapping. Idempotent server-side. */
    create: async (data) => {
        const response = await coreApi.post(
            '/api/v1/core/admin/task-assignment-group-relations',
            data
        )
        return response.data
    },

    /** Admin: delete one mapping. */
    delete: async (relationId) => {
        const response = await coreApi.delete(
            `/api/v1/core/admin/task-assignment-group-relations/${relationId}`
        )
        return response.data
    },
}

export const taskSubProjectService = {
    /**
     * List sub projects (any task user / admin).
     * params: { customer_id?, project_id?, include_inactive? }
     */
    list: async (params = {}) => {
        const response = await coreApi.get('/api/v1/core/tasks/sub-projects', { params })
        return response.data
    },

    /** Admin: create a task sub project. */
    create: async (data) => {
        const response = await coreApi.post('/api/v1/core/admin/tasks/sub-projects', data)
        return response.data
    },

    /**
     * Assigner: create a sub project inline at task-assignment time.
     * Same permission gate as Create Task (Task Access + Assign Tasks);
     * no admin required. Used by the Create Task modal's "+ New" control.
     */
    createInline: async (data) => {
        const response = await coreApi.post('/api/v1/core/tasks/sub-projects', data)
        return response.data
    },

    /** Admin: update a sub project. */
    update: async (subProjectId, data) => {
        const response = await coreApi.put(
            `/api/v1/core/admin/tasks/sub-projects/${subProjectId}`,
            data
        )
        return response.data
    },

    /** Admin: delete a sub project. Refuses with 409 if used by tasks. */
    delete: async (subProjectId) => {
        const response = await coreApi.delete(
            `/api/v1/core/admin/tasks/sub-projects/${subProjectId}`
        )
        return response.data
    },
}

// =============================================================================
// CORE SERVICE - User Groups (general)
// =============================================================================

export const userGroupService = {
    /** Admin: list active user groups (with member counts). */
    list: async (params = {}) => {
        const response = await coreApi.get('/api/v1/core/admin/user-groups', { params })
        return response.data
    },

    /** Admin: create a new user group. */
    create: async (data) => {
        const response = await coreApi.post('/api/v1/core/admin/user-groups', data)
        return response.data
    },

    /** Admin: update group fields / active. */
    update: async (groupId, data) => {
        const response = await coreApi.put(
            `/api/v1/core/admin/user-groups/${groupId}`,
            data
        )
        return response.data
    },

    /** Admin: soft "delete" — sets is_active=false + deactivated_at. */
    deactivate: async (groupId) => {
        const response = await coreApi.delete(
            `/api/v1/core/admin/user-groups/${groupId}`
        )
        return response.data
    },

    /** Admin: list members of a group. */
    listMembers: async (groupId) => {
        const response = await coreApi.get(
            `/api/v1/core/admin/user-groups/${groupId}/members`
        )
        return response.data
    },

    /** Admin: add a user to the group. */
    addMember: async (groupId, data) => {
        const response = await coreApi.post(
            `/api/v1/core/admin/user-groups/${groupId}/members`,
            data
        )
        return response.data
    },

    /** Admin: update a member's title. */
    updateMember: async (groupId, memberId, data) => {
        const response = await coreApi.put(
            `/api/v1/core/admin/user-groups/${groupId}/members/${memberId}`,
            data
        )
        return response.data
    },

    /** Admin: remove membership (hard delete of the row only). */
    removeMember: async (groupId, memberId) => {
        const response = await coreApi.delete(
            `/api/v1/core/admin/user-groups/${groupId}/members/${memberId}`
        )
        return response.data
    },
}

export const taskService = {
    /** List tasks visible to the current user with optional filters. */
    list: async (params = {}) => {
        const response = await coreApi.get('/api/v1/core/tasks', { params })
        return response.data
    },

    /** Create a new task (assigner / admin only). */
    create: async (data) => {
        const response = await coreApi.post('/api/v1/core/tasks', data)
        return response.data
    },

    /**
     * Create the same task for multiple assignees (users and/or groups)
     * in one request. data: { ...taskFields, assignee_user_ids: [],
     * assignee_group_ids: [] }. Returns the created task rows.
     */
    createBulk: async (data) => {
        const response = await coreApi.post('/api/v1/core/tasks/bulk', data)
        return response.data
    },

    /**
     * Fan a single create-task action out to every active member of a
     * group. Returns { assignment_batch_id, assignee_group_id, tasks }.
     */
    createForGroup: async (data) => {
        const response = await coreApi.post('/api/v1/core/tasks/group', data)
        return response.data
    },

    /**
     * Minimal info for groups the current user may target with
     * Create-Task-for-Group. Returns [{id, name, member_count}].
     */
    listAssignableGroups: async (scope = 'task') => {
        const response = await coreApi.get('/api/v1/core/tasks/assignable-groups', {
            params: { scope },
        })
        return response.data
    },

    /** Get a single task by ID. */
    getById: async (taskId) => {
        const response = await coreApi.get(`/api/v1/core/tasks/${taskId}`)
        return response.data
    },

    /** Update a task's core fields (assigner / admin only). */
    update: async (taskId, data) => {
        const response = await coreApi.put(`/api/v1/core/tasks/${taskId}`, data)
        return response.data
    },

    /** Update task status (assignee/assigner/admin). */
    updateStatus: async (taskId, status) => {
        const response = await coreApi.patch(`/api/v1/core/tasks/${taskId}/status`, {
            status,
        })
        return response.data
    },

    /** Convenience: mark complete / reopen. */
    setCompleted: async (taskId, completed) => {
        const response = await coreApi.patch(`/api/v1/core/tasks/${taskId}/complete`, {
            completed,
        })
        return response.data
    },

    /** Reject a task (assignee/assigner/admin). */
    reject: async (taskId) => {
        const response = await coreApi.patch(`/api/v1/core/tasks/${taskId}/reject`)
        return response.data
    },

    /** Newest-first activity feed for a task. */
    listActivity: async (taskId) => {
        const response = await coreApi.get(
            `/api/v1/core/tasks/${taskId}/activity`
        )
        return response.data
    },

    /**
     * Visibility-bound task search. Non-admin callers only ever get
     * tasks where they are the assignee or assigner; the same gate
     * the list endpoint applies.
     * params: { q, status?, priority?, customer_id?, project_id?,
     *           assignee_user_id?, assigner_user_id?, due_from?,
     *           due_to?, limit? }
     */
    search: async (params = {}) => {
        const response = await coreApi.get('/api/v1/core/tasks/search', {
            params,
        })
        return response.data
    },

    /** Oldest-first comments thread for a task. */
    listComments: async (taskId) => {
        const response = await coreApi.get(
            `/api/v1/core/tasks/${taskId}/comments`
        )
        return response.data
    },
    /** Add a comment to a task. */
    createComment: async (taskId, body) => {
        const response = await coreApi.post(
            `/api/v1/core/tasks/${taskId}/comments`,
            { body }
        )
        return response.data
    },
    /** Edit own comment (or any, if admin). */
    updateComment: async (taskId, commentId, body) => {
        const response = await coreApi.put(
            `/api/v1/core/tasks/${taskId}/comments/${commentId}`,
            { body }
        )
        return response.data
    },
    /** Soft-delete own comment (or any, if admin). */
    deleteComment: async (taskId, commentId) => {
        const response = await coreApi.delete(
            `/api/v1/core/tasks/${taskId}/comments/${commentId}`
        )
        return response.data
    },

    /** Soft delete — sets archived_at; row is preserved. */
    delete: async (taskId) => {
        const response = await coreApi.delete(`/api/v1/core/tasks/${taskId}`)
        return response.data
    },
}

// =============================================================================
// MEETINGS SERVICE (Microsoft Teams / Outlook integration)
// =============================================================================

export const meetingService = {
    /**
     * Visibility-bound list. Non-admin sees only meetings where they
     * are a mapped attendee; admin can pass user_id to view another
     * user's meetings.
     * params: { start_date?, end_date?, user_id?, include_cancelled? }
     */
    list: async (params = {}) => {
        const response = await coreApi.get('/api/v1/core/meetings', { params })
        return response.data
    },

    /** Single meeting fetch (visibility-bound, 404 on denial). */
    get: async (meetingId) => {
        const response = await coreApi.get(
            `/api/v1/core/meetings/${meetingId}`
        )
        return response.data
    },

    /**
     * Any authenticated user — sync the caller's OWN calendar for a
     * date range. No admin rights and no auth-service round trip; the
     * Meetings page fires this on load so meetings appear without a
     * manual admin sync. Fails gracefully (result.ok / result.error).
     */
    syncMe: async ({ start_date, end_date } = {}) => {
        const response = await coreApi.post(
            '/api/v1/core/meetings/sync-me',
            { start_date, end_date }
        )
        return response.data
    },

    /**
     * Admin only — sync ONE specific user's calendar for a date range.
     * Pass the target user's id + email (the Meetings selector already
     * has both from the user lookup). No auth-service round trip; fails
     * gracefully via result.ok / result.error.
     */
    syncUser: async ({ user_id, email, start_date, end_date } = {}) => {
        const response = await coreApi.post(
            '/api/v1/core/meetings/sync-user',
            { user_id, email, start_date, end_date }
        )
        return response.data
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
    reportsService,
    taskPermissionService,
    taskNotificationSettingsService,
    taskAssignmentService,
    taskAssignmentGroupService,
    taskSubProjectService,
    taskService,
    userGroupService,
    meetingService,
}

