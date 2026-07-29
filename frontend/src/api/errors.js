/**
 * =============================================================================
 * HERMES - Standart API hata modeli (Sprint 1, CTO paketi §10)
 * =============================================================================
 * UI'nin axios ic yapisini bilmesine gerek birakmayan normalize hata.
 * Hicbir zaman request/response govdesi tasimaz (sensitive dump yasak);
 * yalnizca siniflandirma + kullaniciya gosterilebilir mesaj + alan
 * hatalari + korelasyon kimligi.
 */

const KIND_BY_STATUS = {
    400: 'validation', 401: 'unauthorized', 403: 'forbidden',
    404: 'notFound', 409: 'conflict', 422: 'validation',
}

export function toApiError(error) {
    const status = error?.response?.status ?? null
    const data = error?.response?.data
    const kind = status == null
        ? 'network'
        : KIND_BY_STATUS[status] || (status >= 500 ? 'server' : 'server')

    // FastAPI detail: string | [{loc,msg}] — alan hatalarina ayristir.
    let message = null
    let fieldErrors = null
    const detail = data?.detail ?? data?.error?.message
    if (Array.isArray(detail)) {
        fieldErrors = {}
        for (const d of detail) {
            const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : 'form'
            fieldErrors[field] = d.msg
        }
        message = 'Lütfen işaretli alanları düzeltin.'
    } else if (typeof detail === 'string') {
        message = detail
    }

    return {
        kind,
        status,
        message: message || DEFAULT_MESSAGES[kind],
        fieldErrors,
        correlationId:
            data?.error?.request_id
            ?? error?.response?.headers?.['x-request-id']
            ?? null,
    }
}

const DEFAULT_MESSAGES = {
    validation: 'Gönderilen veri doğrulanamadı.',
    unauthorized: 'Oturumunuz geçersiz veya süresi doldu.',
    forbidden: 'Bu işlem için yetkiniz yok.',
    notFound: 'Kayıt bulunamadı.',
    conflict: 'Bu işlem mevcut durumla çakışıyor.',
    network: 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.',
    server: 'Beklenmeyen bir sunucu hatası oluştu.',
}
