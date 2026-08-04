/**
 * =============================================================================
 * Logical work item gruplama + aggregate status — domain kilitleri
 * =============================================================================
 * Bu kurallar Board, List ve Explorer'in UCUNUN de dayandigi tek kaynaktir.
 * Bir gorunum kendi status/gruplama algoritmasini yazarsa bu testler onu
 * yakalamaz — ama o sapmayi kaynak taramasi kilidi yakalar (bkz.
 * hardening/explorerContract.test.js).
 * =============================================================================
 */
import { describe, expect, it } from 'vitest'
import {
    aggregateStatus,
    countAssignments,
    countLogicalItems,
    groupIntoLogicalItems,
    logicalKeyOf,
    matchesAggregateStatus,
    matchesAnyAssignmentStatus,
    normalizeStatus,
} from '../../features/tasks/model/grouping'

const task = (over = {}) => ({
    id: over.id || 't1',
    title: 'API rate limit',
    description: 'desc',
    task_type: 'task',
    customer_id: 'c1', customer_name: 'A Customer',
    project_id: 'p1', project_name: 'A Project',
    sub_project_id: 's1', sub_project_name: 'API',
    priority: 'high',
    status: 'pending',
    assignee_user_id: 'u1',
    assigner_user_id: 'boss',
    scheduled_date: '2026-08-04',
    due_date: '2026-08-10',
    assignment_batch_id: null,
    ...over,
})

const NAMES = {
    u1: 'Ahmet', u2: 'Ayse', u3: 'Mehmet', u4: 'Elif', u5: 'Can',
}
const resolveName = (id) => NAMES[id] || null

describe('kanonik grup kimligi', () => {
    it('batch id varsa anahtar ONA baglanir', () => {
        expect(logicalKeyOf(task({ assignment_batch_id: 'b1' }))).toBe('batch:b1')
    })

    it('batch id yoksa satir KENDI basina logical item olur', () => {
        expect(logicalKeyOf(task({ id: 'x' }))).toBe('task:x')
    })

    it('batch UUID si ile task UUID si CAKISMAZ', () => {
        expect(logicalKeyOf(task({ id: 'same', assignment_batch_id: null })))
            .not.toBe(logicalKeyOf(task({ id: 'other', assignment_batch_id: 'same' })))
    })

    it('AYNI baslik farkli batch = AYRI logical item (tahminle birlestirme YOK)', () => {
        const items = groupIntoLogicalItems([
            task({ id: 'a', assignment_batch_id: 'b1' }),
            task({ id: 'b', assignment_batch_id: 'b2' }),
        ])
        expect(items).toHaveLength(2)
    })

    it('batch id NULL olan tarihsel kayitlar tek tek singleton kalir', () => {
        const items = groupIntoLogicalItems([
            task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c' }),
        ])
        expect(items).toHaveLength(3)
        expect(items.every((i) => i.isGrouped === false)).toBe(true)
    })
})

describe('aggregate status sozlesmesi (§5)', () => {
    const agg = (...statuses) => aggregateStatus(statuses.map((s) => ({ status: s })))

    it('hepsi Pending → Pending', () => {
        expect(agg('pending', 'pending', 'pending')).toBe('pending')
    })
    it('hepsi Completed → Completed', () => {
        expect(agg('completed', 'completed', 'completed', 'completed', 'completed'))
            .toBe('completed')
    })
    it('hepsi Rejected → Rejected', () => {
        expect(agg('rejected', 'rejected', 'rejected', 'rejected', 'rejected'))
            .toBe('rejected')
    })
    it('hepsi In Progress → In Progress', () => {
        expect(agg('in_progress', 'in_progress')).toBe('in_progress')
    })

    it('3 Completed + 2 In Progress → In Progress', () => {
        expect(agg('completed', 'completed', 'completed', 'in_progress', 'in_progress'))
            .toBe('in_progress')
    })
    it('2 Completed + 1 Pending → In Progress', () => {
        expect(agg('completed', 'completed', 'pending')).toBe('in_progress')
    })
    it('1 Rejected + 2 Pending → In Progress', () => {
        expect(agg('rejected', 'pending', 'pending')).toBe('in_progress')
    })

    it('tek assignment kendi statusunu tasir', () => {
        for (const s of ['pending', 'in_progress', 'completed', 'rejected', 'cancelled']) {
            expect(agg(s)).toBe(s)
        }
    })

    it('bilinmeyen status pending sayilir — kart kaybolmaz', () => {
        expect(normalizeStatus('weird')).toBe('pending')
        expect(agg('weird', 'pending')).toBe('pending')
    })

    it('hic gorunur assignment yoksa pending — kart bir sutunda kalir', () => {
        expect(aggregateStatus([])).toBe('pending')
    })
})

