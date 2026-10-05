/**
 * =============================================================================
 * HERMES - Surum notlari (TEK kaynak)
 * =============================================================================
 * Uygulamanin gorunen surumu (`APP_VERSION`) bu listenin ILK kaydidir:
 * yeni surum = listenin basina bir kayit + i18n `releases.<key>.*` metinleri.
 *
 * Surum numarasi: MAJOR.MINOR[.PATCH] — kucuk duzeltmeler v1.1, v1.2.5;
 * buyuk degisiklikler v2.0. Liste YENIDEN ESKIYE siralidir (test kilitli).
 *
 * Yalniz YAPI burada; metinler sozlukte (Turkce metin yalniz tr.js'te
 * durabilir — sprint8Polish kurali). Anahtar duzeni:
 *   releases.<key>.title / .summary
 *   releases.<key>.h.<id>.title / .body      one cikanlar (gorselli kart)
 *   releases.<key>.<kind>.<id>               degisiklik satirlari
 * =============================================================================
 */

/** Degisiklik turleri — sayfadaki sira ve renk bu listeden. */
export const CHANGE_KINDS = ['new', 'improved', 'fixed']

export const RELEASES = [
    {
        version: '1.0',
        key: 'v1_0',
        date: '2026-10-05',
        highlights: [
            { id: 'liquid', visual: 'liquid', tone: 'blue' },
            { id: 'home', visual: 'home', tone: 'amber' },
            { id: 'work', visual: 'work', tone: 'violet' },
            { id: 'meet', visual: 'meet', tone: 'green' },
            { id: 'desktop', visual: 'desktop', tone: 'ink' },
            { id: 'brand', visual: 'brand', tone: 'red' },
        ],
        changes: {
            new: ['patchNotes', 'notifications', 'session', 'landing', 'photo', 'capacity', 'workLink'],
            improved: ['search', 'settings', 'reports', 'tickets', 'timeEntry', 'meetings', 'devPortal'],
            fixed: ['logo', 'staleChunk', 'calendar', 'sessionDrop', 'tasksCalendar', 'dashboard'],
        },
    },
]

const VERSION_RE = /^\d+\.\d+(\.\d+)?$/

export const isValidVersion = (v) => VERSION_RE.test(String(v || ''))

/** '1.2.5' → [1, 2, 5]; eksik parca 0 sayilir. */
const parts = (v) => {
    const [a = 0, b = 0, c = 0] = String(v).split('.').map(Number)
    return [a, b, c]
}

/** Surum karsilastirma (sayisal): a > b → pozitif. */
export function compareVersions(a, b) {
    const pa = parts(a)
    const pb = parts(b)
    for (let i = 0; i < 3; i += 1) {
        if (pa[i] !== pb[i]) return pa[i] - pb[i]
    }
    return 0
}

/** Ekranda gosterim: '1.0' → 'v1.0'. */
export const formatVersion = (v) => `v${v}`

/** Kalici baglanti capasi: '1.2.5' → 'v1-2-5'. */
export const versionAnchor = (v) => `v${String(v).replace(/\./g, '-')}`

export const LATEST_RELEASE = RELEASES[0]
export const APP_VERSION = LATEST_RELEASE.version

/** Tur basina degisiklik sayisi (kahraman alanindaki ozet hapciklari). */
export function changeCounts(release) {
    return Object.fromEntries(CHANGE_KINDS.map((k) => [k, (release?.changes?.[k] || []).length]))
}

export const PATCH_NOTES_PATH = '/patch-notes'
