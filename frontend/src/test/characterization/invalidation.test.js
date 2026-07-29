/**
 * Characterization §4-5: mutasyon invalidation'i YALNIZCA hedef query
 * ailesini vurmali. Ayrica Sprint 1 bulgusunun kaydi: v5'te ESKI dizi
 * bicim TUM cache'i invalid ediyordu — migration bir davranis
 * DUZELTMESIYDI; bu test o gercegi kalici belgeler.
 */
import { describe, expect, it } from 'vitest'
import { makeQueryClient } from '../../query/queryClient'
import { queryKeys } from '../../query/queryKeys'

const seed = async (qc) => {
    await qc.prefetchQuery({ queryKey: queryKeys.workLogs.all, queryFn: () => 1 })
    await qc.prefetchQuery({ queryKey: queryKeys.tasks.all, queryFn: () => 2 })
    await qc.prefetchQuery({ queryKey: queryKeys.customers.all, queryFn: () => 3 })
}
const staleKeys = (qc) => qc.getQueryCache().getAll()
    .filter((q) => q.isStale()).map((q) => q.queryKey[0]).sort()

describe('hedefli invalidation (v5 object syntax)', () => {
    it('yalnizca workLogs ailesi stale olur', async () => {
        const qc = makeQueryClient({ queries: { retry: false, staleTime: Infinity } })
        await seed(qc)
        await qc.invalidateQueries({ queryKey: queryKeys.workLogs.all })
        expect(staleKeys(qc)).toEqual(['workLogs'])
    })

    it('ESKI dizi bicimi v5te HERSEYI stale ederdi (bug kaydi)', async () => {
        const qc = makeQueryClient({ queries: { retry: false, staleTime: Infinity } })
        await seed(qc)
        await qc.invalidateQueries(['workLogs']) // BILEREK eski bicim (bug kaydi)
        expect(staleKeys(qc)).toEqual(['customers', 'tasks', 'workLogs'])
    })
})
