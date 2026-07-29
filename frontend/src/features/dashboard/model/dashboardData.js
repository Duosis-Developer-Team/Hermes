/**
 * =============================================================================
 * HERMES - Dashboard veri adaptoru (Sprint 6A)
 * =============================================================================
 * API yanitini grafiklerin ve metrik kartlarinin bekledigi bicime cevirir.
 * SAF fonksiyonlar — React/DOM yok, dogrudan test edilebilir.
 *
 * Sayfadan cikarilmasinin sebebi yalnizca dosya boyutu degil: bu
 * donusumler component govdesinde iken sessizce yanlis davraniyordu —
 * `Number(item.hours)` sayisal olmayan degeri NaN yapip grafige
 * gonderiyordu ve cozulemeyen bir kullanici kimligi ham UUID olarak
 * ekranda kaliyordu. Ikisi de burada deterministik olarak ele alinir ve
 * testle kilitlidir.
 * =============================================================================
 */

/**
 * Saat degerini SAYIYA cevirir; cevrilemiyorsa null.
 *
 * DIKKAT: `Number(null)` ve `Number('')` sifir dondurur. Ham `Number`
 * kullanmak "deger yok"u "sifir saat"a cevirirdi — grafikte var olmayan
 * bir satiri sifir cubuk olarak gostermek yanlis bilgidir. Bu yuzden
 * null/undefined/bos string BASTAN gecersiz sayilir; acikca yazilmis
 * sayisal 0 ise KORUNUR.
 */
const parseHours = (value) => {
    if (value === null || value === undefined || value === '') return null
    const num = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(num) ? num : null
}

/**
 * Ondalik saati insan okunur sureye cevirir: 0.75 → "0h 45m", 2 → "2h".
 *
 * Sozlesme: gecersiz/eksik/negatif girdi "0h" verir — grafik ve kart
 * "NaNh" gostermez. 59.6 dakikaya yuvarlanan degerler saate tasar
 * (1.999 → "2h", "1h 60m" DEGIL).
 */
export function formatDuration(value) {
    const num = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(num) || num <= 0) return '0h'
    let h = Math.floor(num)
    let m = Math.round((num - h) * 60)
    if (m === 60) { h += 1; m = 0 }
    return m > 0 ? `${h}h ${m}m` : `${h}h`
}

/**
 * Grafik serisi: `hours` SAYIYA cevrilir, cevrilemeyen satirlar ATILIR.
 *
 * Neden atiliyor: Recharts NaN degeri cizemez ve ekseni bozar. Sessizce
 * 0 yazmak da yanlis olurdu — "veri yok" ile "sifir saat" ayni sey
 * degildir. Etiketsiz satirlar da atilir (eksende bos cubuk olusturur).
 */
export function toChartSeries(rows, { limit } = {}) {
    const series = (Array.isArray(rows) ? rows : [])
        .map((row) => ({ ...row, hours: parseHours(row?.hours) }))
        .filter((row) => row.hours !== null && !!row.name)
    return typeof limit === 'number' ? series.slice(0, limit) : series
}

/**
 * `by_user` satirlarindaki kullanici KIMLIGINI goruntulenen ada cevirir.
 * Backend bu alanda `name` olarak user_id gonderir.
 *
 * HAM UUID ASLA EKRANA SIZMAZ: cozulemeyen kimlik notr bir tire olur
 * (Tasks yuzeyinde ayni kural uygulaniyor). Boylece "kim oldugu
 * bilinmiyor" durumu, kullaniciya teknik bir kimlik gostermeden
 * anlatilir.
 */
export function resolveUserNames(rows, users) {
    const byId = new Map((Array.isArray(users) ? users : []).map((u) => [u.id, u]))
    return (Array.isArray(rows) ? rows : []).map((row) => {
        const user = byId.get(row?.name)
        return {
            ...row,
            name: user?.full_name || user?.email || '—',
            hours: parseHours(row?.hours),
        }
    }).filter((row) => row.hours !== null)
}

/**
 * Metrik kartlarinin degerleri. Eksik yanit TAMAMEN sifir doner —
 * kartlar "undefined" veya bos gostermez, geometri korunur.
 */
export function dashboardSummary(data, userSeries) {
    return {
        totalHours: formatDuration(data?.total_hours),
        customerCount: Array.isArray(data?.by_customer) ? data.by_customer.length : 0,
        projectCount: Array.isArray(data?.by_project) ? data.by_project.length : 0,
        memberCount: Array.isArray(userSeries) ? userSeries.length : 0,
    }
}

/**
 * Bir grafigin cizilmeye deger veri tasiyip tasimadigi. Bos dizi ve
 * "hepsi sifir saat" durumlari AYRI ele alinir: ikisi de grafik yerine
 * aciklayici bir durum gosterir, ama sebep farklidir.
 */
export function chartState(series) {
    if (!Array.isArray(series) || series.length === 0) return 'empty'
    if (series.every((row) => row.hours === 0)) return 'insufficient'
    return 'ready'
}
