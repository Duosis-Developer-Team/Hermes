/**
 * DS V2 token kilitleri (Sprint 2 §14): semantic katman iki temada da
 * eksiksiz; metin/yuzey ciftleri WCAG AA kontrastindan gecer; motion +
 * reduced-motion + z-index sozlesmesi mevcut; AntD koprusunun JS aynasi
 * tokens.css ile ESITLENIR (drift = kirmizi).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SEMANTIC } from '../../theme/antdTheme'

const CSS = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../styles/tokens.css'),
    'utf8',
)

// --- kucuk cozumleyici: once --hp-*, sonra tema bloklari ---------------
const parseVars = (block) => {
    const out = {}
    for (const m of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim()
    return out
}
const rootBlock = CSS.split(":root[data-theme='light']")[0]
const lightBlock = CSS.split(":root[data-theme='light']")[1] ?? ''
const base = parseVars(rootBlock)
const light = { ...base, ...parseVars(lightBlock) }

const resolve = (vars, name, depth = 0) => {
    if (depth > 5) throw new Error('var dongusu: ' + name)
    const v = vars[name]
    const m = v && v.match(/^var\((--[\w-]+)\)$/)
    return m ? resolve(vars, m[1], depth + 1) : v
}

const SEMANTIC_NAMES = [
    '--h-bg-canvas','--h-bg-surface','--h-bg-elevated','--h-bg-hover',
    '--h-bg-selected','--h-text-primary','--h-text-secondary',
    '--h-text-muted','--h-border-subtle','--h-border-default',
    '--h-border-strong','--h-brand','--h-brand-hover','--h-focus',
    '--h-success','--h-warning','--h-danger','--h-info',
]

// --- WCAG kontrast ------------------------------------------------------
const lum = (hex) => {
    const c = hex.replace('#','')
    const f = (i) => {
        const v = parseInt(c.slice(i, i+2), 16) / 255
        return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4)
    }
    return 0.2126*f(0) + 0.7152*f(2) + 0.0722*f(4)
}
const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x)
    return (l1 + 0.05) / (l2 + 0.05)
}

describe('semantic token katmani', () => {
    it('paketteki 18 semantic token iki temada da cozulur', () => {
        for (const name of SEMANTIC_NAMES) {
            expect(resolve(base, name), `dark ${name}`).toBeTruthy()
            expect(resolve(light, name), `light ${name}`).toBeTruthy()
        }
    })

    it('spacing/radius/z-index/motion sozlesmeleri mevcut', () => {
        for (const t of ['--h-space-4','--h-radius-card','--h-radius-modal',
                         '--h-z-modal','--h-z-toast','--h-motion-fast',
                         '--h-ease-standard'])
            expect(base[t], t).toBeTruthy()
        // z katmanlari sirali (rastgele 9999 yasagi yapisal)
        const z = ['base','sticky','shell','dropdown','drawer','modal','toast']
            .map((k) => parseInt(base[`--h-z-${k}`]))
        expect([...z].sort((a,b)=>a-b)).toEqual(z)
        expect(Math.max(...z)).toBeLessThan(1000)
    })

    it('reduced-motion blogu mevcut ve app koku ile scope edilmis', () => {
        expect(CSS).toContain('@media (prefers-reduced-motion: reduce)')
        expect(CSS).toContain('#root *')
        expect(CSS).toContain('animation-duration: 0.01ms')
    })
})

describe('WCAG kontrast (AA)', () => {
    const pairs = (vars, label) => {
        const surfaces = ['--h-bg-canvas','--h-bg-surface','--h-bg-elevated']
        for (const surface of surfaces) {
            const bg = resolve(vars, surface)
            expect(ratio(resolve(vars,'--h-text-primary'), bg),
                `${label} text-primary/${surface}`).toBeGreaterThanOrEqual(4.5)
            expect(ratio(resolve(vars,'--h-text-secondary'), bg),
                `${label} text-secondary/${surface}`).toBeGreaterThanOrEqual(4.5)
            // muted: buyuk/ikincil metin siniri (AA large = 3.0)
            expect(ratio(resolve(vars,'--h-text-muted'), bg),
                `${label} text-muted/${surface}`).toBeGreaterThanOrEqual(3.0)
        }
        // marka uzerindeki metin
        expect(ratio(resolve(vars,'--h-on-brand'), resolve(vars,'--h-brand')),
            `${label} on-brand`).toBeGreaterThanOrEqual(3.0)
    }
    it('dark tema gecer', () => pairs(base, 'dark'))
    it('light tema gecer', () => pairs(light, 'light'))
})

describe('AntD koprusu ↔ tokens.css esitligi', () => {
    const mapping = {
        canvas: '--h-bg-canvas', surface: '--h-bg-surface',
        elevated: '--h-bg-elevated', hover: '--h-bg-hover',
        textPrimary: '--h-text-primary', textSecondary: '--h-text-secondary',
        borderSubtle: '--h-border-subtle', borderDefault: '--h-border-default',
        brand: '--h-brand', success: '--h-success',
        warning: '--h-warning', danger: '--h-danger',
    }
    it('dark ayna esit', () => {
        for (const [js, cssVar] of Object.entries(mapping))
            expect(SEMANTIC.dark[js].toUpperCase(), js)
                .toBe(resolve(base, cssVar).toUpperCase())
    })
    it('light ayna esit', () => {
        for (const [js, cssVar] of Object.entries(mapping))
            expect(SEMANTIC.light[js].toUpperCase(), js)
                .toBe(resolve(light, cssVar).toUpperCase())
    })
})
