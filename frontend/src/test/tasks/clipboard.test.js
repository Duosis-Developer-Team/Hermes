/**
 * Sprint 5B — Tasks pano modeli: KURTARILAN sozlesmenin testleri.
 * Referans: 7d94a75 (son saglam surum). Bu testler restorasyonun
 * eski davranisla birebir ayni oldugunu kanitlar.
 */
import { describe, expect, it } from 'vitest'
import {
    buildTaskPastePayload, canPasteSnapshot, isTaskCopyable, makeTaskSnapshot,
} from '../../features/tasks/model/clipboard'

const TASK = {
    id: 't1', customer_id: 'c1', project_id: 'p1', sub_project_id: 'sp1',
    assignee_user_id: 'u2', title: 'Gorev', description: 'Aciklama',
    scheduled_date: '2026-07-27', due_date: '2026-07-30',
    priority: 'high', status: 'pending',
    // Tasinmamasi gerekenler:
    assignee_note: 'not', completed_at: '2026-07-28',
    completed_by_user_id: 'u9', created_by: 'u1', task_code: 'TASK-1',
}

describe('kopyalanabilirlik (768683f kurali)', () => {
    it('pending/in_progress kopyalanir; completed/rejected KOPYALANMAZ', () => {
        expect(isTaskCopyable({ status: 'pending' })).toBe(true)
        expect(isTaskCopyable({ status: 'in_progress' })).toBe(true)
        expect(isTaskCopyable({ status: 'completed' })).toBe(false)
        expect(isTaskCopyable({ status: 'rejected' })).toBe(false)
    })
})

describe('snapshot (7d94a75 — dondurulmus)', () => {
    const s = makeTaskSnapshot(TASK)

    it('DONDURULMUS (canli cache nesnesi degil)', () => {
        expect(Object.isFrozen(s)).toBe(true)
        expect(s).not.toBe(TASK)
    })

    it('gerekli alanlari tasir', () => {
        expect(s).toMatchObject({
            sourceTaskId: 't1', customer_id: 'c1', project_id: 'p1',
            sub_project_id: 'sp1', assignee_user_id: 'u2', title: 'Gorev',
            description: 'Aciklama', priority: 'high',
            original_scheduled_date: '2026-07-27',
            original_due_date: '2026-07-30',
        })
    })

    it('YASAK alanlari TASIMAZ (status/audit/creator)', () => {
        for (const k of ['status', 'assignee_note', 'completed_at',
                         'completed_by_user_id', 'created_by', 'task_code'])
            expect(s[k]).toBeUndefined()
    })

    it('KAYNAK sonradan EDIT edilse bile snapshot degismez', () => {
        const live = { ...TASK }
        const snap = makeTaskSnapshot(live)
        live.title = 'DEGISTI'
        live.priority = 'low'
        live.status = 'completed'
        live.scheduled_date = '2099-01-01'
        expect(snap.title).toBe('Gorev')
        expect(snap.priority).toBe('high')
        expect(snap.original_scheduled_date).toBe('2026-07-27')
    })

    it('varsayilanlar: title/description/priority/sub_project', () => {
        const s2 = makeTaskSnapshot({ id: 'x' })
        expect(s2.title).toBe('Task')
        expect(s2.description).toBe('')
        expect(s2.priority).toBe('medium')
        expect(s2.sub_project_id).toBeNull()
    })

    it('null girdi null doner', () => expect(makeTaskSnapshot(null)).toBeNull())
})

describe('paste payload (7d94a75 ile birebir)', () => {
    const s = makeTaskSnapshot(TASK)

    it('hedef gune yazar ve TERMIN OFSETINI korur (3 gun)', () => {
        const p = buildTaskPastePayload(s, '2026-08-10')
        expect(p.scheduled_date).toBe('2026-08-10')
        expect(p.due_date).toBe('2026-08-13')
    })

    it('due_date yoksa null kalir', () => {
        const p = buildTaskPastePayload(
            makeTaskSnapshot({ ...TASK, due_date: null }), '2026-08-10')
        expect(p.due_date).toBeNull()
    })

    it('bos aciklama BASLIGA duser (backend min_length=1)', () => {
        const p = buildTaskPastePayload(
            makeTaskSnapshot({ ...TASK, description: '   ' }), '2026-08-10')
        expect(p.description).toBe('Gorev')
    })

    it('payload YASAK alan icermez, id tasimaz (YENI kayit)', () => {
        const p = buildTaskPastePayload(s, '2026-08-10')
        for (const k of ['id', 'sourceTaskId', 'status', 'assignee_note',
                         'completed_at', 'original_due_date'])
            expect(p[k]).toBeUndefined()
    })

    it('hedef YOKSA payload uretmez (mutation calismaz)', () => {
        expect(buildTaskPastePayload(s, null)).toBeNull()
        expect(buildTaskPastePayload(null, '2026-08-10')).toBeNull()
    })

    it('AYNI snapshot birden cok hedefe yapistirilabilir', () => {
        const a = buildTaskPastePayload(s, '2026-08-10')
        const b = buildTaskPastePayload(s, '2026-08-11')
        expect(a.scheduled_date).not.toBe(b.scheduled_date)
        expect(a.due_date).toBe('2026-08-13')
        expect(b.due_date).toBe('2026-08-14')
        expect(a.title).toBe(b.title)
    })

    it('AY SONU ve YIL GECISI ofseti dogru tasir', () => {
        const p = buildTaskPastePayload(s, '2026-12-30')
        expect(p.scheduled_date).toBe('2026-12-30')
        expect(p.due_date).toBe('2027-01-02')
    })

    it('ARTIK YIL: 27 Sub + 3 gun → 1 Mart (2028 artik yil: 29 Sub var)', () => {
        const p = buildTaskPastePayload(s, '2028-02-27')
        expect(p.due_date).toBe('2028-03-01')
    })
})

describe('paste yetki kapisi (§3)', () => {
    const s = makeTaskSnapshot(TASK) // assignee u2

    it('atama yetkisi YOKSA reddedilir', () => {
        expect(canPasteSnapshot(s, {
            canAssignTasks: false, assignableUserIds: ['u2'],
        })).toBe(false)
    })

    it('hedef kisi ADAY LISTESINDE degilse reddedilir', () => {
        expect(canPasteSnapshot(s, {
            canAssignTasks: true, assignableUserIds: ['u5'],
        })).toBe(false)
    })

    it('yetki + aday listesi uygunsa kabul', () => {
        expect(canPasteSnapshot(s, {
            canAssignTasks: true, assignableUserIds: ['u2', 'u3'],
        })).toBe(true)
    })
})
