/**
 * Arama katlama: buyuk/kucuk harf ve Turkce/Ingilizce karakter duyarsiz
 * (CTO 05.10: "i" yazinca "IGA" gelmiyordu — toLocaleLowerCase('tr')
 * "IGA"yi "ıga" yapiyordu).
 */
import { describe, expect, it } from 'vitest'

import { foldSearch, matchesAny, matchesSearch, selectFilter } from '../../utils/searchText'

describe('searchText', () => {
    it.each([
        ['IGA', 'i'], ['IGA', 'iga'], ['İGA', 'iga'], ['iga', 'İGA'], ['IGA', 'ı'],
        ['Sabancı DX', 'sabanci'], ['Türk Telekom', 'turk'], ['Öztiryakiler', 'oz'],
        ['Şişecam', 'sisecam'], ['Çelik', 'CELIK'], ['Doğuş', 'dogus'], ['Turkcell', 'TÜRKCELL'],
    ])('%s ~ %s', (text, query) => {
        expect(matchesSearch(text, query)).toBe(true)
    })

    it('eslesmeyen sorgu ve bos sorgu', () => {
        expect(matchesSearch('Aygaz', 'iga')).toBe(false)
        expect(matchesSearch('Aygaz', '   ')).toBe(true)
        expect(foldSearch('İSTANBUL ışık')).toBe('istanbul isik')
    })

    it('matchesAny null alanlari atlar', () => {
        expect(matchesAny([null, undefined, 'IGA Havalimani'], 'havalimanı')).toBe(true)
        expect(matchesAny([null], 'x')).toBe(false)
    })

    it('selectFilter metin etiketi uzerinden (deger/UUID uzerinden DEGIL)', () => {
        expect(selectFilter('i', { value: 'uuid-1', label: 'IGA' })).toBe(true)
        expect(selectFilter('uuid', { value: 'uuid-1', label: 'IGA' })).toBe(false)
        expect(selectFilter('ig', { value: 'x', label: <b>IGA</b>, searchText: 'IGA' })).toBe(true)
    })
})
