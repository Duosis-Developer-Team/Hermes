/**
 * =============================================================================
 * HERMES - Tasks invalidation sozlesmesi (Sprint 5C+)
 * =============================================================================
 * "Bir yazma islemi hangi cache ailelerini tazeler?" sorusunun TEK
 * cevabi. Uc ayri hook (CRUD mutasyonlari, durum degisikligi, zaman
 * kaydi) ayni sozlesmeyi tuketir; kural hicbirinde tekrarlanmaz.
 *
 * Anahtarlar merkezi factory'den gelir ve invalidation HEP v5 object
 * syntax'iyla yapilir — eski dizi bicimi TUM cache'i invalid ederdi
 * (queryKeys.js basligindaki Sprint 1 bulgusu).
 *
 * Matris testle kilitli (crud/logTime/boardDrag integration):
 *   gorev yazildi      → tasks + task-activity      (BASKA HICBIR SEY)
 *   zaman kaydi yazildi → workLogs + periodStatus + task-activity
 *                         (tasks DEGIL: kayit gorev listesini degistirmez)
 * =============================================================================
 */
import { useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '../../../query/queryKeys'

export function useTaskInvalidation() {
    const queryClient = useQueryClient()

    /** Gorev yazildi → SADECE gorev aileleri. */
    const invalidateTaskFamilies = () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all })
        queryClient.invalidateQueries({ queryKey: queryKeys.taskActivity.all })
    }

    /**
     * Zaman kaydi yazildi → Time Entry'nin okudugu aileler + gorev
     * aktivite akisi. Kayit core_db'ye tipki bir Time Entry gibi
     * yazilir; bu yuzden orada bayat veri kalmamalidir.
     */
    const invalidateWorkLogFamilies = () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.workLogs.all })
        queryClient.invalidateQueries({ queryKey: queryKeys.periodStatus.all })
        queryClient.invalidateQueries({ queryKey: queryKeys.taskActivity.all })
    }

    /** Lifecycle politikasi degisti → yalniz o ayar tazelenir. */
    const invalidateLifecyclePolicy = () => {
        queryClient.invalidateQueries({
            queryKey: queryKeys.taskLifecyclePolicy.all,
        })
    }

    return {
        queryClient,
        invalidateTaskFamilies,
        invalidateWorkLogFamilies,
        invalidateLifecyclePolicy,
    }
}

export default useTaskInvalidation
