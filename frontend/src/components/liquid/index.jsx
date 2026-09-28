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

/* =============================================================================
 * Pencere (modal) primitifleri — prototip "Pencereler v2"
 * =============================================================================
 * antd Modal'in davranisi (odak tuzagi, Escape, aria) aynen kalir; bunlar
 * yalniz icerigi prototip anatomisiyle kurar. Stil: liquid.css §Pencere.
 */

/**
 * Pencere basligi: renkli ikon kutusu + baslik + alt satir. antd Modal'a
 * `title` olarak verilir (aria-labelledby bu basliga baglanir).
 * `tone`: 'blue' | 'violet' | 'red' | 'green' | 'amber' | 'ink'.
 */
export function ModalHead({ icon, title, subtitle, tone = 'blue' }) {
    return (
        <div className="lq-mh">
            {icon && <span className={`lq-mico lq-mico--${tone}`} aria-hidden="true">{icon}</span>}
            <div className="lq-mh__text">
                <span className="lq-mh__title">{title}</span>
                {/* Alt satir ek bilgidir: diyalog ADI yalniz baslik kalsin
                    (aria-labelledby tum basligi okur). */}
                {subtitle && <span className="lq-mh__sub" aria-hidden="true">{subtitle}</span>}
            </div>
        </div>
    )
}

/** Adim cubugu: tamamlanan adimlar dolu, gecerli adim vurgulu. */
export function ModalSteps({ steps, current }) {
    return (
        <ol className="lq-steps">
            {steps.map((s, i) => (
                <li
                    key={s.key ?? i}
                    className={`${i <= current ? 'is-on' : ''} ${i === current ? 'is-cur' : ''}`}
                    aria-current={i === current ? 'step' : undefined}
                >
                    <span>{i + 1}. {s.label}</span>
                    {s.value && i < current && <b>{s.value}</b>}
                </li>
            ))}
        </ol>
    )
}

/**
 * Secenek kartlari (musteri/proje/etki secimi). Her secenek gercek bir
 * <button>; `tone` verilmezse bas harf kutusu addan renklenir.
 */
export function OptionGrid({ options, onPick, emptyText, ariaLabel }) {
    if (!options.length) {
        return emptyText ? <p className="lq-opt__empty" role="status">{emptyText}</p> : null
    }
    return (
        <div className="lq-opt" role="group" aria-label={ariaLabel}>
            {options.map((o, i) => (
                <button
                    key={o.value}
                    type="button"
                    className="lq-opt__item"
                    style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
                    onClick={() => onPick(o.value, o)}
                >
                    <span className="lq-opt__icon" style={o.flat ? undefined : { background: avatarTone(o.value) }} aria-hidden="true">
                        {o.icon ?? initialsOf(o.label).slice(0, 1)}
                    </span>
                    <span className="lq-opt__text">
                        <b>{o.label}</b>
                        {o.hint && <small>{o.hint}</small>}
                    </span>
                </button>
            ))}
        </div>
    )
}

/**
 * Cip secici (sure hizli secimi, oncelik, tur). antd Form.Item icinde
 * kontrol olarak calisir (`value` / `onChange`). Tek secimde anlamsal
 * olarak RADYO grubudur (role=radiogroup, ok tuslari secimi tasir);
 * `multiple` ile basili dugmeler (aria-pressed). `allowDeselect` ile
 * secili cipe yeniden basmak secimi temizler (filtre kullanimi).
 */
export function ChipGroup({ options, value, onChange, multiple = false, ariaLabel, mono = false, id, allowDeselect = false }) {
    const isOn = (v) => (multiple ? (value || []).includes(v) : value === v)
    const toggle = (v) => {
        // allowDeselect: secili cipe yeniden basmak secimi kaldirir (filtre).
        if (!multiple) return onChange?.(allowDeselect && value === v ? undefined : v)
        const cur = value || []
        onChange?.(cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v])
    }
    const onKeyDown = (e, i) => {
        if (multiple) return
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
        if (!step) return
        e.preventDefault()
        const next = (i + step + options.length) % options.length
        onChange?.(options[next].value)
        e.currentTarget.parentElement?.children[next]?.focus()
    }
    const current = options.findIndex((o) => isOn(o.value))
    return (
        <span
            className={`lq-dur${mono ? ' lq-dur--mono' : ''}`}
            role={multiple ? 'group' : 'radiogroup'}
            aria-label={ariaLabel}
            id={id}
        >
            {options.map((o, i) => (
                <button
                    key={String(o.value)}
                    type="button"
                    className={isOn(o.value) ? 'is-on' : undefined}
                    {...(multiple
                        ? { 'aria-pressed': isOn(o.value) }
                        : {
                            role: 'radio',
                            'aria-checked': isOn(o.value),
                            tabIndex: i === (current < 0 ? 0 : current) ? 0 : -1,
                        })}
                    onClick={() => toggle(o.value)}
                    onKeyDown={(e) => onKeyDown(e, i)}
                >
                    {o.label}
                </button>
            ))}
        </span>
    )
}

/** Form bolum etiketi: ince cizgiyle biten kucuk buyuk harfli baslik. */
export function FormSection({ children }) {
    return <div className="lq-grp">{children}</div>
}
