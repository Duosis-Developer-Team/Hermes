/**
 * =============================================================================
 * HERMES - Ticket API istemcisi (Sprint: Ticket Hub)
 * =============================================================================
 * Tek HTTP kaynagi `src/api/httpClient.js`; burada yalnizca ticket
 * uclarinin sekli yasar.
 *
 * IKI YUZEY, TEK KATALOG:
 *   ticketHubService     → Duosis agent hub'i  (/tickets/...)
 *   supportPortalService → musteri portali     (/support/...)
 *   ticketAdminService   → entegrasyon yonetimi (/tickets/admin/...)
 *
 * Hangi yuzeyin acilacagina SUNUCU karar verir (`/tickets/context`);
 * frontend tenant kimligi tasimaz ve "ben Duosis miyim?" diye TAHMIN
 * ETMEZ.
 */
import { coreClient } from './httpClient'

const CORE = '/api/v1/core'

/** Sunucunun dondugu makine-okur hata kodu (X-Error-Code basligi).
 *  409'lar arasinda ayrim yapabilmek icin gereklidir: surum catismasi
 *  ile route eksikligi cok farkli iki kullanici deneyimidir. */
export const ticketErrorCode = (error) =>
    error?.response?.headers?.['x-error-code'] || null

export const ticketContextService = {
    get: async () => {
        const { data } = await coreClient.get(`${CORE}/tickets/context`)
        return data
    },
}

export const ticketHubService = {
    listApplications: async () => {
        const { data } = await coreClient.get(`${CORE}/tickets/applications`)
        return data
    },
    listQueues: async (params = {}) => {
        const { data } = await coreClient.get(`${CORE}/tickets/queues`, { params })
        return data
    },
    list: async (params = {}) => {
        const { data } = await coreClient.get(`${CORE}/tickets`, { params })
        return data
    },
    get: async (id) => {
        const { data } = await coreClient.get(`${CORE}/tickets/${id}`)
        return data
    },
    audit: async (id) => {
        const { data } = await coreClient.get(`${CORE}/tickets/${id}/audit`)
        return data
    },
    routingGroups: async () => {
        const { data } = await coreClient.get(`${CORE}/tickets/routing-groups`)
        return data
    },
    groupMembers: async (groupId) => {
        const { data } = await coreClient.get(
            `${CORE}/tickets/groups/${groupId}/members`,
        )
        return data
    },
    addMessage: async (id, payload) => {
        const { data } = await coreClient.post(
            `${CORE}/tickets/${id}/messages`, payload,
        )
        return data
    },
    transition: async (id, payload) => {
        const { data } = await coreClient.post(
            `${CORE}/tickets/${id}/transition`, payload,
        )
        return data
    },
    assignGroup: async (id, payload) => {
        const { data } = await coreClient.post(
            `${CORE}/tickets/${id}/assign-group`, payload,
        )
        return data
    },
    assignUser: async (id, payload) => {
        const { data } = await coreClient.post(
            `${CORE}/tickets/${id}/assign-user`, payload,
        )
        return data
    },
    /** PM rework A6: ticket'tan is kalemi acar; yanit guncel ticket detayi. */
    createWorkItem: async (id, payload) => {
        const { data } = await coreClient.post(`${CORE}/tickets/${id}/work-items`, payload)
        return data
    },
    listWorkItems: async (id) => {
        const { data } = await coreClient.get(`${CORE}/tickets/${id}/work-items`)
        return data
    },
    setPriority: async (id, payload) => {
        const { data } = await coreClient.post(
            `${CORE}/tickets/${id}/priority`, payload,
        )
        return data
    },
    resolve: async (id, payload) => {
        const { data } = await coreClient.post(
            `${CORE}/tickets/${id}/resolve`, payload,
        )
        return data
    },
    reopen: async (id, payload) => {
        const { data } = await coreClient.post(
            `${CORE}/tickets/${id}/reopen`, payload,
        )
        return data
    },
    // NOT: agent tarafinda "kapat" ucu YOKTUR. Durum matrisinde
    // `resolved → closed` kenari REQUESTER ve SYSTEM (7 gunluk
    // scheduler) rolleridir; agent cozer, musteri onaylar. Kapali bir
    // ticket'i yeniden acmak admin yetkisidir (`reopen`).
    downloadUrl: (ticketId, attachmentId) =>
        `${CORE}/tickets/${ticketId}/attachments/${attachmentId}/download`,
    /** Iki adimli yukleme: once metadata oturumu, sonra HAM icerik.
     *  Icerik `multipart` DEGIL duz gonderilir; sunucu magic-byte ile
     *  gercek turu KENDISI tespit eder (beyan edilene guvenilmez). */
    openAttachmentSession: async (params) => {
        const { data } = await coreClient.post(
            `${CORE}/tickets/attachments`, null, { params },
        )
        return data
    },
    uploadAttachmentContent: async (attachmentId, file) => {
        const { data } = await coreClient.post(
            `${CORE}/tickets/attachments/${attachmentId}/content`, file,
            { headers: { 'Content-Type': file.type || 'application/octet-stream' } },
        )
        return data
    },
}

