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

export const supportPortalService = {
    list: async (params = {}) => {
        const { data } = await coreClient.get(`${CORE}/support/tickets`, { params })
        return data
    },
    get: async (id) => {
        const { data } = await coreClient.get(`${CORE}/support/tickets/${id}`)
        return data
    },
    /** Idempotency-Key ZORUNLU DEGIL ama gonderiyoruz: ag hatasinda
     *  yapilan retry ikinci bir ticket ACMASIN. */
    create: async (payload, idempotencyKey) => {
        const { data } = await coreClient.post(
            `${CORE}/support/tickets`, payload,
            idempotencyKey
                ? { headers: { 'Idempotency-Key': idempotencyKey } }
                : undefined,
        )
        return data
    },
    reply: async (id, payload) => {
        const { data } = await coreClient.post(
            `${CORE}/support/tickets/${id}/messages`, payload,
        )
        return data
    },
    reopen: async (id, payload) => {
        const { data } = await coreClient.post(
            `${CORE}/support/tickets/${id}/reopen`, payload,
        )
        return data
    },
    confirmClose: async (id, payload) => {
        const { data } = await coreClient.post(
            `${CORE}/support/tickets/${id}/confirm-close`, payload,
        )
        return data
    },
    cancel: async (id, payload) => {
        const { data } = await coreClient.post(
            `${CORE}/support/tickets/${id}/cancel`, payload,
        )
        return data
    },
    downloadUrl: (ticketId, attachmentId) =>
        `${CORE}/support/tickets/${ticketId}/attachments/${attachmentId}/download`,
    openAttachmentSession: async (params) => {
        const { data } = await coreClient.post(
            `${CORE}/support/attachments`, null, { params },
        )
        return data
    },
    uploadAttachmentContent: async (attachmentId, file) => {
        const { data } = await coreClient.post(
            `${CORE}/support/attachments/${attachmentId}/content`, file,
            { headers: { 'Content-Type': file.type || 'application/octet-stream' } },
        )
        return data
    },
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
