/**
 * =============================================================================
 * HERMES - Dosya indirme (Sprint 6A/6C completion)
 * =============================================================================
 * Uc export ucu ayni isi UC AYRI sekilde yapiyordu ve ikisi de sizinti
 * biraktiginda kimse gormuyordu. Ortaklastirildi ve sertlestirildi.
 *
 * Kapatilan gercek kusurlar:
 *
 *   1. OBJECT URL SIZINTISI: revoke YALNIZCA basari yolunda, 2 saniyelik
 *      bir `setTimeout` icinde yapiliyordu. Kullanici o sure icinde
 *      sayfadan ayrilirsa (ya da timeout hic calismazsa) blob bellekte
 *      kaliyordu. Artik revoke `finally` ile GARANTI ve hata yolunda
 *      ANINDA yapilir.
 *
 *   2. GECICI DOM OGESI: `<a>` da ayni 2 saniyelik timeout'a birakilmisti.
 *      Artik click'ten hemen sonra senkron olarak kaldirilir.
 *
 *   3. SUNUCUNUN SOYLEDIGI DOSYA ADI/TURU YOK SAYILIYORDU: `exportExcel`
 *      `Content-Disposition`'a hic bakmiyor, icerik turunu her zaman CSV'ye
 *      zorluyordu. Artik ikisi de kullanilir; yoksa stabil bir ad uretilir.
 *
 *   4. HATA BLOB'U BASARI SAYILABILIYORDU: yalnizca tam olarak
 *      `application/json` esitligi kontrol ediliyordu; `application/json;
 *      charset=utf-8` gibi bir tur ELE GECMIYOR ve hata govdesi CSV
 *      olarak indiriliyordu. Artik tur ONEKLE kontrol edilir.
 *
 * TURKCE ICERIK: bayt dizisi DEGISTIRILMEZ. BOM eklenmez — sunucu zaten
 * gonderiyorsa cift BOM olusur, gondermiyorsa iceriye mudahale etmek
 * dosyayi bozar. Blob tipi `charset=utf-8` tasir.
 * =============================================================================
 */

/** `Content-Disposition`'dan dosya adi. RFC 5987 `filename*` desteklenir. */
export function filenameFromDisposition(disposition) {
    if (!disposition || typeof disposition !== 'string') return null
    // Once RFC 5987: filename*=UTF-8''ad%C4%B1.csv
    const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;\n]*)/i.exec(disposition)
    if (extended && extended[2]) {
        try {
            return decodeURIComponent(extended[2].trim().replace(/^["']|["']$/g, ''))
        } catch {
            /* bozuk yuzde kodlamasi: duz filename'e dus */
        }
    }
    const plain = /filename\s*=\s*("([^"]*)"|[^;\n]*)/i.exec(disposition)
    if (plain) {
        const value = (plain[2] ?? plain[1] ?? '').trim().replace(/^["']|["']$/g, '')
        if (value) return value
    }
    return null
}

/** Uzantiyi garanti eder; yoksa ekler, farkliysa degistirir. */
export function ensureExtension(filename, ext = 'csv') {
    const safe = (filename || '').trim() || `download.${ext}`
    if (safe.toLowerCase().endsWith(`.${ext}`)) return safe
    return `${safe.replace(/\.[^/.]+$/, '')}.${ext}`
}

/** Yanit govdesi aslinda bir JSON HATASI mi? */
const isJsonErrorBlob = (blob) =>
    !!blob && typeof blob.type === 'string'
    && blob.type.toLowerCase().startsWith('application/json')

/**
 * Blob yanitini indirir.
 *
 * @param {object} response axios yaniti (responseType: 'blob')
 * @param {string} fallbackFilename sunucu ad vermezse kullanilacak ad
 * @param {object} [deps] test icin enjekte edilebilir DOM/URL baglamlari
 * @throws {Error} sunucu JSON hata govdesi dondurduyse (mesajiyla)
 */
export async function downloadBlobResponse(response, fallbackFilename, deps = {}) {
    const doc = deps.document || document
    const urlApi = deps.url || window.URL

    const data = response?.data
    // Hata govdesi CSV olarak indirilmez: BASARISIZLIK basari gibi
    // gosterilmez.
    if (isJsonErrorBlob(data)) {
        let detail = null
        try {
            const parsed = JSON.parse(await data.text())
            detail = parsed?.detail || parsed?.error?.message || null
        } catch {
            /* govde okunamadi: generic mesaja dus */
        }
        const err = new Error(detail || 'Download failed')
        err.isDownloadError = true
        throw err
    }

    const headers = response?.headers || {}
    const serverType = headers['content-type'] || headers['Content-Type']
    const serverName = filenameFromDisposition(
        headers['content-disposition'] || headers['Content-Disposition']
    )

    // Sunucunun turu anlamliysa KORUNUR; yoksa CSV varsayilir.
    const blobType = serverType && !serverType.toLowerCase().startsWith('application/octet-stream')
        ? serverType
        : 'text/csv;charset=utf-8'

    const blob = new Blob([data], { type: blobType })
    const objectUrl = urlApi.createObjectURL(blob)
    const filename = ensureExtension(serverName || fallbackFilename)

    let link = null
    try {
        link = doc.createElement('a')
        link.href = objectUrl
        link.setAttribute('download', filename)
        link.style.visibility = 'hidden'
        link.style.position = 'absolute'
        doc.body.appendChild(link)
        link.click()
        return { filename, type: blobType }
    } finally {
        // Gecici oge ANINDA kaldirilir; 2 saniye DOM'da beklemez.
        if (link && link.parentNode) link.parentNode.removeChild(link)
        /*
         * Revoke bir sonraki tick'te: tarayicilarin bir kismi click'i
         * ayni tick icinde tamamlamaz, hemen revoke etmek indirmeyi
         * iptal edebilir. `finally` icinde oldugu icin hata yolunda da
         * KESIN calisir.
         */
        const revoke = () => urlApi.revokeObjectURL(objectUrl)
        if (typeof setTimeout === 'function') setTimeout(revoke, 0)
        else revoke()
    }
}
