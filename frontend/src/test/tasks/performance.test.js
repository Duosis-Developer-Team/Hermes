/**
 * =============================================================================
 * Turetme performansi (§19) — olculen kilit
 * =============================================================================
 * Gruplama ve hiyerarsi TURETILMIS oldugu icin veri buyudukce maliyet
 * sessizce artabilir. Bu test o maliyeti OLCER ve bir butceye baglar.
 *
 * Olcum (bu makine, 2026-08-06):
 *   1100 assignment satiri → 500 logical item
 *   gruplama          0.7 ms
 *   musteri agaci     5.9 ms
 *   kisi agaci        1.6 ms
 *   klasor secimi     0.0 ms
 *
 * Butceler kasitli olarak GENIS (CI kosucusu bu makineden ~3x yavas);
 * amac mikro-optimizasyon degil, buyume egrisinin patlamasini yakalamak.
 * =============================================================================
 */
import { describe, expect, it } from 'vitest'
import { groupIntoLogicalItems } from '../../features/tasks/model/grouping'
import { buildHierarchy, buildUserHierarchy, itemsForNode } from '../../features/tasks/model/hierarchy'

const CUSTOMERS = 10, PROJECTS = 50, ITEMS = 500, MULTI = 150

function fixture() {
    const rows = []
    let n = 0
    for (let i = 0; i < ITEMS; i++) {
        const c = i % CUSTOMERS, p = i % PROJECTS
        const multi = i < MULTI
        const batch = multi ? `b${i}` : null
        const copies = multi ? 5 : 1
        for (let k = 0; k < copies; k++) {
            rows.push({
                id: `t${++n}`, title: `Task ${i}`, task_type: 'task',
                customer_id: `c${c}`, customer_name: `Customer ${c}`,
                project_id: `p${p}`, project_name: `Project ${p}`,
                sub_project_id: i % 3 === 0 ? `s${p}` : null,
                sub_project_name: i % 3 === 0 ? `Sub ${p}` : null,
                assignee_user_id: `u${k}`, assigner_user_id: 'boss',
                status: ['pending', 'in_progress', 'completed'][i % 3],
                priority: 'medium', scheduled_date: '2026-08-04',
                due_date: null, assignment_batch_id: batch,
                archived_at: i % 5 === 0 ? '2026-07-01T00:00:00Z' : null,
            })
        }
    }
    return rows
}

const ms = (fn) => { const t = performance.now(); const r = fn(); return [performance.now() - t, r] }

describe('performans (§19)', () => {
    it('500 logical item / 1000+ assignment olceginde turetme hizli', () => {
        const rows = fixture()
        expect(rows.length).toBeGreaterThan(1000)

        const [tGroup, items] = ms(() => groupIntoLogicalItems(rows, (id) => `User ${id}`))
        const [tTree, tree] = ms(() => buildHierarchy(items))
        const [tUser] = ms(() => buildUserHierarchy(items))
        const [tNode] = ms(() => itemsForNode(tree, { customerId: 'c0' }))

        expect(items).toHaveLength(ITEMS)
        // MULTI adet coklu atamali grup 5'er satirdan geliyor.
        expect(rows.length).toBe(ITEMS + MULTI * 4)

        console.log(JSON.stringify({
            rows: rows.length, logical_items: items.length,
            group_ms: +tGroup.toFixed(1), customer_tree_ms: +tTree.toFixed(1),
            user_tree_ms: +tUser.toFixed(1), select_node_ms: +tNode.toFixed(1),
        }))

        // Butce: tek bir etkilesimde kullanicinin hissedecegi sinir.
        expect(tGroup).toBeLessThan(150)
        expect(tTree).toBeLessThan(150)
        expect(tUser).toBeLessThan(300)
        expect(tNode).toBeLessThan(50)
    })
})
