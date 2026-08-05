/**
 * =============================================================================
 * HERMES - Tasks tarih modeli (Sprint 5C)
 * =============================================================================
 * Gun anahtarlari HER ZAMAN yerel 'YYYY-MM-DD' string'idir ve ASLA
 * `new Date('YYYY-MM-DD')` uzerinden gecmez: o parse UTC gece yarisi
 * uretir ve negatif offsetli dilimlerde tarihi BIR ONCEKI gune kaydirir
 * (Time Entry'de ayni tuzak Sprint 4'te kilitlenmisti). dayjs'in
 * 'YYYY-MM-DD' parse'i YEREL gece yarisi verir — bu modul yalnizca onu
 * kullanir.
 *
 * Saf fonksiyonlar: React/DOM yok, "simdi" disaridan verilebilir.
 * Sinirlar (ay sonu, yil gecisi, artik gun, UTC gece yarisi, +14…-11
 * offsetler) src/test/tasks/dates.timezone.test.jsx ile kilitli.
 * =============================================================================
 */
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'

dayjs.extend(isoWeek)

export const DATE_KEY = 'YYYY-MM-DD'

/** Herhangi bir tarih degerini YEREL gun anahtarina cevirir. */
export const dateKey = (value) => dayjs(value).format(DATE_KEY)

/** Bugunun / dunun yerel gun anahtari. */
export const todayKey = (now = dayjs()) => now.format(DATE_KEY)
export const yesterdayKey = (now = dayjs()) =>
    now.subtract(1, 'day').format(DATE_KEY)

/** Icinde bulunulan ISO haftasinin baslangici (Pazartesi). */
export const currentWeekStart = (now = dayjs()) => now.startOf('isoWeek')

/**
 * Bir ISO haftasinin [from, to] gun anahtarlari. Ay sonu / yil gecisi /
 * artik gun sinirlarinda kirilmaz — hesap dayjs'in takvimine birakilir.
 */
export const isoWeekWindow = (weekStart) => ({
    from: weekStart.format(DATE_KEY),
    to: weekStart.endOf('isoWeek').format(DATE_KEY),
})

/**
 * Hizli filtre → ek backend parametreleri.
 *
 * Filtre aktifken scheduled-date hafta penceresi BILEREK dusurulur ki
 * filtre baska haftalardaki kayitlari da yakalasin (orn. uc hafta once
 * planlanmis bir "Overdue" gorev).
 */
export function quickFilterParams(kind, { weekStart, yesterday }) {
    const week = weekStart ? isoWeekWindow(weekStart) : null
    switch (kind) {
        case 'due-this-week':
            return {
                due_from: week.from,
                due_to: week.to,
                status_exclude: ['completed'],
            }
        case 'overdue':
            return {
                due_to: yesterday,
                status_exclude: ['completed'],
            }
        case 'completed-this-week':
            return {
                statuses: ['completed'],
                completed_from: week.from,
                completed_to: week.to,
            }
        default:
            return null
    }
}
