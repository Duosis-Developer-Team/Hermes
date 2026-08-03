/**
 * =============================================================================
 * Premium UI — yapisal kilitler (KAYNAK TARAMASI)
 * =============================================================================
 * frontendDebt.test.js gelenegi: davranis degil YAPISAL kural.
 *   1. Merkezi premium koprusu var, main.jsx'e bagli, temiz
 *      (!important YOK, ham hex YOK — semantic token zorunlu).
 *   2. Yuzey rolu + gradient tokenlari IKI temada da tanimli.
 *   3. Submit Period urun kaynagindan TAMAMEN silindi.
 *   4. Eski gri levha katmani (AdminPages !important yigini) geri gelmez.
 * =============================================================================
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = 'src'
const read = (f) => readFileSync(join(SRC, f), 'utf8')

describe('merkezi premium koprusu', () => {
    it('premium.css main.jsx tarafindan yuklenir', () => {
        expect(read('main.jsx')).toContain("./styles/premium.css")
    })

    it('premium.css !important icermez (yorumlar haric)', () => {
        const css = read('styles/premium.css').replace(/\/\*[\s\S]*?\*\//g, '')
        expect(css).not.toContain('!important')
    })

    it('premium.css ham HEX renk icermez (token zorunlu)', () => {
        const css = read('styles/premium.css').replace(/\/\*[\s\S]*?\*\//g, '')
        expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) || []).toEqual([])
    })
})

describe('yuzey ve gradient tokenlari', () => {
    it('surface rolleri + gradient iki temada da tanimli', () => {
        const tokens = read('styles/tokens.css')
        for (const name of [
            '--h-surface-subtle', '--h-surface-interactive',
            '--h-surface-overlay', '--h-surface-danger',
            '--h-grad-primary', '--h-grad-primary-hover',
        ]) {
            const n = (tokens.match(new RegExp(`${name}:`, 'g')) || []).length
            expect(n, name).toBeGreaterThanOrEqual(2) // dark + light
        }
    })
})

describe('Submit Period tamamen silindi', () => {
    it('bilesen dosyalari yok', () => {
        for (const f of [
            'components/time-entry/SubmitPeriodDropdown.jsx',
            'components/time-entry/SubmitPeriodDropdown.css',
            'components/modals/SubmitPeriodModal.jsx',
            'components/modals/SubmitPeriodModal.css',
        ]) {
            expect(existsSync(join(SRC, f)), f).toBe(false)
        }
    })

    it('services/api timesheetService tasimiyor; urun kaynaginda referans yok', () => {
        expect(read('services/api.js')).not.toContain('timesheetService')
        expect(read('pages/TimeEntryPage.jsx')).not.toMatch(/SubmitPeriod|periodStatus/)
    })
})

describe('eski gri levha katmani geri gelmez', () => {
    it('AdminPages.css !important yiginindan arindi (en fazla 1)', () => {
        const n = (read('pages/AdminPages.css').match(/!important/g) || []).length
        expect(n).toBeLessThanOrEqual(1)
    })
})
