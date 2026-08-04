/**
 * =============================================================================
 * Explorer hiyerarsisi — sayim, sanal klasor ve secim kilitleri
 * =============================================================================
 * §17'nin zorunlu fixture'i buradaki sayimlarla dogrulanir:
 *   A Customer (3) → A Project (1) + B Project (2)
 *   B Customer (3), C Customer (1), D Customer (3)
 * Sayimlar LOGICAL work item sayar — assignment DEGIL.
 * =============================================================================
 */
import { describe, expect, it } from 'vitest'
import { groupIntoLogicalItems } from '../../features/tasks/model/grouping'
import {
    NO_CUSTOMER, NO_PROJECT, NO_SUB_PROJECT,
    breadcrumbFor, buildHierarchy, itemsForNode, matchesSearch,
    reconcileSelection,
} from '../../features/tasks/model/hierarchy'

let n = 0
const t = (over = {}) => ({
    id: `t${++n}`,
    title: over.title || `Task ${n}`,
    task_type: 'task',
    customer_id: 'cA', customer_name: 'A Customer',
    project_id: 'pA', project_name: 'A Project',
    sub_project_id: null, sub_project_name: null,
    assignee_user_id: 'u1', assigner_user_id: 'boss',
    status: 'pending', priority: 'medium',
    scheduled_date: '2026-08-04', due_date: null,
    assignment_batch_id: null,
    ...over,
})

/** §17 fixture: 10 logical work item. */
const FIXTURE = () => {
    n = 0
    return [
        // A Customer → A Project (1)
        t({ customer_id: 'cA', customer_name: 'A Customer', project_id: 'pA', project_name: 'A Project' }),
        // A Customer → B Project (2)
        t({ customer_id: 'cA', customer_name: 'A Customer', project_id: 'pB', project_name: 'B Project' }),
        t({ customer_id: 'cA', customer_name: 'A Customer', project_id: 'pB', project_name: 'B Project' }),
        // B Customer (3)
        ...[1, 2, 3].map(() =>
            t({ customer_id: 'cB', customer_name: 'B Customer', project_id: 'pC', project_name: 'C Project' })),
        // C Customer (1)
        t({ customer_id: 'cC', customer_name: 'C Customer', project_id: 'pD', project_name: 'D Project' }),
        // D Customer (3)
        ...[1, 2, 3].map(() =>
            t({ customer_id: 'cD', customer_name: 'D Customer', project_id: 'pE', project_name: 'E Project' })),
    ]
}

const treeOf = (rows) => buildHierarchy(groupIntoLogicalItems(rows))

describe('zorunlu fixture sayimlari (§17)', () => {
    const tree = treeOf(FIXTURE())

    it('dort musteri klasoru gorunur', () => {
        expect(tree.map((c) => c.label))
            .toEqual(['A Customer', 'B Customer', 'C Customer', 'D Customer'])
    })

    it('A Customer sayaci 3', () => {
        expect(tree.find((c) => c.label === 'A Customer').count).toBe(3)
    })

    it('A Customer altinda A Project ve B Project var', () => {
        const a = tree.find((c) => c.label === 'A Customer')
        expect(a.children.map((p) => p.label)).toEqual(['A Project', 'B Project'])
    })

    it('A Project sayaci 1, B Project sayaci 2', () => {
        const a = tree.find((c) => c.label === 'A Customer')
        expect(a.children.find((p) => p.label === 'A Project').count).toBe(1)
        expect(a.children.find((p) => p.label === 'B Project').count).toBe(2)
    })

    it('B/C/D musteri sayaclari 3/1/3', () => {
        const by = Object.fromEntries(tree.map((c) => [c.label, c.count]))
        expect(by['B Customer']).toBe(3)
        expect(by['C Customer']).toBe(1)
        expect(by['D Customer']).toBe(3)
    })

    it('toplam 10 logical work item', () => {
        expect(tree.reduce((s, c) => s + c.count, 0)).toBe(10)
    })
})

describe('sayim LOGICAL item sayar, assignment DEGIL', () => {
    it('bes kisilik tek is klasorde 1 sayilir', () => {
        const rows = [1, 2, 3, 4, 5].map((i) =>
            t({ id: `a${i}`, assignee_user_id: `u${i}`, assignment_batch_id: 'B', title: 'Shared' }))
        const tree = treeOf(rows)
        expect(tree[0].count).toBe(1)
        expect(tree[0].children[0].count).toBe(1)
    })
})

