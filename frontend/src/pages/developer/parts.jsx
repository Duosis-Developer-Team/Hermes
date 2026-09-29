/**
 * Developer Portal — kucuk sunum parcalari (veri bilmez).
 *
 * `Rich`: sozluk metnindeki iki isaretlemeyi cizer — `kod` ve **kalin**.
 * Boylece cevrilen cumle kendi kod parcalarini tasir; HTML enjeksiyonu
 * YOK (dangerouslySetInnerHTML kullanilmaz, parcalar React dugumu olur).
 */
import { Fragment } from 'react'

const TOKEN = /(\*\*[^*]+\*\*|`[^`]+`)/g

export function Rich({ text }) {
    if (!text) return null
    const parts = String(text).split(TOKEN)
    return (
        <>
            {parts.map((p, i) => {
                if (p.startsWith('**') && p.endsWith('**') && p.length > 4) {
                    return <b key={i}>{p.slice(2, -2)}</b>
                }
                if (p.startsWith('`') && p.endsWith('`') && p.length > 2) {
                    return <code key={i}>{p.slice(1, -1)}</code>
                }
                return <Fragment key={i}>{p}</Fragment>
            })}
        </>
    )
}

/** Bolum basligi: kucuk ust etiket + baslik + tek cumlelik ozet. */
export function SectionHead({ eyebrow, title, lead, extra }) {
    return (
        <header className="dp-sec-head">
            <div>
                {eyebrow && <span className="dp-eyebrow">{eyebrow}</span>}
                <h2 className="dp-sec-head__title">{title}</h2>
                {lead && <p className="dp-sec-head__lead"><Rich text={lead} /></p>}
            </div>
            {extra && <div className="dp-sec-head__extra">{extra}</div>}
        </header>
    )
}

/** HTTP yontemi hapi: GET yesil, POST mavi, PATCH amber (token tonlari). */
export function Method({ m }) {
    return <span className={`dp-method dp-method--${m.toLowerCase()}`}>{m}</span>
}

/** Taranabilir madde listesi: her madde kendi `Rich` metni. */
export function Bullets({ items }) {
    return (
        <ul className="dp-bullets">
            {items.map((text, i) => <li key={i}><Rich text={text} /></li>)}
        </ul>
    )
}

/**
 * Katlanir ayrinti karti (native <details>): uzun konu metni ilk
 * bakista gizli, basliklar taranabilir. Klavye ve ekran okuyucu destegi
 * tarayicidan gelir.
 */
export function Fold({ title, hint, children, defaultOpen = false }) {
    return (
        <details className="dp-fold" open={defaultOpen}>
            <summary>
                <span className="dp-fold__text">
                    <b>{title}</b>
                    {hint && <small>{hint}</small>}
                </span>
                <span className="dp-fold__chev" aria-hidden="true" />
            </summary>
            <div className="dp-fold__body">{children}</div>
        </details>
    )
}