/** Talep agi: birden fazla saglayicisi olan tenant'ta portal cagrilari
 *  `provider` tasir (sunucu baglanti kumesine karsi dogrular). Tek
 *  saglayicida verilmeyebilir. */
const withProvider = (provider, params = {}) =>
    (provider ? { ...params, provider } : params)

export const supportPortalService = {
    list: async (params = {}) => {
        const { data } = await coreClient.get(`${CORE}/support/tickets`, { params })
        return data
    },
    get: async (id, provider) => {
        const { data } = await coreClient.get(
            `${CORE}/support/tickets/${id}`, { params: withProvider(provider) },
        )
        return data
    },
    /** Idempotency-Key ZORUNLU DEGIL ama gonderiyoruz: ag hatasinda
     *  yapilan retry ikinci bir ticket ACMASIN. */
    create: async (payload, idempotencyKey, provider) => {
        const { data } = await coreClient.post(
            `${CORE}/support/tickets`, payload,
            {
                params: withProvider(provider),
                ...(idempotencyKey
                    ? { headers: { 'Idempotency-Key': idempotencyKey } }
                    : {}),
            },
        )
        return data
    },
    reply: async (id, payload, provider) => {
        const { data } = await coreClient.post(
            `${CORE}/support/tickets/${id}/messages`, payload,
            { params: withProvider(provider) },
        )
        return data
    },
    reopen: async (id, payload, provider) => {
        const { data } = await coreClient.post(
            `${CORE}/support/tickets/${id}/reopen`, payload,
            { params: withProvider(provider) },
        )
        return data
    },
    confirmClose: async (id, payload, provider) => {
        const { data } = await coreClient.post(
            `${CORE}/support/tickets/${id}/confirm-close`, payload,
            { params: withProvider(provider) },
        )
        return data
    },
    cancel: async (id, payload, provider) => {
        const { data } = await coreClient.post(
            `${CORE}/support/tickets/${id}/cancel`, payload,
            { params: withProvider(provider) },
        )
        return data
    },
    downloadUrl: (ticketId, attachmentId, provider) =>
        `${CORE}/support/tickets/${ticketId}/attachments/${attachmentId}/download`
        + (provider ? `?provider=${encodeURIComponent(provider)}` : ''),
    openAttachmentSession: async (params) => {
        const { data } = await coreClient.post(
            `${CORE}/support/attachments`, null, { params },
        )
        return data
    },
    uploadAttachmentContent: async (attachmentId, file, provider) => {
        const { data } = await coreClient.post(
            `${CORE}/support/attachments/${attachmentId}/content`, file,
            {
                params: withProvider(provider),
                headers: { 'Content-Type': file.type || 'application/octet-stream' },
            },
        )
        return data
    },
}

/** Dalga B — helpdesk: SLA, etiket, hazir yanit, gorunum, takip, toplu
 *  islem, talep bildirimleri. Hepsi saglayicinin (hub) kendi verisi. */
