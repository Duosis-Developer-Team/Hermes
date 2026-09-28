/**
 * =============================================================================
 * HERMES LIQUID — sivi zemin katmani (R2)
 * =============================================================================
 * Tam ekran, SABIT (position: fixed) ve etkilesimsiz (pointer-events: none)
 * dekoratif katman: taban gradyani + yavas akan yumusak blob'lar + imleci
 * gecikmeli izleyen bir blob + cok hafif gren. Uzerinde tam ekran yari
 * saydam cam kabuk tonu ve kenardan gecen ince cizgi cerceve durur.
 *
 * PROTOTIPLE BIREBIR (29.09, CTO): duz renkli, bicim degistiren blob'lar
 * + katman duzeyinde tek `filter: blur(56px) saturate(1.25)` + gren.
 * Olcum (2x ekran): kayan kartlarda backdrop-filter kaldirildiktan sonra
 * bu katmanla 60 fps korunur. Azaltilmis harekette animasyon ve imlec
 * takibi durur.
 * =============================================================================
 */
import { useEffect, useRef } from 'react'

export default function LiquidBackdrop() {
    const followRef = useRef(null)

    useEffect(() => {
        const el = followRef.current
        if (!el || typeof window === 'undefined') return undefined
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
        if (reduce) return undefined
        let frame = 0
        const onMove = (e) => {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(() => {
                el.style.setProperty('--mx', `${e.clientX}px`)
                el.style.setProperty('--my', `${e.clientY}px`)
            })
        }
        window.addEventListener('pointermove', onMove, { passive: true })
        return () => {
            cancelAnimationFrame(frame)
            window.removeEventListener('pointermove', onMove)
        }
    }, [])

    return (
        <>
            <div className="liquid-backdrop" aria-hidden="true">
                <i className="liquid-blob liquid-blob--a" />
                <i className="liquid-blob liquid-blob--b" />
                <i className="liquid-blob liquid-blob--c" />
                <i className="liquid-blob liquid-blob--d" />
                <i className="liquid-blob liquid-blob--e" />
                <i className="liquid-blob liquid-blob--follow" ref={followRef} />
            </div>
            <div className="liquid-grain" aria-hidden="true" />
            <div className="liquid-shell-tint" aria-hidden="true" />
            <div className="liquid-bezel" aria-hidden="true" />
        </>
    )
}
