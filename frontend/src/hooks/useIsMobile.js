/**
 * =============================================================================
 * HERMES - useIsMobile
 * =============================================================================
 * Tek kaynak: "mobil mi?" sorusunun cevabi. Sayfalar bunu SORMAK yerine
 * kendi `window.innerWidth` okumasini yapinca ekran donunce/yeniden
 * boyutlaninca guncellenmeyen olu state olusuyordu.
 *
 * Neden CSS media query yetmiyor: mobilde filtreler GORUNMEZ olmakla
 * kalmiyor, AYNI kontroller bir sheet icinde YENIDEN render ediliyor.
 * Ikisini birden DOM'da tutmak ayni erisilebilir adi tasiyan iki kontrol
 * uretir (ekran okuyucu + test icin belirsizlik). Bu yuzden RENDER
 * seviyesinde ayrim yapilir.
 *
 * SSR/test guvenli: matchMedia yoksa `false` doner; listener temizlenir.
 * =============================================================================
 */
import { useEffect, useState } from 'react'

const QUERY = '(max-width: 768px)'

export default function useIsMobile() {
    const [isMobile, setIsMobile] = useState(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return false
        return window.matchMedia(QUERY).matches
    })

    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return undefined
        const mql = window.matchMedia(QUERY)
        const onChange = (e) => setIsMobile(e.matches)
        setIsMobile(mql.matches)
        // Safari <14 addEventListener'i desteklemez; her iki API de kapatilir.
        if (mql.addEventListener) mql.addEventListener('change', onChange)
        else mql.addListener(onChange)
        return () => {
            if (mql.removeEventListener) mql.removeEventListener('change', onChange)
            else mql.removeListener(onChange)
        }
    }, [])

    return isMobile
}
