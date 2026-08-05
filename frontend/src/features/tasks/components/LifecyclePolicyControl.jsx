/**
 * =============================================================================
 * HERMES - Work Item Lifecycle / Archive Policy (PM Configurations)
 * =============================================================================
 * Global retention ayari. Yetki BACKEND'de zorunludur (PM Configurations
 * yonetim izni); buradaki gizleme yalnizca gorunum kolayligidir —
 * yetkisiz istek sunucuda 403 alir.
 *
 * "Never" ACIK ve tip guvenli sekilde `null` ile temsil edilir; sihirli
 * -1 gibi belirsiz deger KULLANILMAZ.
 * =============================================================================
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import { Select, Spin, message } from 'antd'

import useTaskInvalidation from '../hooks/useTaskInvalidation'
import { normalizeApiError } from '../../admin/shared/normalizeApiError'
import { queryKeys } from '../../../query/queryKeys'
import { taskService } from '../../../services/api'

const NEVER = '__never__'

const OPTIONS = [
    { value: 1, label: '1 day' },
    { value: 7, label: '7 days' },
    { value: 14, label: '14 days' },
    { value: 30, label: '30 days' },
    { value: NEVER, label: 'Never' },
]

function LifecyclePolicyControl() {
    // Anahtar ve invalidation MERKEZI sozlesmeden gelir; bu bilesen
    // kendi anahtarini yazmaz.
    const { invalidateLifecyclePolicy } = useTaskInvalidation()
    const { data, isLoading } = useQuery({
        queryKey: queryKeys.taskLifecyclePolicy.all,
        queryFn: () => taskService.getLifecyclePolicy(),
    })

    const mutation = useMutation({
        mutationFn: (value) =>
            taskService.setLifecyclePolicy(value === NEVER ? null : value),
        onSuccess: () => {
            message.success('Archive policy updated')
            invalidateLifecyclePolicy()
        },
        onError: (error) => message.error(normalizeApiError(error).message),
    })

    if (isLoading) return <Spin size="small" />

    const current = data?.retention_days == null ? NEVER : data.retention_days

    return (
        <div className="tm-policy-row">
            <div className="tm-policy-text">
                <div className="tm-policy-label">
                    Auto-archive completed work items after
                </div>
                <div className="tm-policy-hint">
                    Pending and In Progress work stays in Active regardless of
                    age. Archiving never deletes anything — logged time and
                    history stay untouched and items can be restored.
                </div>
            </div>
            <Select
                aria-label="Auto-archive retention"
                value={current}
                onChange={(v) => {
                    if (mutation.isPending) return
                    mutation.mutate(v)
                }}
                loading={mutation.isPending}
                options={OPTIONS}
                style={{ minWidth: 160 }}
            />
        </div>
    )
}

export default LifecyclePolicyControl
