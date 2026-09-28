/**
 * =============================================================================
 * HERMES LIQUID — sayfa primitifleri (prototip v8 → kod)
 * =============================================================================
 * Stil: styles/liquid.css (global). Buradaki bilesenler veri BILMEZ; sayfa
 * kendi verisini prop olarak verir. Hareketler (sayma, halka cizimi, kayan
 * gosterge) azaltilmis hareket tercihinde ANINDA son duruma gecer.
 * =============================================================================
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const reducedMotion = () =>
    typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

/** Sayfa basligi: buyuk baslik + alt satir + sagda eylemler. */
export function PageHero({ title, subtitle, actions, className = '', ...rest }) {
    return (
        <header className={`lq-hero ${className}`} {...rest}>
            <div>
                <h1 className="lq-hero__title">{title}</h1>
                {subtitle && <div className="lq-hero__sub">{subtitle}</div>}
            </div>
            {actions && <div className="lq-hero__actions">{actions}</div>}
        </header>
    )
}

/** Buzlu cam kart; imleci izleyen isima CSS degiskenleriyle. */
export function GlassCard({ as: Tag = 'section', className = '', title, link, children, onPointerMove, ...rest }) {
    const handleMove = (e) => {
        const r = e.currentTarget.getBoundingClientRect()
        e.currentTarget.style.setProperty('--gx', `${e.clientX - r.left}px`)
        e.currentTarget.style.setProperty('--gy', `${e.clientY - r.top}px`)
        onPointerMove?.(e)
    }
    return (
        <Tag className={`lq-card ${className}`} onPointerMove={handleMove} {...rest}>
            {(title || link) && (
                <div className="lq-card__head">
                    {typeof title === 'string' ? <h3 className="lq-card__title">{title}</h3> : title}
                    {link}
                </div>
            )}
            {children}
        </Tag>
    )
}

/** Sayiyi 0'dan hedefe yumusakca sayar (ease-out). */
export function CountUp({ value, decimals = 0, duration = 900, format }) {
    const target = Number(value) || 0
    const [shown, setShown] = useState(() => (reducedMotion() ? target : 0))
    useEffect(() => {
        if (reducedMotion()) { setShown(target); return undefined }
        let frame = 0
        const start = performance.now()
        const from = 0
        const tick = (now) => {
            const k = Math.min(1, (now - start) / duration)
            const eased = 1 - Math.pow(1 - k, 3)
            setShown(from + (target - from) * eased)
            if (k < 1) frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(frame)
    }, [target, duration])
    const n = Number(shown.toFixed(decimals))
    return <>{format ? format(n) : n.toLocaleString(undefined, { maximumFractionDigits: decimals })}</>
}

/** Ilerleme halkasi: acilista cizilerek dolar. `value` 0–100. */
export function Ring({ value = 0, size = 132, stroke = 12, children, label }) {
    const r = (size - stroke) / 2
    const c = 2 * Math.PI * r
    const pct = Math.max(0, Math.min(100, Number(value) || 0))
    // SVG cizgi kalinligi nesneyle verilir: `strokeWidth=` deseni antd'nin
    // kaldirilan Progress prop'u icin yasakli (frontendDebt kilidi).
    const line = { strokeWidth: stroke }
    const [drawn, setDrawn] = useState(() => (reducedMotion() ? pct : 0))
    useEffect(() => {
        if (reducedMotion()) { setDrawn(pct); return undefined }
        const id = requestAnimationFrame(() => setDrawn(pct))
        return () => cancelAnimationFrame(id)
    }, [pct])
    return (
        <div className="lq-ring" style={{ position: 'relative', width: size, height: size }} role="img" aria-label={label}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--h-bg-hover)" {...line} />
                <circle
                    cx={size / 2} cy={size / 2} r={r} fill="none"
                    stroke="var(--hp-blue-500)" {...line} strokeLinecap="round"
                    strokeDasharray={c} strokeDashoffset={c * (1 - drawn / 100)}
                />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
                {children}
            </div>
        </div>
    )
}

/**
 * Hap segment + yayli kayan gosterge (prototipteki .seg).
 * options: [{ value, label }]; kontrollu bilesen.
 */
export function LiquidSegmented({ options, value, onChange, ariaLabel, className = '' }) {
    const wrapRef = useRef(null)
    const [ind, setInd] = useState({ left: 3, width: 0 })
    useLayoutEffect(() => {
        const el = wrapRef.current?.querySelector('button.is-on')
        if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth })
    }, [value, options])
    return (
        <div className={`lq-seg ${className}`} role="group" aria-label={ariaLabel} ref={wrapRef}>
            <span className="lq-seg__ind" style={{ left: ind.left, width: ind.width }} aria-hidden="true" />
            {options.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    className={o.value === value ? 'is-on' : undefined}
                    aria-pressed={o.value === value}
                    onClick={() => onChange?.(o.value)}
                >
                    {o.label}
                </button>
            ))}
        </div>
    )
}

// Kisi rengi: kimlikten deterministik (ayni kisi her ekranda ayni renk).
const AV_TONES = ['#388BFF', '#8F7EE7', '#22A06B', '#E2483D', '#946F00', '#0C66E4', '#6E5DD3', '#1F845A']
export function avatarTone(id = '') {
    let h = 0
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    return AV_TONES[h % AV_TONES.length]
}
export function initialsOf(name = '') {
    const parts = String(name).replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean)
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
}

/** Bas harfli yuvarlak avatar. */
export function Avatar({ id, name, size = 28, title }) {
    return (
        <span
            className="lq-av"
            style={{ background: avatarTone(id || name), width: size, height: size, fontSize: Math.round(size * 0.38) }}
            title={title ?? name}
            aria-label={name}
        >
            {initialsOf(name)}
        </span>
    )
}

/**
 * Yatay cubuk listesi (prototip "Musteriye / Projeye gore"): ad · soldan
 * buyuyen cubuk · deger. En buyuk degere oranlanir. `tone`: 'blue' |
 * 'violet' | 'green'.
 */
export function BarList({ items = [], tone = 'blue', format = (v) => v, emptyText }) {
    const max = Math.max(0, ...items.map((it) => Number(it.value) || 0))
    if (!items.length || max <= 0) {
        return emptyText ? <p className="lq-barlist__empty" role="status">{emptyText}</p> : null
    }
    return (
        <ul className={`lq-barlist lq-barlist--${tone}`}>
            {items.map((it, i) => (
                <li key={it.key ?? it.name} className="lq-barlist__row">
                    <span className="lq-barlist__name" title={it.name}>{it.name}</span>
                    <span className="lq-barlist__track" aria-hidden="true">
                        <i style={{ width: `${((Number(it.value) || 0) / max) * 100}%`, animationDelay: `${i * 60}ms` }} />
                    </span>
                    <span className="lq-barlist__value">{format(it.value)}</span>
                </li>
            ))}
        </ul>
    )
}
