/**
 * Sprint 4 — pano modeli birim testleri (saf fonksiyonlar).
 * characterization testinin DOM'da kapsayamadigi dallar burada.
 */
import { describe, expect, it } from 'vitest'
import {
    buildPastePayload, isEditableTarget, makeClipboardSnapshot,
} from '../../features/time-entry/model/clipboard'

const LOG = {
    id: 'l1', customer_id: 'c1', project_id: 'p1', work_type_id: 'w1',
    activity_type_id: 'a1', platform_id: null, work_line_id: null,
    duration_hours: 2.5, description: 'Aciklama', project_name: 'ATM',
    date_worked: '2026-07-27',
}

describe('makeClipboardSnapshot', () => {
    it('minimum alanlari kopyalar ve DONDURUR (immutable)', () => {
        const s = makeClipboardSnapshot(LOG)
        expect(Object.isFrozen(s)).toBe(true)
        expect(s.customer_id).toBe('c1')
        expect(s.label).toBe('ATM')
        // date_worked snapshot'ta YOK — hedef gun paste aninda verilir
        expect(s.date_worked).toBeUndefined()
    })

    it('KAYNAK sonradan degisse bile snapshot bozulmaz (§6)', () => {
        const source = { ...LOG }
        const snap = makeClipboardSnapshot(source)
        source.duration_hours = 99
        source.description = 'DEGISTI'
        source.project_id = 'BASKA'
        expect(snap.duration_hours).toBe(2.5)
        expect(snap.description).toBe('Aciklama')
        expect(snap.project_id).toBe('p1')
    })

    it('opsiyonel alanlar null a normalize edilir', () => {
        const s = makeClipboardSnapshot({ ...LOG, activity_type_id: undefined })
        expect(s.activity_type_id).toBeNull()
    })

    it('null girdi null doner', () => {
        expect(makeClipboardSnapshot(null)).toBeNull()
    })
})

describe('buildPastePayload', () => {
    it('hedef tarihi yazar, kaynak id TASIMAZ (yeni kayit)', () => {
        const p = buildPastePayload(makeClipboardSnapshot(LOG), '2026-07-29')
        expect(p.date_worked).toBe('2026-07-29')
        expect(p.id).toBeUndefined()
        expect(p.sourceId).toBeUndefined()
        expect(p.label).toBeUndefined()
    })

    it('hedef yoksa payload uretmez (yapistirma calismaz)', () => {
        expect(buildPastePayload(makeClipboardSnapshot(LOG), null)).toBeNull()
        expect(buildPastePayload(null, '2026-07-29')).toBeNull()
    })

    it('ayni snapshot BIRDEN COK hedefe yapistirilabilir (§6 coklu paste)', () => {
        const snap = makeClipboardSnapshot(LOG)
        const a = buildPastePayload(snap, '2026-07-28')
        const b = buildPastePayload(snap, '2026-07-29')
        expect(a.date_worked).not.toBe(b.date_worked)
        expect(a.project_id).toBe(b.project_id)
    })
})

describe('isEditableTarget (kisayol guard)', () => {
    const el = (tag, props = {}) => Object.assign({ tagName: tag }, props)

    it.each(['INPUT', 'TEXTAREA', 'SELECT', 'input', 'textarea'])(
        '%s → kisayol ENGELLENIR', (tag) => {
            expect(isEditableTarget(el(tag))).toBe(true)
        })

    it('contenteditable → kisayol ENGELLENIR (jsdom DOM ile test edilemeyen dal)', () => {
        expect(isEditableTarget(el('DIV', { isContentEditable: true }))).toBe(true)
    })

    it('normal element / null → kisayol CALISIR', () => {
        expect(isEditableTarget(el('DIV'))).toBe(false)
        expect(isEditableTarget(el('BUTTON'))).toBe(false)
        expect(isEditableTarget(null)).toBe(false)
    })
})
