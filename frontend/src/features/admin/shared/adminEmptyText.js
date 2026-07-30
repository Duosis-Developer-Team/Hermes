/**
 * =============================================================================
 * HERMES - Admin tablo bosluk metni (Sprint 6B.2 completion)
 * =============================================================================
 * Saf fonksiyon; component dosyasindan AYRI tutulur cunku bir modul hem
 * component hem yardimci export ederse fast-refresh sozlesmesi bozulur.
 *
 * Tek kural: ILK KULLANIM boslugu ile FILTRE sonucu yoklugu AYRI konusur.
 * Ikisini ayni mesajla anlatmak kullaniciya "veri yok" dedirtir, oysa
 * yalnizca filtre daraltmistir.
 * =============================================================================
 */

/**
 * @param {object} opts
 * @param {boolean} opts.filtered     Herhangi bir filtre/arama etkin mi
 * @param {string} opts.entityPlural  orn. "customers"
 * @param {string} [opts.createLabel] orn. "New Customer"
 * @param {string} [opts.term]        Arama terimi (varsa mesaja girer)
 */
export function adminEmptyText({ filtered, entityPlural, createLabel, term }) {
    if (filtered) {
        return term
            ? `No ${entityPlural} match \u201c${term}\u201d.`
            : `No ${entityPlural} match the selected filters.`
    }
    return createLabel
        ? `No ${entityPlural} yet. Use \u201c${createLabel}\u201d.`
        : `No ${entityPlural} yet.`
}