describe('bes kisilik zorunlu senaryo (§17)', () => {
    const FIVE = [
        task({ id: 'a1', assignee_user_id: 'u1', status: 'completed', assignment_batch_id: 'B' }),
        task({ id: 'a2', assignee_user_id: 'u2', status: 'completed', assignment_batch_id: 'B' }),
        task({ id: 'a3', assignee_user_id: 'u3', status: 'completed', assignment_batch_id: 'B' }),
        task({ id: 'a4', assignee_user_id: 'u4', status: 'in_progress', assignment_batch_id: 'B' }),
        task({ id: 'a5', assignee_user_id: 'u5', status: 'in_progress', assignment_batch_id: 'B' }),
    ]

    it('bes satir TEK logical item olur', () => {
        const items = groupIntoLogicalItems(FIVE, resolveName)
        expect(items).toHaveLength(1)
        expect(items[0].assignmentCount).toBe(5)
    })

    it('aggregate status In Progress', () => {
        expect(groupIntoLogicalItems(FIVE)[0].aggregateStatus).toBe('in_progress')
    })

    it('uc Completed + iki In Progress badge dagilimi korunur', () => {
        const [item] = groupIntoLogicalItems(FIVE, resolveName)
        const counts = item.assignments.reduce((m, a) => {
            m[a.status] = (m[a.status] || 0) + 1
            return m
        }, {})
        expect(counts).toEqual({ completed: 3, in_progress: 2 })
    })

    it('assignment sirasi DETERMINISTIK (her cagrida ayni)', () => {
        const once = groupIntoLogicalItems(FIVE, resolveName)[0].assignments.map((a) => a.id)
        const shuffled = [FIVE[3], FIVE[0], FIVE[4], FIVE[2], FIVE[1]]
        const twice = groupIntoLogicalItems(shuffled, resolveName)[0].assignments.map((a) => a.id)
        expect(twice).toEqual(once)
    })

    it('ortak alanlar logical item seviyesinde tek noktada', () => {
        const [item] = groupIntoLogicalItems(FIVE, resolveName)
        expect(item.title).toBe('API rate limit')
        expect(item.customerName).toBe('A Customer')
        expect(item.projectName).toBe('A Project')
        expect(item.subProjectName).toBe('API')
        expect(item.priority).toBe('high')
        expect(item.kind).toBe('task')
    })

    it('count logical item sayar, assignment DEGIL', () => {
        const items = groupIntoLogicalItems(FIVE, resolveName)
        expect(countLogicalItems(items)).toBe(1)
        expect(countAssignments(items)).toBe(5)
    })
})

describe('isim cozumu ve sizinti', () => {
    it('cozulemeyen isim null kalir — id ekrana ad diye BASILMAZ', () => {
        const [item] = groupIntoLogicalItems(
            [task({ id: 'a', assignee_user_id: 'gizli', assignment_batch_id: 'B' })],
            () => null
        )
        expect(item.assignments[0].assigneeName).toBeNull()
        expect(item.assignments[0].assigneeUserId).toBe('gizli')
    })

    it('resolveName verilmezse ad null olur (cagiran acikca saglar)', () => {
        const [item] = groupIntoLogicalItems([task({ id: 'a' })])
        expect(item.assignments[0].assigneeName).toBeNull()
    })
})

describe('status filtreleme sozlesmeleri (§10)', () => {
    const [mixed] = groupIntoLogicalItems([
        task({ id: 'a1', status: 'completed', assignment_batch_id: 'B' }),
        task({ id: 'a2', status: 'in_progress', assignee_user_id: 'u2', assignment_batch_id: 'B' }),
    ])

    it('assignment filtresi: EN AZ BIR gorunur assignment eslesirse tutar', () => {
        expect(matchesAnyAssignmentStatus(mixed, ['completed'])).toBe(true)
        expect(matchesAnyAssignmentStatus(mixed, ['in_progress'])).toBe(true)
        expect(matchesAnyAssignmentStatus(mixed, ['rejected'])).toBe(false)
    })

    it('aggregate filtresi AYRI sozlesmedir', () => {
        expect(matchesAggregateStatus(mixed, ['in_progress'])).toBe(true)
        expect(matchesAggregateStatus(mixed, ['completed'])).toBe(false)
    })

    it('bos filtre her seyi gecirir', () => {
        expect(matchesAnyAssignmentStatus(mixed, [])).toBe(true)
        expect(matchesAggregateStatus(mixed, undefined)).toBe(true)
    })

    it('filtre sonucunda ayni is TEK item olarak kalir (tekrar satir yok)', () => {
        const items = groupIntoLogicalItems([
            task({ id: 'a1', status: 'completed', assignment_batch_id: 'B' }),
            task({ id: 'a2', status: 'completed', assignee_user_id: 'u2', assignment_batch_id: 'B' }),
        ]).filter((i) => matchesAnyAssignmentStatus(i, ['completed']))
        expect(items).toHaveLength(1)
    })
})

describe('dayaniklilik', () => {
    it('bos/gecersiz girdi patlamaz', () => {
        expect(groupIntoLogicalItems(null)).toEqual([])
        expect(groupIntoLogicalItems([null, undefined])).toEqual([])
        expect(countLogicalItems(null)).toBe(0)
        expect(countAssignments(null)).toBe(0)
    })

    it('girdi sirasi korunur — ilk gorulen satir grubun yerini belirler', () => {
        const items = groupIntoLogicalItems([
            task({ id: 'z', assignment_batch_id: 'B2' }),
            task({ id: 'a', assignment_batch_id: 'B1' }),
            task({ id: 'b', assignment_batch_id: 'B2' }),
        ])
        expect(items.map((i) => i.key)).toEqual(['batch:B2', 'batch:B1'])
    })

    it('ham task satiri assignment icinde KORUNUR (mevcut seciciler icin)', () => {
        const [item] = groupIntoLogicalItems([task({ id: 'a' })])
        expect(item.assignments[0].task.id).toBe('a')
        expect(item.representative.id).toBe('a')
    })
})