const HD = `${CORE}/tickets/helpdesk`
export const ticketHelpdeskService = {
    slaPolicy: async () => (await coreClient.get(`${HD}/sla-policy`)).data,
    saveSlaPolicy: async (payload) => (await coreClient.put(`${HD}/sla-policy`, payload)).data,
    tags: async (params = {}) => (await coreClient.get(`${HD}/tags`, { params })).data,
    createTag: async (payload) => (await coreClient.post(`${HD}/tags`, payload)).data,
    updateTag: async (id, payload) => (await coreClient.patch(`${HD}/tags/${id}`, payload)).data,
    setTicketTags: async (ticketId, tagIds) =>
        (await coreClient.put(`${CORE}/tickets/${ticketId}/tags`, { tag_ids: tagIds })).data,
    macros: async () => (await coreClient.get(`${HD}/macros`)).data,
    createMacro: async (payload) => (await coreClient.post(`${HD}/macros`, payload)).data,
    updateMacro: async (id, payload) => (await coreClient.patch(`${HD}/macros/${id}`, payload)).data,
    applyMacro: async (ticketId, macroId, payload) =>
        (await coreClient.post(`${CORE}/tickets/${ticketId}/macros/${macroId}/apply`, payload)).data,
    views: async () => (await coreClient.get(`${HD}/views`)).data,
    createView: async (payload) => (await coreClient.post(`${HD}/views`, payload)).data,
    deleteView: async (id) => { await coreClient.delete(`${HD}/views/${id}`) },
    watch: async (ticketId, watching) =>
        (await coreClient.put(`${CORE}/tickets/${ticketId}/watch`, { watching })).data,
    requesterHistory: async (ticketId) =>
        (await coreClient.get(`${CORE}/tickets/${ticketId}/requester-history`)).data,
    bulk: async (payload) => (await coreClient.post(`${CORE}/tickets/bulk`, payload)).data,
    notifications: async (params = {}) => (await coreClient.get(`${HD}/notifications`, { params })).data,
    readNotification: async (id) => { await coreClient.post(`${HD}/notifications/${id}/read`) },
    readAllNotifications: async () => { await coreClient.post(`${HD}/notifications/read-all`) },
}

export const ticketAdminService = {
    listApplications: async () => {
        const { data } = await coreClient.get(
            `${CORE}/tickets/admin/applications`,
        )
        return data
    },
    createApplication: async (payload) => {
        const { data } = await coreClient.post(
            `${CORE}/tickets/admin/applications`, payload,
        )
        return data
    },
    updateApplication: async (id, payload) => {
        const { data } = await coreClient.patch(
            `${CORE}/tickets/admin/applications/${id}`, payload,
        )
        return data
    },
    listSourceTenants: async (params = {}) => {
        const { data } = await coreClient.get(
            `${CORE}/tickets/admin/source-tenants`, { params },
        )
        return data
    },
    upsertSourceTenant: async (payload) => {
        const { data } = await coreClient.post(
            `${CORE}/tickets/admin/source-tenants`, payload,
        )
        return data
    },
    setRoute: async (sourceTenantRowId, payload) => {
        const { data } = await coreClient.put(
            `${CORE}/tickets/admin/source-tenants/${sourceTenantRowId}/route`,
            payload,
        )
        return data
    },
    disableRoute: async (sourceTenantRowId) => {
        const { data } = await coreClient.delete(
            `${CORE}/tickets/admin/source-tenants/${sourceTenantRowId}/route`,
        )
        return data
    },
    listIntegrationClients: async () => {
        const { data } = await coreClient.get(
            `${CORE}/tickets/admin/integration-clients`,
        )
        return data
    },
    createIntegrationClient: async (payload) => {
        const { data } = await coreClient.post(
            `${CORE}/tickets/admin/integration-clients`, payload,
        )
        return data
    },
    updateIntegrationClient: async (id, payload) => {
        const { data } = await coreClient.patch(
            `${CORE}/tickets/admin/integration-clients/${id}`, payload,
        )
        return data
    },
    /** Plaintext token YALNIZCA bu yanitta gelir ve bir daha okunamaz. */
    issueToken: async (clientId, payload = {}) => {
        const { data } = await coreClient.post(
            `${CORE}/tickets/admin/integration-clients/${clientId}/tokens`,
            payload,
        )
        return data
    },
    revokeToken: async (clientId, tokenId) => {
        const { data } = await coreClient.post(
            `${CORE}/tickets/admin/integration-clients/${clientId}/tokens/${tokenId}/revoke`,
        )
        return data
    },
    listDelivery: async (params = {}) => {
        const { data } = await coreClient.get(
            `${CORE}/tickets/admin/delivery`, { params },
        )
        return data
    },
    deliveryStats: async () => {
        const { data } = await coreClient.get(
            `${CORE}/tickets/admin/delivery/stats`,
        )
        return data
    },
    retryDelivery: async (id) => {
        const { data } = await coreClient.post(
            `${CORE}/tickets/admin/delivery/${id}/retry`,
        )
        return data
    },
    health: async () => {
        const { data } = await coreClient.get(`${CORE}/tickets/admin/health`)
        return data
    },
}
