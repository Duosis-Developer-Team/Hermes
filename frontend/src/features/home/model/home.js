/**
 * =============================================================================
 * HERMES - Ana sayfa modeli (PM rework P3 / D3, E4)
 * =============================================================================
 * SAF veri donusumleri — React/DOM/API bagimliligi yok. Bloklar sunucudan
 * ekran seklinde gelen veriyi (kova → proje grubu → is) yalnizca
 * gosterir; burada tek is "hangi kova gorunur" ve "hangi gun nasil"
 * kararlaridir (04-roller §4.1, §4.2, §7).
 *
 * E4 tek renkli sinyal: bir kartta rengi tasiyan TEK sey termindir —
 * gecikmis kirmizi, bugun amber, digeri notr. Oncelik notr cubuk, tip
 * metin, durum konumdan (pano sutunu / liste grubu) okunur. `dueTone`
 * P3.4'te kart/liste/pano icin de ayni kaynaktir.
 * =============================================================================
 */
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'

import { PM_BASE, TYPE_TO_PLURAL } from '../../tasks/model/constants'

dayjs.extend(isoWeek)

/** E6: bir is kaydinin is yuzeyindeki adresi (tur segmenti + ?item=). */
export function workItemPath(item) {
    const plural = TYPE_TO_PLURAL[item?.task_type] || 'tasks'
    return `${PM_BASE}/${plural}?item=${encodeURIComponent(item.id)}`
}

export const DUE_TONES = ['overdue', 'today', 'neutral']

/** Termin → tek renkli sinyal. Terminsiz veya gecersiz tarih = notr. */
export function dueTone(dueDate, today = dayjs()) {
    if (!dueDate) return 'neutral'
    const due = dayjs(dueDate)
    if (!due.isValid()) return 'neutral'
    const ref = dayjs(today).startOf('day')
    if (due.isBefore(ref, 'day')) return 'overdue'
    if (due.isSame(ref, 'day')) return 'today'
    return 'neutral'
}

export const BUCKET_ORDER = ['overdue', 'due_today', 'this_week']

/** Kovalarin gorunme kurali (§4.2): gecikmis ve bu hafta BOSSA hic
 *  gorunmez; bugun kovasi hep vardir (bos satiriyla). */
export function visibleBuckets(myWork) {
    if (!myWork) return []
    return BUCKET_ORDER
        .map((key) => ({ key, bucket: myWork[key] || { count: 0, groups: [] } }))
        .filter(({ key, bucket }) => key === 'due_today' || bucket.count > 0)
}

/** Grup basligi: `Musteri · Proje`; musteri yoksa yalnizca proje. */
export function groupLabel(group) {
    return [group?.customer_name, group?.project_name].filter(Boolean).join(' · ')
}

const num = (v) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
}

/** Efor seridi ozeti (§4.1): haftalik dolum + calisma gunu kutulari.
 *  Kapasite yaniti yoksa null — serit sessiz kalir. */
export function effortSummary(week) {
    if (!week) return null
    const expected = num(week.expected_total)
    const logged = num(week.logged_total)
    const days = (week.days || [])
        .filter((d) => d.is_working_day)
        .map((d) => ({
            date: d.date,
            status: d.status,
            logged: num(d.logged_hours),
            expected: num(d.expected_hours),
            off: d.status === 'off',
            absent: !!d.is_absent,
            holidayName: d.holiday_name || null,
        }))
    const fillPercent = week.fill_percent ?? (expected > 0 ? Math.round((logged / expected) * 100) : null)
    return {
        expected,
        logged,
        fillPercent,
        missingCount: days.filter((d) => d.status === 'missing').length,
        days,
    }
}

/** Haftanin Pazartesi'si (ISO), API'nin bekledigi bicimde. */
export function mondayOf(date = dayjs()) {
    return dayjs(date).startOf('isoWeek').format('YYYY-MM-DD')
}

export function formatHours(value) {
    const n = num(value)
    return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '')
}
