/**
 * =============================================================================
 * HERMES - Cok dilli arayuz (en | tr)
 * =============================================================================
 * Yeni bagimlilik YOK: sozluk duz nesne, cozum nokta-yollu bir arama.
 * i18next gibi bir kutuphane bu ihtiyaca gore agirdi — cogul kurallari,
 * namespace yukleme ve dil algilama zinciri BURADA GEREKMIYOR.
 *
 * Iki kural taviz vermez:
 *
 *   1. INGILIZCE KAYNAKTIR. `tr` bir anahtari tasimiyorsa `en` doner;
 *      kullanici ASLA ham anahtar gormez. Eksik ceviri bir gorunum
 *      kusuru olur, kirik bir ekran degil.
 *   2. ANLAM ODAKLI CEVIRI. `tr` metinleri kelime kelime cevrilmez;
 *      Hermes'in kendi sozlugunu kullanir (ornegin "work log" ->
 *      "is kaydi", "requester" -> "talep eden").
 *
 * Kullanim:
 *     const t = useT()
 *     t('nav.tasks')                      // "Tasks" / "Gorevler"
 *     t('tickets.count', { n: 5 })        // "5 tickets" / "5 talep"
 */

import { useCallback } from 'react'

import { useLocaleStore } from '../stores/localeStore'
import en from './en'
import tr from './tr'

export const dictionaries = { en, tr }

/** Nokta-yollu erisim: 'nav.tasks' -> obj.nav.tasks */
function lookup(dict, key) {
    let node = dict
    for (const part of key.split('.')) {
        if (node == null || typeof node !== 'object') return undefined
        node = node[part]
    }
    return typeof node === 'string' ? node : undefined
}

/** `{n}` bicimindeki yer tutuculari doldurur. */
function interpolate(text, vars) {
    if (!vars) return text
    return text.replace(/\{(\w+)\}/g, (match, name) => (
        Object.prototype.hasOwnProperty.call(vars, name)
            ? String(vars[name])
            : match
    ))
}

/**
 * Store'dan BAGIMSIZ cevirici — React disindaki yerlerde (ornegin bir
 * servis katmaninda) da kullanilabilsin diye ayri tutuldu.
 */
export function translate(locale, key, vars) {
    const dict = dictionaries[locale] ?? en
    const text = lookup(dict, key) ?? lookup(en, key)
    if (text === undefined) {
        // Anahtar HICBIR sozlukte yok: gelistirmede goze batsin, uretimde
        // ekrani kirmasin. Anahtarin kendisi okunabilir bir metindir.
        if (import.meta.env?.DEV) {
            // eslint-disable-next-line no-console
            console.warn(`[i18n] eksik anahtar: ${key}`)
        }
        return key
    }
    return interpolate(text, vars)
}

/**
 * Bilesenler icin: dil degisince yeniden render eder.
 *
 * Donen fonksiyon KARARLIDIR (yalnizca dil degisince yenilenir). Bu
 * onemli: her render'da yeni bir fonksiyon donseydi, `t`'yi bagimlilik
 * dizisine yazan her `useMemo`/`useEffect` her render'da yeniden
 * kosardi — yani memo'lar islevsiz kalirdi. Kararli oldugu icin `t`
 * bagimliliklara GUVENLE yazilabilir ve dil degisince icerik gercekten
 * tazelenir.
 */
export function useT() {
    const locale = useLocaleStore((s) => s.locale)
    return useCallback((key, vars) => translate(locale, key, vars), [locale])
}

export default useT
