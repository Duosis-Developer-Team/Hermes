/**
 * HERMES - Ek durumu yardimcilari.
 *
 * Bilesenden AYRI dosyada: React fast-refresh yalnizca bilesen ihrac
 * eden dosyalarda calisir, ve bu yardimci testlerde de dogrudan
 * kullanilir.
 */

/** Ticket komutlarina gonderilecek ek kimlikleri: YALNIZCA taramasi
 *  bitmis ve TEMIZ olanlar. Sunucu zaten fail-closed reddeder; burada
 *  filtrelemek kullaniciya anlamsiz bir hata gostermeyi onler. */
export const readyAttachmentIds = (items = []) =>
    items.filter((item) => item.status === 'clean' && item.id)
        .map((item) => item.id)
