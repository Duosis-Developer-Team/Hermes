/**
 * HERMES - Dil altyapisi: yedek dusme, parite ve dil dugmesi.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import en from '../../i18n/en'
import tr from '../../i18n/tr'
import { translate } from '../../i18n'
import { useLocaleStore } from '../../stores/localeStore'

/** Ic ice sozlugu 'a.b.c' anahtarlarina duzler. */
function flatten(obj, prefix = '') {
    return Object.entries(obj).flatMap(([k, v]) => (
        typeof v === 'string'
            ? [`${prefix}${k}`]
            : flatten(v, `${prefix}${k}.`)
    ))
}

describe('i18n sozlukleri', () => {
    it('Turkce sozluk Ingilizce ile AYNI anahtarlari tasir', () => {
        // Parite bilerek KATI: eksik bir anahtar sessizce Ingilizce
        // gorunur ve yarim cevrilmis bir ekran uretir. Burada dusmesi,
        // canlida fark edilmesinden iyidir.
        const enKeys = flatten(en).sort()
        const trKeys = flatten(tr).sort()
        expect(trKeys).toEqual(enKeys)
    })

    it('Turkce metinler Ingilizce ile AYNI olmamalidir', () => {
        // Kopyala-yapistir kalan anahtarlari yakalar. Ozel adlar ve
        // kisaltmalar (API, Hermes, TR/EN) haric tutulur.
        // Turkce'de AYNI kalan sozcukler (odunc alinmis ya da kisaltma).
        // Liste bilerek kisa: her eklenen madde "cevrilmedi mi, yoksa
        // gercekten ayni mi?" sorusunu bir kez daha sordurur.
        const SAME_BY_DESIGN = new Set([
            'nav.apiManagement', 'nav.platforms', 'nav.projects',
            'entity.platform', 'entity.platforms',
            // Saf BICIM dizgesi (prose degil): "{entity} ({n})".
            'admin.entityCount', 'logTime.platform',
        ])
        const untranslated = flatten(en).filter((key) => {
            if (SAME_BY_DESIGN.has(key)) return false
            return translate('tr', key) === translate('en', key)
        })
        expect(untranslated).toEqual([])
    })
})

describe('cozumleyici', () => {
    it('eksik anahtarda Ingilizce\'ye duser, ham anahtar GOSTERMEZ', () => {
        // Sozlukte OLMAYAN bir anahtar: cozumleyici anahtarin kendisini
        // doner (gelistirmede goze batar) ama var olan bir anahtar ASLA
        // ham anahtar olarak gorunmez.
        expect(translate('tr', 'yok.boyle.bir.anahtar')).toBe('yok.boyle.bir.anahtar')
        expect(translate('tr', 'common.save')).not.toBe('common.save')
    })

    it('bilinmeyen dilde Ingilizce kullanir', () => {
        expect(translate('de', 'common.save')).toBe(en.common.save)
    })

    it('yer tutuculari doldurur', () => {
        expect(translate('en', 'common.save', { x: 1 })).toBe(en.common.save)
    })
})

describe('dil deposu', () => {
    beforeEach(() => {
        useLocaleStore.getState().setLocale('en')
    })

    it('gecis yapar ve <html lang> yazar', () => {
        useLocaleStore.getState().toggleLocale()
        expect(useLocaleStore.getState().locale).toBe('tr')
        expect(document.documentElement.getAttribute('lang')).toBe('tr')

        useLocaleStore.getState().toggleLocale()
        expect(useLocaleStore.getState().locale).toBe('en')
        expect(document.documentElement.getAttribute('lang')).toBe('en')
    })

    it('desteklenmeyen dili Ingilizce\'ye sabitler', () => {
        useLocaleStore.getState().setLocale('fr')
        expect(useLocaleStore.getState().locale).toBe('en')
    })
})
