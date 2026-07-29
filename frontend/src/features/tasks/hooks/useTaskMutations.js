/**
 * =============================================================================
 * HERMES - Tasks mutasyonlari + invalidation (Sprint 5C)
 * =============================================================================
 * Gorev yazan HER islem burada. Tek yerde olmasinin sebebi INVALIDATION
 * SOZLESMESI: bir gorev degistiginde tazelenmesi gerekenler tam olarak
 * `tasks` ve `task-activity` aileleridir — ne eksik ne fazla. Referans
 * veriler (customers/projects/users) ve Time Entry aileleri gorev
 * mutasyonundan ETKILENMEZ; matris src/test/tasks/crud.integration.test
 * .jsx ile kilitli.
 *
 * Anahtarlar merkezi sozlesmeden gelir ve invalidation HEP v5 object
 * syntax'iyla yapilir (dizi bicimi TUM cache'i invalid ederdi —
 * queryKeys.js basligindaki Sprint 1 bulgusu).
 *
 * Hata sahipligi: sunucu mesajini burasi gosterir. Cagiran taraf
 * reddi YUTAR — AntD Form onFinish'i await etmedigi icin disari
 * sizan red "Uncaught (in promise)" uretiyordu.
 * =============================================================================
 */
import { useMutation } from '@tanstack/react-query'
import { message } from 'antd'

import { taskService } from '../../../services/api'
import { typeMeta } from '../../../utils/workItemType'
import useTaskInvalidation from './useTaskInvalidation'

const detail = (err, fallback) => err?.response?.data?.detail || fallback

export function useTaskMutations({ createType, onWriteSettled, onTaskRefreshed }) {
    const { invalidateTaskFamilies } = useTaskInvalidation()

    const afterWrite = (text) => {
        if (text) message.success(text)
        invalidateTaskFamilies()
        onWriteSettled?.()
    }

    const createMutation = useMutation({
        mutationFn: (data) => taskService.create(data),
        onSuccess: () =>
            afterWrite(`${typeMeta(createType).singular} created successfully.`),
        onError: (err) =>
            message.error(
                detail(err, `Failed to create ${typeMeta(createType).lower}.`)
            ),
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => taskService.update(id, data),
        onSuccess: () => afterWrite(`${typeMeta(createType).singular} updated.`),
        onError: (err) =>
            message.error(
                detail(err, `Failed to update ${typeMeta(createType).lower}.`)
            ),
    })

    const createGroupMutation = useMutation({
        mutationFn: (data) => taskService.createForGroup(data),
        onSuccess: (res) => {
            const count = Array.isArray(res?.tasks) ? res.tasks.length : 0
            const noun =
                count === 1
                    ? typeMeta(createType).lower
                    : typeMeta(createType).lowerPlural
            afterWrite(`${count} ${noun} created for the group.`)
        },
        onError: (err) =>
            message.error(
                detail(
                    err,
                    `Failed to create group ${typeMeta(createType).lowerPlural}.`
                )
            ),
    })

    // Multi-assignee create — one item per selected user / group member.
    const createBulkMutation = useMutation({
        mutationFn: (data) => taskService.createBulk(data),
        onSuccess: (tasks) => {
            const count = Array.isArray(tasks) ? tasks.length : 0
            const noun =
                count === 1
                    ? typeMeta(createType).lower
                    : typeMeta(createType).lowerPlural
            afterWrite(`${count} ${noun} created.`)
        },
        onError: (err) =>
            message.error(
                detail(err, `Failed to create ${typeMeta(createType).lowerPlural}.`)
            ),
    })

    const completionMutation = useMutation({
        mutationFn: ({ id, completed }) => taskService.setCompleted(id, completed),
        onSuccess: () => invalidateTaskFamilies(),
        onError: (err) => message.error(detail(err, 'Failed to update status.')),
    })

    const deleteMutation = useMutation({
        mutationFn: (taskId) => taskService.delete(taskId),
        onSuccess: () => {
            message.success('Task deleted.')
            invalidateTaskFamilies()
        },
        onError: (err) => {
            message.error(detail(err, 'Failed to delete task.'))
            // Onay modali ACIK kalir: silme basarisiz oldugunda diyalogu
            // kapatmak kullaniciya "silindi" izlenimi veriyordu.
        },
    })

    const rejectMutation = useMutation({
        mutationFn: (taskId) => taskService.reject(taskId),
        onSuccess: (updated) => {
            message.success('Task rejected.')
            invalidateTaskFamilies()
            onTaskRefreshed?.(updated)
        },
        onError: (err) => message.error(detail(err, 'Failed to reject task.')),
    })

    const reopenMutation = useMutation({
        mutationFn: (taskId) => taskService.updateStatus(taskId, 'pending'),
        onSuccess: (updated) => {
            invalidateTaskFamilies()
            onTaskRefreshed?.(updated)
        },
        onError: (err) => message.error(detail(err, 'Failed to reopen task.')),
    })

    // Accept a pending task — moves it into In Progress. First step of the
    // assignee workflow: pending → (accept) → in_progress → (complete).
    const acceptMutation = useMutation({
        mutationFn: (taskId) => taskService.updateStatus(taskId, 'in_progress'),
        onSuccess: (updated) => {
            message.success('Task accepted — moved to In Progress.')
            invalidateTaskFamilies()
            onTaskRefreshed?.(updated)
        },
        onError: (err) => message.error(detail(err, 'Failed to accept task.')),
    })

    /**
     * Create/edit modalinin tek gonderim kapisi. `meta` hangi ucun
     * kullanilacagini modal belirler: { taskId? , isBulk? , isGroup? }.
     */
    const submitTask = async (payload, meta = {}) => {
        try {
            if (meta.taskId) {
                await updateMutation.mutateAsync({ id: meta.taskId, data: payload })
            } else if (meta.isBulk) {
                await createBulkMutation.mutateAsync(payload)
            } else if (meta.isGroup) {
                await createGroupMutation.mutateAsync(payload)
            } else {
                await createMutation.mutateAsync(payload)
            }
        } catch {
            // toast zaten gosterildi; form ve modal yerinde kalir
        }
    }

    return {
        submitTask,
        completionMutation,
        deleteMutation,
        rejectMutation,
        reopenMutation,
        acceptMutation,
        isSavingTask:
            createMutation.isPending ||
            updateMutation.isPending ||
            createGroupMutation.isPending ||
            createBulkMutation.isPending,
        isStatusActionPending:
            rejectMutation.isPending ||
            reopenMutation.isPending ||
            completionMutation.isPending ||
            acceptMutation.isPending,
    }
}

export default useTaskMutations
