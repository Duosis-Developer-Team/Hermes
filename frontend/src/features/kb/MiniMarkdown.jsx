/**
 * HERMES - Guvenli Markdown alt kumesi (bilgi bankasi, Dalga D3).
 *
 * HTML URETMEZ (dangerouslySetInnerHTML yok): metin React ogelerine
 * cevrilir, ham HTML etiketleri duz metin olarak gorunur. Desteklenen:
 *   # / ## / ###  baslik · paragraf · "- " / "* " / "1. " liste ·
 *   "> " alinti · ``` kod blogu ``` · **kalin** · _italik_ / *italik* ·
 *   `kod` · [metin](https://...) baglanti (yalniz http/https/mailto).
 */
import { Fragment } from 'react'

const SAFE_LINK = /^(https?:\/\/|mailto:)/i
// Siralama onemli: kod > baglanti > kalin > italik.
const INLINE = /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(_[^_]+_|\*[^*]+\*)/g

export function renderInline(text, keyBase = 'i') {
    const out = []
    let last = 0
    let i = 0
    for (const match of text.matchAll(INLINE)) {
        if (match.index > last) out.push(text.slice(last, match.index))
        const token = match[0]
        const key = `${keyBase}-${i++}`
        if (match[1]) {
            out.push(<code key={key}>{token.slice(1, -1)}</code>)
        } else if (match[2]) {
            const [, label, href] = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)
            out.push(SAFE_LINK.test(href)
                ? <a key={key} href={href} target="_blank" rel="noopener noreferrer">{label}</a>
                : <Fragment key={key}>{label}</Fragment>)
        } else if (match[3]) {
            out.push(<strong key={key}>{token.slice(2, -2)}</strong>)
        } else {
            out.push(<em key={key}>{token.slice(1, -1)}</em>)
        }
        last = match.index + token.length
    }
    if (last < text.length) out.push(text.slice(last))
    return out
}

/** Satirlari bloklara ayirir (saf; test edilebilir). */
export function parseBlocks(source) {
    const lines = String(source || '').replace(/\r\n/g, '\n').split('\n')
    const blocks = []
    let para = []
    const flush = () => { if (para.length) { blocks.push({ type: 'p', text: para.join(' ') }); para = [] } }
    for (let n = 0; n < lines.length; n++) {
        const line = lines[n]
        if (line.trim().startsWith('```')) {
            flush()
            const code = []
            n += 1
            while (n < lines.length && !lines[n].trim().startsWith('```')) { code.push(lines[n]); n += 1 }
            blocks.push({ type: 'code', text: code.join('\n') })
            continue
        }
        const heading = line.match(/^(#{1,3})\s+(.*)$/)
        if (heading) { flush(); blocks.push({ type: `h${heading[1].length}`, text: heading[2] }); continue }
        const bullet = line.match(/^\s*[-*]\s+(.*)$/)
        const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/)
        if (bullet || ordered) {
            flush()
            const type = bullet ? 'ul' : 'ol'
            const prev = blocks[blocks.length - 1]
            if (prev && prev.type === type) prev.items.push((bullet || ordered)[1])
            else blocks.push({ type, items: [(bullet || ordered)[1]] })
            continue
        }
        const quote = line.match(/^>\s?(.*)$/)
        if (quote) {
            flush()
            const prev = blocks[blocks.length - 1]
            if (prev && prev.type === 'quote') prev.text += ` ${quote[1]}`
            else blocks.push({ type: 'quote', text: quote[1] })
            continue
        }
        if (!line.trim()) { flush(); continue }
        para.push(line.trim())
    }
    flush()
    return blocks
}

export default function MiniMarkdown({ source, className = 'kb-md' }) {
    const blocks = parseBlocks(source)
    return (
        <div className={className}>
            {blocks.map((b, i) => {
                const key = `b${i}`
                if (b.type === 'code') return <pre key={key}><code>{b.text}</code></pre>
                if (b.type === 'ul' || b.type === 'ol') {
                    const List = b.type
                    return <List key={key}>{b.items.map((item, j) => <li key={j}>{renderInline(item, `${key}-${j}`)}</li>)}</List>
                }
                if (b.type === 'quote') return <blockquote key={key}>{renderInline(b.text, key)}</blockquote>
                if (b.type.startsWith('h')) {
                    const H = b.type === 'h1' ? 'h2' : b.type === 'h2' ? 'h3' : 'h4'
                    return <H key={key}>{renderInline(b.text, key)}</H>
                }
                return <p key={key}>{renderInline(b.text, key)}</p>
            })}
        </div>
    )
}

/** Yanita eklemek icin duz metin (isaretler ayiklanir). */
export function markdownToText(source) {
    return parseBlocks(source).map((b) => {
        const strip = (t) => t.replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
            .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(_|\*)([^_*]+)\1/g, '$2')
        if (b.type === 'ul') return b.items.map((x) => `• ${strip(x)}`).join('\n')
        if (b.type === 'ol') return b.items.map((x, i) => `${i + 1}. ${strip(x)}`).join('\n')
        return strip(b.text)
    }).join('\n\n')
}
