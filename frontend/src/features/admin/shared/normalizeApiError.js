/**
 * =============================================================================
 * HERMES - Admin API hata modeli (Sprint 6B.2)
 * =============================================================================
 * Dokunulan her componentte `err.response?.data?.detail || 'Error'` elle
 * tekrarlaniyordu. Sonuc: kullaniciya "Error" gibi hicbir sey anlatmayan
 * mesajlar, ham backend metinleri ve alan hatalarinin forma HIC
 * baglanmamasi.
 *
 * Bu katman HTTP durumunu ANLAMLI bir sonuca cevirir ve alan hatalarini
 * ayirir. Domain'e ozel catisma mesajlari KAYBOLMAZ: sunucu bir aciklama
 * gonderdiyse o gosterilir, generic metin yalnizca fallback'tir.
 *
 * Saf fonksiyon — React/DOM yok, dogrudan test edilebilir.
 * =============================================================================
 */

/** Kullaniciya gosterilmesi UYGUN OLMAYAN teknik icerik mi? */
const looksTechnical = (text) =>
    typeof text === 'string' &&
    (/Traceback|at [A-Za-z]+\.[a-z]+\(|<!DOCTYPE|<html|SQLSTATE|psycopg|sqlalchemy/i
        .test(text) || text.length > 300)

/** FastAPI 422 gövdesini { alan: mesaj } haritasina cevirir. */
const fieldErrorsFrom = (detail) => {
    if (!Array.isArray(detail)) return {}
    const fields = {}
    for (const item of detail) {
        // loc: ["body", "name"] → son parca alan adidir.
        const loc = Array.isArray(item?.loc) ? item.loc : []
        const name = loc.filter((p) => p !== 'body' && typeof p === 'string').pop()
        if (name && item?.msg && !fields[name]) fields[name] = item.msg
    }
    return fields
}

const GENERIC = {
    network: 'Cannot reach the server. Check your connection and try again.',
    400: 'The request was rejected. Please review the values and try again.',
    401: 'Your session has expired. Please sign in again.',
    403: 'You do not have permission to do this.',
    404: 'This record no longer exists. It may have been removed.',
    409: 'This conflicts with an existing record.',
    422: 'Some fields need attention.',
    500: 'The server had a problem. Please try again.',
    unknown: 'Something went wrong. Please try again.',
}

/**
 * @returns {{
 *   kind: 'network'|'validation'|'authorization'|'missing'|'conflict'|'server'|'unknown',
 *   status: number|null,
 *   message: string,      // kullaniciya gosterilebilir
 *   fieldErrors: object,  // { alanAdi: mesaj }
 *   retryable: boolean,
 * }}
 */
export function normalizeApiError(error) {
    const status = error?.response?.status ?? null
    const data = error?.response?.data
    const detail = data?.detail

    // Aga erisilemedi: response HIC yok.
    if (!error?.response) {
        return {
            kind: 'network', status: null, message: GENERIC.network,
            fieldErrors: {}, retryable: true,
        }
    }

    // Sunucunun kendi aciklamasi varsa TERCIH EDILIR — domain'e ozel
    // catisma metinleri generic mesajin altinda kaybolmaz. Teknik
    // govdeler (stack trace, HTML) kullaniciya GOSTERILMEZ.
    const serverText =
        typeof detail === 'string' && !looksTechnical(detail) ? detail : null

    if (status === 422) {
        const fieldErrors = fieldErrorsFrom(detail)
        return {
            kind: 'validation', status,
            message: serverText || GENERIC[422],
            fieldErrors, retryable: false,
        }
    }
    if (status === 409) {
        return {
            kind: 'conflict', status,
            message: serverText || GENERIC[409], fieldErrors: {}, retryable: false,
        }
    }
    if (status === 400) {
        return {
            kind: 'validation', status,
            message: serverText || GENERIC[400],
            fieldErrors: fieldErrorsFrom(detail), retryable: false,
        }
    }
    if (status === 401 || status === 403) {
        return {
            kind: 'authorization', status,
            message: serverText || GENERIC[status], fieldErrors: {}, retryable: false,
        }
    }
    if (status === 404) {
        return {
            kind: 'missing', status,
            message: serverText || GENERIC[404], fieldErrors: {}, retryable: false,
        }
    }
    if (status >= 500) {
        // 5xx govdesi genelde teknik olur; generic mesaj tercih edilir.
        return {
            kind: 'server', status, message: GENERIC[500],
            fieldErrors: {}, retryable: true,
        }
    }
    return {
        kind: 'unknown', status,
        message: serverText || GENERIC.unknown, fieldErrors: {}, retryable: false,
    }
}

/**
 * Alan hatalarini AntD Form'a baglar; forma baglanamayanlari doner.
 * @returns {string|null} forma baglanamayan (form/sayfa seviyesinde
 *   gosterilmesi gereken) mesaj.
 */
export function applyErrorToForm(error, form, knownFields) {
    const normalized = normalizeApiError(error)
    const entries = Object.entries(normalized.fieldErrors)
    const known = Array.isArray(knownFields) ? new Set(knownFields) : null
    const bindable = entries.filter(([name]) => !known || known.has(name))

    if (bindable.length && form) {
        form.setFields(
            bindable.map(([name, msg]) => ({ name, errors: [msg] }))
        )
    }
    // Hicbir alan baglanamadiysa mesaj FORM/SAYFA seviyesinde gosterilir —
    // sessizce yutulmaz.
    return bindable.length === entries.length && bindable.length > 0
        ? null
        : normalized.message
}
