/**
 * =============================================================================
 * HERMES - Time Entry pano modeli (Sprint 4, CTO paketi §2/§6)
 * =============================================================================
 * SAF fonksiyonlar — DOM/React yok, dolayisiyla dogrudan test edilebilir.
 * Sayfadan cikarildi; davranis characterization testleriyle KILITLI
 * (src/test/time-entry/clipboard.characterization.test.jsx) ve o testler
 * bu refactor'dan ONCE yazildi.
 */

/** Panoya alinan kaydin IMMUTABLE anlik goruntusu.
 *  Onceki kod tum log NESNESINI referansla tutuyordu; paket §6 "kaynak
 *  sonradan degisse bile snapshot korunur" diyor. Burada yalnizca
 *  yapistirma icin gereken MINIMUM alanlar kopyalanir — kaynak kayit
 *  guncellense/silinse bile pano icerigi degismez. */
export function makeClipboardSnapshot(log) {
    if (!log) return null
    return Object.freeze({
        sourceId: log.id,
        customer_id: log.customer_id,
        project_id: log.project_id,
        work_type_id: log.work_type_id,
        activity_type_id: log.activity_type_id || null,
        platform_id: log.platform_id || null,
        work_line_id: log.work_line_id || null,
        duration_hours: log.duration_hours,
        description: log.description,
        // Yalnizca kullaniciya gosterilecek etiket icin:
        label: log.project_name || log.description?.substring(0, 25) || 'Log',
    })
}

/** Snapshot + hedef tarih → create payload'i. Alan eslemesi mevcut API
 *  sozlesmesiyle BIREBIR aynidir (Sprint 4'te API degismedi). */
export function buildPastePayload(snapshot, targetDate) {
    if (!snapshot || !targetDate) return null
    return {
        customer_id: snapshot.customer_id,
        project_id: snapshot.project_id,
        work_type_id: snapshot.work_type_id,
        activity_type_id: snapshot.activity_type_id,
        platform_id: snapshot.platform_id,
        work_line_id: snapshot.work_line_id,
        date_worked: targetDate,
        duration_hours: snapshot.duration_hours,
        description: snapshot.description,
    }
}

/** Global kisayol guard'i: form alanindayken sayfa kisayollari CALISMAZ.
 *  Saf tutuldu ki contenteditable dali da test edilebilsin (jsdom DOM
 *  uzerinden bunu desteklemiyor). */
export function isEditableTarget(element) {
    if (!element) return false
    const tag = element.tagName?.toUpperCase()
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
    return element.isContentEditable === true
}
