/**
 * =============================================================================
 * HERMES - Arsiv / geri alma mutation'lari
 * =============================================================================
 * Sozlesme:
 *   - Cift gonderim KILITLI (isPending) — ayni istek iki kez gitmez.
 *   - Hata durumunda modal ACIK kalir; item Active havuzda kalir.
 *   - Toast BIR KEZ gosterilir; sunucunun domain mesaji korunur
 *     (409 "Log Time gerekli" gibi) — teknik govde sizmaz.
 *   - Basaridan sonra YALNIZ task aileleri invalidate edilir (merkezi
 *     sozlesme uzerinden); Active ve Archive cache'leri ayri
 *     anahtarlarda oldugu icin ikisi de tazelenir.
 * =============================================================================
 */
import { useMutation } from '@tanstack/react-query'
import { message } from 'antd'

import useTaskInvalidation from './useTaskInvalidation'
import { normalizeApiError } from '../../admin/shared/normalizeApiError'
import { taskService } from '../../../services/api'

export function useTaskArchiveMutations({ onArchived, onRestored } = {}) {
    // Invalidation SOZLESMESI tek dosyada yasar (useTaskInvalidation);
    // bu hook kendi anahtarini YAZMAZ.
    const { invalidateTaskFamilies } = useTaskInvalidation()

    const archiveMutation = useMutation({
        mutationFn: (taskId) => taskService.archive(taskId),
        onSuccess: (data) => {
            message.success('Work item archived')
            invalidateTaskFamilies()
            onArchived?.(data)
        },
        onError: (error) => {
            // Modal ACIK kalir — kapanmasi "arsivlendi" izlenimi verirdi.
            message.error(normalizeApiError(error).message)
        },
    })

    const restoreMutation = useMutation({
        mutationFn: ({ taskId, assignmentTaskId, targetStatus }) =>
            taskService.restore(taskId, { assignmentTaskId, targetStatus }),
        onSuccess: (data) => {
            message.success('Work item restored')
            invalidateTaskFamilies()
            onRestored?.(data)
        },
        onError: (error) => {
            message.error(normalizeApiError(error).message)
        },
    })

    return {
        archiveMutation,
        restoreMutation,
        archive: (taskId) => {
            if (archiveMutation.isPending) return
            archiveMutation.mutate(taskId)
        },
        restore: (payload) => {
            if (restoreMutation.isPending) return
            restoreMutation.mutate(payload)
        },
    }
}

export default useTaskArchiveMutations
