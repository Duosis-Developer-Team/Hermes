/**
 * =============================================================================
 * HERMES - Time Entry saf model (Sprint 4, CTO paketi §2/§11)
 * =============================================================================
 * Sure bicimleme ve hafta/gun secicileri. Bilesenlerden cikarildi ki
 * ay/yil sinirlari ve timezone davranisi DOGRUDAN test edilebilsin
 * (CTO §7: "gun kaymasi olusturma", "ay basi/sonu/yil gecisi test").
 *
 * TARIH KURALI: gun anahtari HER ZAMAN yerel 'YYYY-MM-DD' string'idir.
 * Date/UTC donusumu YAPILMAZ — bu, kaydin bir onceki/sonraki gune
 * kaymasinin klasik sebebidir.
 */
import dayjs from 'dayjs'

/** Ondalik saat → "2h 30m" (eski veri: 2.5 → 2h 30m). Davranis
 *  WorkLogCard'daki orijinal formatHours ile BIREBIR aynidir. */
export function formatHours(hours) {
    if (!hours && hours !== 0) return '0h'
    const num = parseFloat(hours)
    if (Number.isNaN(num)) return '0h'
    const h = Math.floor(num)
    const m = Math.round((num - h) * 60)
    if (m === 0) return `${h}h`
    return `${h}h ${m}m`
}

/** Toplam sure: gecersiz degerler 0 sayilir (mevcut davranis). */
export function sumHours(logs) {
    return (logs || []).reduce(
        (sum, l) => sum + (parseFloat(l?.duration_hours) || 0), 0,
    )
}

/** Hafta gunleri: ISO hafta basindan 7 gun. Her gun icin yerel tarih
 *  anahtari + bayraklar. */
export function buildWeekDays(weekStart, today = dayjs()) {
    const start = dayjs(weekStart).startOf('isoWeek')
    const todayKey = dayjs(today).format('YYYY-MM-DD')
    return Array.from({ length: 7 }, (_, i) => {
        const d = start.add(i, 'day')
        const key = d.format('YYYY-MM-DD')
        return {
            key,
            dayOfMonth: d.date(),
            month: d.month() + 1,
            year: d.year(),
            isToday: key === todayKey,
            isWeekend: d.day() === 0 || d.day() === 6,
            // Hafta, iki ayi kesiyorsa: gun hafta basiyla AYNI ayda mi?
            isOutsideStartMonth: d.month() !== start.month(),
        }
    })
}

/** Gunun kayitlari — string anahtar karsilastirmasi (UTC donusumu YOK). */
export function logsForDay(logs, dayKey) {
    return (logs || []).filter((l) => {
        const raw = l?.date_worked
        if (!raw) return false
        // Backend 'YYYY-MM-DD' veya ISO datetime donebilir; ilk 10 karakter
        // yerel gun anahtaridir. new Date() ILE PARSE EDILMEZ.
        return String(raw).slice(0, 10) === dayKey
    })
}