describe('bos/eksik iliskiler kaybolmaz (§6.5)', () => {
    it('customer yoksa No Customer klasorune duser', () => {
        const tree = treeOf([t({ customer_id: null, customer_name: null })])
        expect(tree[0].id).toBe(NO_CUSTOMER)
        expect(tree[0].label).toBe('No Customer')
        expect(tree[0].isVirtual).toBe(true)
        expect(tree[0].count).toBe(1)
    })

    it('project yoksa No Project, sub project yoksa No Sub Project', () => {
        const tree = treeOf([t({ project_id: null, project_name: null })])
        expect(tree[0].children[0].id).toBe(NO_PROJECT)
        expect(tree[0].children[0].children[0].id).toBe(NO_SUB_PROJECT)
    })

    it('sanal klasorler listenin SONUNDA durur', () => {
        const tree = treeOf([
            t({ customer_id: null, customer_name: null }),
            t({ customer_id: 'cZ', customer_name: 'Z Customer' }),
        ])
        expect(tree.map((c) => c.label)).toEqual(['Z Customer', 'No Customer'])
    })

    it('adi cozulemeyen referansta kimlik BASILMAZ, notr etiket gelir', () => {
        const tree = treeOf([t({ customer_id: 'gizli-uuid', customer_name: null })])
        expect(tree[0].label).toBe('Unnamed')
        expect(JSON.stringify(tree.map((c) => c.label))).not.toContain('gizli-uuid')
    })
})

describe('secili klasorun icerigi', () => {
    const tree = treeOf(FIXTURE())

    it('secim yoksa TUM isler gelir', () => {
        expect(itemsForNode(tree, {})).toHaveLength(10)
    })

    it('musteri secilince o musterinin isleri', () => {
        expect(itemsForNode(tree, { customerId: 'cA' })).toHaveLength(3)
    })

    it('proje secilince o projenin isleri', () => {
        expect(itemsForNode(tree, { customerId: 'cA', projectId: 'pB' })).toHaveLength(2)
    })

    it('bilinmeyen dugum bos doner (blank page degil, bos liste)', () => {
        expect(itemsForNode(tree, { customerId: 'yok' })).toEqual([])
    })
})

describe('breadcrumb ve secim onarimi (§14)', () => {
    const tree = treeOf(FIXTURE())

    it('breadcrumb secili yolu verir', () => {
        expect(breadcrumbFor(tree, { customerId: 'cA', projectId: 'pB' })
            .map((b) => b.label)).toEqual(['A Customer', 'B Project'])
    })

    it('gecersiz proje secimi musteriye duser', () => {
        expect(reconcileSelection(tree, { customerId: 'cA', projectId: 'yok' }))
            .toEqual({ customerId: 'cA' })
    })

    it('gecersiz musteri secimi koke duser (bos sayfa YOK)', () => {
        expect(reconcileSelection(tree, { customerId: 'yok', projectId: 'pB' })).toEqual({})
    })

    it('gecerli secim korunur', () => {
        expect(reconcileSelection(tree, { customerId: 'cA', projectId: 'pA' }))
            .toEqual({ customerId: 'cA', projectId: 'pA' })
    })
})

describe('arama', () => {
    const [item] = groupIntoLogicalItems([t({ title: 'API rate limit' })])

    it('baslikta eslesir', () => {
        expect(matchesSearch(item, 'rate')).toBe(true)
        expect(matchesSearch(item, 'RATE')).toBe(true)
    })

    it('musteri/proje adinda da eslesir', () => {
        expect(matchesSearch(item, 'A Customer')).toBe(true)
    })

    it('eslesmeyen terim false', () => {
        expect(matchesSearch(item, 'zzz')).toBe(false)
    })

    it('bos terim her seyi gecirir', () => {
        expect(matchesSearch(item, '')).toBe(true)
        expect(matchesSearch(item, '   ')).toBe(true)
    })

    it('eslesen isin ATA YOLU agacta korunur', () => {
        const rows = [
            t({ title: 'needle', customer_id: 'cX', customer_name: 'X Customer' }),
            t({ title: 'other', customer_id: 'cY', customer_name: 'Y Customer' }),
        ]
        const filtered = groupIntoLogicalItems(rows).filter((i) => matchesSearch(i, 'needle'))
        const tree = buildHierarchy(filtered)
        expect(tree.map((c) => c.label)).toEqual(['X Customer'])
        expect(tree[0].count).toBe(1)
    })
})
