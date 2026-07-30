/**
 * =============================================================================
 * HERMES - Admin form yasam dongusu yardimcilari (Sprint 6B.2)
 * =============================================================================
 * Sayfa sekilleri farkli oldugu icin ortak bir "mega CRUD component"
 * URETILMEDI. Ortaklastirilan sey DAVRANIS: her admin formunun ayni
 * sekilde yapmasi gereken iki kucuk is.
 *
 * `resetAndFill` — `setFieldsValue` SIG BIRLESTIRIR: Edit A → Edit B
 * gecisinde B'de bulunmayan (ya da null olan) alanlar A'nin degerini
 * KORUR. Once resetFields, sonra doldur. Ayrica yalnizca FORMDA olan
 * alanlar yazilir; API'den gelen `id`, `created_at` gibi alanlar form
 * store'una sizmaz.
 *
 * `pickFields` — kayittan yalnizca beklenen alanlari alir; eksik olani
 * `undefined` yerine ACIK bir bos degere cevirir (yoksa alan hic
 * yazilmaz ve bayat deger kalir).
 * =============================================================================
 */

/**
 * Kayittan yalnizca verilen alanlari secer. Eksik alan, bayat deger
 * BIRAKMAMAK icin acikca `fallback` degerini alir.
 * @param {object} record
 * @param {Record<string, any>} shape  { alanAdi: bosDeger }
 */
export function pickFields(record, shape) {
    const out = {}
    for (const [field, fallback] of Object.entries(shape)) {
        const value = record?.[field]
        out[field] = value === undefined || value === null ? fallback : value
    }
    return out
}

/**
 * Formu TEMIZLEYIP verilen degerlerle doldurur.
 * Edit A → Edit B ve Edit → Create gecislerinde bayat deger kalmaz.
 */
export function resetAndFill(form, values) {
    if (!form) return
    form.resetFields()
    if (values) form.setFieldsValue(values)
}
