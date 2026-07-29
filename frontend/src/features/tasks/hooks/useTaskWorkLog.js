/**
 * =============================================================================
 * HERMES - "Tamamlandi → Log Time" orkestrasyonu (Sprint 5C)
 * =============================================================================
 * Gorevden zaman kaydi olusturmanin TEK yeri. Iki giris noktasi vardir ve
 * ikisi de ayni durumu besler:
 *   1. Gorev ILK KEZ tamamlandiginda akis otomatik acilir,
 *   2. Tamamlanmis bir gorevin "Log Time" aksiyonu.
 * Yeniden acma (completed → pending) BILEREK hicbir sey yapmaz.
 *
 * INVALIDATION: kayit core_db'ye tipki bir Time Entry gibi yazilir, bu
 * yuzden Time Entry'nin okudugu aileler tazelenir (workLogs, periodStatus)
 * + gorev aktivite akisi. `tasks` ailesi BILEREK tazelenmez: zaman kaydi
 * gorev listesini degistirmez.
 * =============================================================================
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { message } from 'antd'

import { workLogService } from '../../../services/api'
import { queryKeys } from '../../../query/queryKeys'

export function useTaskWorkLog() {
    const queryClient = useQueryClient()
    const [logTimeTask, setLogTimeTask] = useState(null)

    const workLogMutation = useMutation({
        // Kayit gorevin ATANANINA yazilir — is onundu. Backend
        // (POST /work-logs) target_user_id'yi yalnizca cagiran admin ise
        // onurlandirir; kendi gorevini kaydeden non-admin icin bu zaten
        // "kendine kaydet"e cokar. Sayfanin admin "view-as" secimi
        // BILEREK gecilmez: sahibi goruntuleme baglami degil gorevdir.
        mutationFn: ({ data, assigneeUserId }) =>
            workLogService.create(data, assigneeUserId || null),
        onSuccess: (_created, variables) => {
            const dateStr = variables?.data?.date_worked
            message.success(dateStr ? `Time logged for ${dateStr}.` : 'Time logged.')
            setLogTimeTask(null)
            queryClient.invalidateQueries({ queryKey: queryKeys.workLogs.all })
            queryClient.invalidateQueries({ queryKey: queryKeys.periodStatus.all })
            queryClient.invalidateQueries({ queryKey: queryKeys.taskActivity.all })
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to log time.')
        },
    })

    /** Modalin gonderim kapisi — gorev baglamini payload'a ekler. */
    const submitWorkLog = async (data) => {
        // task_id backend'in work_logs.task_id'yi baglamasi ve
        // log_time_created aktivite olayini uretmesi icin tasinir.
        await workLogMutation.mutateAsync({
            data: { ...data, task_id: logTimeTask?.id || null },
            assigneeUserId: logTimeTask?.assignee_user_id || null,
        })
    }

    return {
        logTimeTask,
        openLogTime: setLogTimeTask,
        closeLogTime: () => setLogTimeTask(null),
        submitWorkLog,
        isLoggingTime: workLogMutation.isPending,
    }
}

export default useTaskWorkLog
