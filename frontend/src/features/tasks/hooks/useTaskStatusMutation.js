/**
 * =============================================================================
 * HERMES - Gorev DURUM degisikligi (board surukle-birak) — Sprint 5C+
 * =============================================================================
 * CRUD yazmalarindan AYRI bir hook, cunku sozlesmesi farkli: iyimser
 * (optimistic) uygulanir, basarisizlikta GERI ALINIR ve gorev bazinda
 * kilitlidir.
 *
 * Ham status ucunu kullanir (kabul-etme guardi yok): surukleme ACIK bir
 * niyettir ve backend'in _apply_status_change'i tamamlanma alanlarini
 * tutarli tutar.
 *
 * KILIT (Sprint 5C+ bulgusu): ayni gorev icin bir durum degisikligi
 * UCARKEN ikinci istek acilmaz. Boyle bir kilit YOKTU — kart ust uste
 * suruklendiginde her birakma yeni bir mutation ve CELISEN yeni bir
 * iyimser durum yaziyordu. Kilit `useRef` ile tutulur: render'i
 * beklemek, tam da kapatmaya calistigimiz yaris penceresini geri acardi.
 * Kilit GOREV BAZINDADIR — baska bir kart ayni anda serbestce
 * suruklenebilir.
 * =============================================================================
 */
import { useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { message } from 'antd'

import { taskService } from '../../../services/api'
import { queryKeys } from '../../../query/queryKeys'
import useTaskInvalidation from './useTaskInvalidation'

export function useTaskStatusMutation() {
    const { queryClient, invalidateTaskFamilies } = useTaskInvalidation()
    const inFlightIds = useRef(new Set())

    /** Aktif ['tasks', ...] sorgularini yamalar; snapshot geri donusu. */
    const optimisticPatchTask = async (taskId, patch) => {
        await queryClient.cancelQueries({ queryKey: queryKeys.tasks.all })
        const prev = queryClient.getQueriesData({ queryKey: queryKeys.tasks.all })
        queryClient.setQueriesData({ queryKey: queryKeys.tasks.all }, (old) =>
            Array.isArray(old)
                ? old.map((t) => (t.id === taskId ? { ...t, ...patch } : t))
                : old
        )
        return prev
    }

    const rollbackTasks = (prev) => {
        if (!prev) return
        for (const [key, data] of prev) queryClient.setQueryData(key, data)
    }

    const mutation = useMutation({
        mutationFn: ({ id, status }) => taskService.updateStatus(id, status),
        onMutate: async ({ id, status }) => {
            inFlightIds.current.add(id)
            return { prev: await optimisticPatchTask(id, { status }) }
        },
        onError: (err, _vars, ctx) => {
            // Snapshot mutation BASLAMADAN once alindi: rollback her
            // zaman ILK kaynak duruma doner.
            rollbackTasks(ctx?.prev)
            message.error(
                err?.response?.data?.detail || 'Failed to update status.'
            )
        },
        onSettled: (_data, _err, vars) => {
            inFlightIds.current.delete(vars?.id)
            invalidateTaskFamilies()
        },
    })

    return {
        isTaskStatusPending: (taskId) => inFlightIds.current.has(taskId),
        /**
         * Board drop kapisi. Ucan bir istek varsa YENI istek acilmaz ve
         * celisen ikinci bir iyimser durum yazilmaz.
         * @returns {{ok?: boolean, skipped?: boolean}}
         */
        changeTaskStatus: async ({ id, status }) => {
            if (inFlightIds.current.has(id)) return { skipped: true }
            try {
                await mutation.mutateAsync({ id, status })
                return { ok: true }
            } catch {
                // toast + rollback mutation tarafindan yapildi
                return { ok: false }
            }
        },
    }
}

export default useTaskStatusMutation
