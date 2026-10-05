/**
 * =============================================================================
 * HERMES - Arama metni katlama (TEK kaynak)
 * =============================================================================
 * Tum arama kutulari (Select'ler, liste aramalari, adim secicileri) ayni
 * kuralla eslesir: buyuk/kucuk harf ve Turkce/Ingilizce karakter FARKI YOK.
 *   I / İ / ı / i → i     ü → u   ö → o   ş → s   ç → c   ğ → g
 * Boylece "iga" = "IGA" = "İGA", "sabanci" = "Sabancı", "turk" = "Türk".
 *
 * Neden ozel: `toLocaleLowerCase('tr')` "IGA"yi "ıga" yapar ve "i" ile
 * eslesmez (canli bug); duz `toLowerCase()` ise "İ"yi "i̇" (noktali) yapar.
 * =============================================================================
 */

/** Karsilastirma icin katlanmis bicim (gosterimde KULLANILMAZ). */
export function foldSearch(value) {
    return String(value ?? '')
        .replace(/[İIı]/g, 'i')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
}

/** `text`, aranan `query`yi iceriyor mu? Bos sorgu her seyle eslesir. */
export function matchesSearch(text, query) {
    const q = foldSearch(query).trim()
    return !q || foldSearch(text).includes(q)
}

/** Bir kaydin alanlarindan herhangi biri sorguyla eslesiyor mu? */
export function matchesAny(values, query) {
    const q = foldSearch(query).trim()
    return !q || (values || []).some((v) => v != null && foldSearch(v).includes(q))
}

/** antd Select `filterOption`: secenegin metin etiketi uzerinden. */
export function selectFilter(input, option) {
    const label = typeof option?.label === 'string' || typeof option?.label === 'number'
        ? option.label
        : (option?.searchText ?? option?.title ?? '')
    return matchesSearch(label, input)
}
