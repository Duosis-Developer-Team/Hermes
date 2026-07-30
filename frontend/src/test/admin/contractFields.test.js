/**
 * =============================================================================
 * Sprint 6A/6C — Sozlesme alanlari adaptoru
 * =============================================================================
 * KAPSAM BULGUSU: ayri bir "contracts" modulu YOK. Backend'de contracts
 * router'i ya da entity'si bulunmuyor; sozlesme verisi Customer ve
 * Project uzerinde IKI nullable kolondur
 * (`contract_start_date`, `contract_duration_days`).
 *
 * Gercek bosluk: backend her iki alani da hem create hem update icin
 * KABUL EDIYORDU ama
 *   - Customers formu iki alani da HIC sunmuyordu,
 *   - Projects formu yalnizca sureyi sunuyordu; baslangic tarihi
 *     ContractStatusPage'de GORUNUYOR ama hicbir yerden girilemiyordu.
 *
 * TIMEZONE: tarih GUN olarak gonderilir. `toISOString()` yerel saat
 * dilimine gore bir gun kaydirabilir (UTC+3'te 01 Ocak 00:00 →
 * 31 Aralik 21:00Z) ve sozlesme baslangici YANLIS gune duserdi.
 * =============================================================================
 */
import { describe, expect, it } from 'vitest'
import dayjs from 'dayjs'

import {
    contractToForm, contractToPayload,
} from '../../features/admin/shared/contractFields'

describe('contractToForm — backend → form', () => {
    it('ISO tarih DatePicker icin dayjs e cevrilir', () => {
        const out = contractToForm({
            contract_start_date: '2026-03-15T00:00:00', contract_duration_days: 90,
        })
        expect(dayjs.isDayjs(out.contract_start_date)).toBe(true)
        expect(out.contract_start_date.format('YYYY-MM-DD')).toBe('2026-03-15')
        expect(out.contract_duration_days).toBe(90)
    })

    it('tarih YOKSA null olur (bos DatePicker)', () => {
        expect(contractToForm({ contract_duration_days: 30 }).contract_start_date)
            .toBeNull()
    })

    it('sure yoksa undefined olur (bos InputNumber)', () => {
        expect(contractToForm({}).contract_duration_days).toBeUndefined()
    })

    it('kayit hic yoksa cokmez', () => {
        expect(contractToForm(null)).toEqual({
            contract_start_date: null, contract_duration_days: undefined,
        })
    })
})

describe('contractToPayload — form → backend', () => {
    it('dayjs GUN dizesine cevrilir — saat dilimi kaydirmasi YOK', () => {
        const out = contractToPayload({
            contract_start_date: dayjs('2026-01-01T00:00:00'),
            contract_duration_days: 365,
        })
        // `toISOString()` kullanilsaydi UTC+3'te 2025-12-31 olurdu.
        expect(out.contract_start_date).toBe('2026-01-01')
        expect(out.contract_duration_days).toBe(365)
    })

    it('bos tarih null gonderilir — "sozlesmeyi kaldir"', () => {
        expect(contractToPayload({ contract_start_date: null }).contract_start_date)
            .toBeNull()
    })

    it('bos sure null gonderilir', () => {
        for (const v of [undefined, null, '']) {
            expect(contractToPayload({ contract_duration_days: v })
                .contract_duration_days).toBeNull()
        }
    })

    it('sure SAYIYA cevrilir (InputNumber string verebilir)', () => {
        expect(contractToPayload({ contract_duration_days: '120' })
            .contract_duration_days).toBe(120)
    })

    it('dayjs OLMAYAN tarih degeri oldugu gibi gecer', () => {
        expect(contractToPayload({ contract_start_date: '2026-05-05' })
            .contract_start_date).toBe('2026-05-05')
    })

    it('gidis-donus degeri KORUR', () => {
        const record = {
            contract_start_date: '2026-07-01T00:00:00', contract_duration_days: 45,
        }
        const payload = contractToPayload(contractToForm(record))
        expect(payload).toEqual({
            contract_start_date: '2026-07-01', contract_duration_days: 45,
        })
    })
})
