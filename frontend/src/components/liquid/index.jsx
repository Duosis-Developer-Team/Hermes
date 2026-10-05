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

import { userPhotoUrl, useUserPhotoStore } from '../../stores/userPhotoStore'
import { customerLogoUrl, projectLogoUrl, useCustomerLogoStore } from '../../stores/customerLogoStore'
import { genericLogoUrl } from '../../features/projectTypes/genericLogo'

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

/** Sayiyi 0'dan hedefe yumusakca sayar (ease-out). Yalniz ILK gosterimde:
 *  sonraki deger degisimleri (orn. tarih araligi) animasyonsuz yerine oturur. */
export function CountUp({ value, decimals = 0, duration = 900, format }) {
    const target = Number(value) || 0
    const [shown, setShown] = useState(() => (reducedMotion() ? target : 0))
    const playedRef = useRef(false)
    useEffect(() => {
        if (reducedMotion() || playedRef.current) { setShown(target); return undefined }
        playedRef.current = true
        let frame = 0
        const start = performance.now()
        const from = 0
        const tick = () => {
            // Ilerleme ayni saatten (performance.now) olculur: rAF damgasi
            // ortama gore farkli kokten gelebilir; negatif ilerleme olmaz.
            const k = Math.min(1, Math.max(0, (performance.now() - start) / duration))
            const eased = 1 - Math.pow(1 - k, 3)
            setShown(from + (target - from) * eased)
            if (k < 1) frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
        return () => {
            cancelAnimationFrame(frame)
            // Yarida kesilen ilk animasyon (StrictMode cift effect'i) hakki yakmaz.
            if (performance.now() - start < duration) playedRef.current = false
        }
    }, [target, duration])
    const n = Number(shown.toFixed(decimals))
    return <>{format ? format(n) : n.toLocaleString(undefined, { maximumFractionDigits: decimals })}</>
}

/** Ilerleme halkasi: acilista cizilerek dolar. `value` 0–100. */
export function Ring({ value = 0, size = 132, stroke = 12, children, label, color = 'var(--hp-blue-500)' }) {
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
                    stroke={color} {...line} strokeLinecap="round"
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

/**
 * Yuvarlak avatar: Microsoft profil fotografi varsa o, yoksa (ya da
 * yuklenemezse) bas harfler. Foto dizini kabuktan gelir (userPhotoStore).
 */
export function Avatar({ id, name, size = 28, title, className = '' }) {
    const etag = useUserPhotoStore((s) => (id ? s.etags[id] : undefined))
    const [failed, setFailed] = useState(false)
    const showPhoto = etag && !failed
    return (
        <span
            className={`lq-av${showPhoto ? ' lq-av--photo' : ''} ${className}`}
            style={{ background: showPhoto ? undefined : avatarTone(id || name), width: size, height: size, fontSize: Math.round(size * 0.38) }}
            title={title ?? name}
            aria-label={name}
            role="img"
        >
            {showPhoto ? (
                <img src={userPhotoUrl(id, etag)} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
            ) : initialsOf(name)}
        </span>
    )
}

/**
 * Musteri marka logosu (kare karo). Logo yoksa (ya da yuklenemezse) renkli
 * bas harf karosu — yonetim tablosundaki rozetle ayni dil. `etag` verilirse
 * depo yerine o kullanilir (ornegin pasif musteriler, depoda olmayanlar).
 */
export function CustomerLogo({ id, name, size = 28, etag: etagProp, className = '', title }) {
    const stored = useCustomerLogoStore((s) => (id ? s.etags[id] : undefined))
    const etag = etagProp === undefined ? stored : etagProp
    const [failed, setFailed] = useState(null)
    if (id && etag && failed !== etag) {
        return (
            <span className={`lq-brand ${className}`} title={title}>
                <LogoTile src={customerLogoUrl(id, etag)} size={size} onFail={() => setFailed(etag)} />
            </span>
        )
    }
    return (
        <span
            className={`lq-clogo ${className}`}
            style={{
                width: size,
                height: size,
                borderRadius: Math.round(size * 0.28),
                fontSize: Math.round(size * 0.44),
                background: avatarTone(id || name),
            }}
            title={title}
            aria-hidden="true"
        >
            {(name || '?').trim().charAt(0).toLocaleUpperCase()}
        </span>
    )
}

// Yatay (yazi) logolar kare karoda okunmaz: karo gorselin oranina gore
// en fazla bu kat genisler (yukseklik sabit).
const LOGO_MAX_RATIO = 2.2

/** Tek logo karosu (gorsel); yuklenemezse `onFail`. Oran yuklenince olculur. */
function LogoTile({ src, size, onFail, generic = false }) {
    const [ratio, setRatio] = useState(1)
    const onLoad = (e) => {
        const { naturalWidth: w, naturalHeight: h } = e.currentTarget
        if (w > 0 && h > 0) setRatio(Math.min(LOGO_MAX_RATIO, Math.max(1, w / h)))
    }
    return (
        <span
            className={`lq-clogo lq-clogo--img${generic ? ' lq-clogo--generic' : ''}${ratio > 1.15 ? ' lq-clogo--wide' : ''}`}
            style={{ width: Math.round(size * ratio), height: size, borderRadius: Math.round(size * 0.28) }}
            aria-hidden="true"
        >
            <img src={src} alt="" loading="lazy" decoding="async" onLoad={onLoad} onError={onFail} />
        </span>
    )
}

/**
 * Jenerik proje logosu: tur RENGI + glif (features/projectTypes). Renk
 * verilmezse notr gri. Gorsel istemcide uretilir; ag istegi yok.
 */
export function GenericLogo({ glyph, color, size = 28 }) {
    const src = genericLogoUrl(glyph, color)
    if (!src) return null
    // Jenerik logo kendi karosunu tasir: beyaz cerceve/ic bosluk yok.
    return <LogoTile src={src} size={size} generic />
}

/**
 * Proje logosu: yuklenmis ozel logo > jenerik logo (tur rengi + glif).
 * Ikisi de yoksa ya da yuklenemezse `fallback` (varsayilan: hicbir sey) —
 * secicilerde projenin kendi ikonu korunur.
 */
export function ProjectLogo({ id, size = 28, fallback = null }) {
    const etag = useCustomerLogoStore((s) => (id ? s.projects[id] : undefined))
    const generic = useCustomerLogoStore((s) => (id ? s.generic[id] : undefined))
    const [failed, setFailed] = useState(null)
    if (id && etag && failed !== etag) {
        return <LogoTile src={projectLogoUrl(id, etag)} size={size} onFail={() => setFailed(etag)} />
    }
    if (generic) return <GenericLogo glyph={generic.glyph} color={generic.color} size={size} />
    return fallback
}

/**
 * Marka logolari (CTO 29.09): musteri + proje logosu ikisi de varsa YAN
 * YANA; yalniz biri varsa o; hicbiri yoksa (ya da gorseller yuklenemezse)
 * `fallback` (verilmezse musteri bas harf karosu). Etag'ler depodan
 * (MainLayout doldurur). Kirik gorsel ikonu asla gosterilmez.
 */
export function BrandLogos({
    customerId, customerName, projectId, projectName, size = 36, fallback, className = '',
}) {
    const cStored = useCustomerLogoStore((s) => (customerId ? s.etags[customerId] : undefined))
    const pStored = useCustomerLogoStore((s) => (projectId ? s.projects[projectId] : undefined))
    const pGeneric = useCustomerLogoStore((s) => (projectId ? s.generic[projectId] : undefined))
    const [failed, setFailed] = useState({})
    const cEtag = cStored && failed.c !== cStored ? cStored : undefined
    const pEtag = pStored && failed.p !== pStored ? pStored : undefined
    // Yuklenmis proje logosu yoksa jenerik logo (tur rengi + glif).
    const pGenericUrl = !pEtag && pGeneric ? genericLogoUrl(pGeneric.glyph, pGeneric.color) : null
    if (!cEtag && !pEtag && !pGenericUrl) {
        if (fallback !== undefined) return fallback
        return <CustomerLogo id={customerId} name={customerName || projectName} size={size} etag={null} className={className} />
    }
    return (
        <span className={`lq-brand ${className}`} data-logos={cEtag && (pEtag || pGenericUrl) ? 'both' : cEtag ? 'customer' : 'project'}>
            {cEtag && <LogoTile src={customerLogoUrl(customerId, cEtag)} size={size} onFail={() => setFailed((f) => ({ ...f, c: cEtag }))} />}
            {pEtag && <LogoTile src={projectLogoUrl(projectId, pEtag)} size={size} onFail={() => setFailed((f) => ({ ...f, p: pEtag }))} />}
            {pGenericUrl && <LogoTile src={pGenericUrl} size={size} generic />}
        </span>
    )
}

/**
 * Yatay cubuk listesi (prototip "Musteriye / Projeye gore"): ad · soldan
 * buyuyen cubuk · deger. En buyuk degere oranlanir. `tone`: 'blue' |
 * 'violet' | 'green'.
 */
export function BarList({ items = [], tone = 'blue', format = (v) => v, emptyText, animate = true }) {
    const max = Math.max(0, ...items.map((it) => Number(it.value) || 0))
    if (!items.length || max <= 0) {
        return emptyText ? <p className="lq-barlist__empty" role="status">{emptyText}</p> : null
    }
    return (
        <ul className={`lq-barlist lq-barlist--${tone}${animate ? '' : ' lq-barlist--static'}`}>
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
export function ModalHead({ icon, title, subtitle, tone = 'blue', media }) {
    return (
        <div className="lq-mh">
            {media ?? (icon && <span className={`lq-mico lq-mico--${tone}`} aria-hidden="true">{icon}</span>)}
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
                    {o.media ?? (
                        <span className="lq-opt__icon" style={o.flat ? undefined : { background: avatarTone(o.value) }} aria-hidden="true">
                            {o.icon ?? initialsOf(o.label).slice(0, 1)}
                        </span>
                    )}
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
