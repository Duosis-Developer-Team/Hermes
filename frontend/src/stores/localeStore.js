/**
 * =============================================================================
 * HERMES PLATFORM - Locale Store (Zustand)
 * =============================================================================
 * Arayuz dili: `en` | `tr`. Tema deposuyla AYNI deseni izler — secim
 * hassas veri degildir, localStorage'da saklanir.
 *
 * VARSAYILAN `en`: Hermes bugune kadar Ingilizceydi ve mevcut
 * kullanicilarin ekrani bir guncelleme yuzunden dil degistirmez. Turkce
 * ACIK bir tercihtir.
 *
 * Secim uc yere birden yansir ve ucu de MODUL YUKLENIRKEN uygulanir
 * (React mount'undan once), boylece ilk paint'te yanlis dil gorunmez:
 *   1. `<html lang>`  — erisilebilirlik ve tarayici cevirisi icin
 *   2. dayjs locale   — tarih/ay adlari
 *   3. store durumu   — React tarafi
 *
 * AntD'nin KENDI metinleri (sayfalama, "No data", tarih secici) buradan
 * DEGIL, Root.jsx'teki ConfigProvider'dan gelir; ikisi ayni depoya
 * baglidir.
 */

import { create } from 'zustand'
import dayjs from 'dayjs'
import 'dayjs/locale/en'
import 'dayjs/locale/tr'

const STORAGE_KEY = 'hermes-locale'

export const SUPPORTED_LOCALES = ['en', 'tr']

function readInitialLocale() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (SUPPORTED_LOCALES.includes(saved)) return saved
    } catch {
        /* localStorage kapali (gizli sekme) — varsayilana dus */
    }
    return 'en'
}

function applyLocale(locale) {
    dayjs.locale(locale)
    if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('lang', locale)
    }
}

const initialLocale = readInitialLocale()
applyLocale(initialLocale)

export const useLocaleStore = create((set, get) => ({
    locale: initialLocale,

    setLocale: (locale) => {
        const next = SUPPORTED_LOCALES.includes(locale) ? locale : 'en'
        applyLocale(next)
        try {
            localStorage.setItem(STORAGE_KEY, next)
        } catch {
            /* kalicilik basarisiz olabilir; secim yine de bu oturumda gecerli */
        }
        set({ locale: next })
    },

    toggleLocale: () => {
        get().setLocale(get().locale === 'tr' ? 'en' : 'tr')
    },
}))

export default useLocaleStore
