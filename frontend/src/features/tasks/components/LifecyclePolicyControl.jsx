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
import { useT } from '../../../i18n'

const NEVER = '__never__'

// Secenekler ANAHTAR tasir; ceviri render'da yapilir.
const OPTIONS = [
    { value: 1, labelKey: 'lifecycle.oneDay' },
    { value: 7, labelKey: 'lifecycle.sevenDays' },
    { value: 14, labelKey: 'lifecycle.fourteenDays' },
    { value: 30, labelKey: 'lifecycle.thirtyDays' },
    { value: NEVER, labelKey: 'lifecycle.never' },
]

function LifecyclePolicyControl() {
    const t = useT()
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
            message.success(t('lifecycle.policyUpdated'))
            invalidateLifecyclePolicy()
        },
        onError: (error) => message.error(normalizeApiError(error).message),
    })

    if (isLoading) return <Spin size="small" />

    const current = data?.retention_days == null ? NEVER : data.retention_days

    return (
        <div className="tm-policy-row">
            <div className="tm-policy-text">
                <div className="tm-policy-label">{t('lifecycle.autoArchiveAfter')}</div>
                <div className="tm-policy-hint">
                    Pending and In Progress work stays in Active regardless of
                    age. Archiving never deletes anything — logged time and
                    history stay untouched and items can be restored.
                </div>
            </div>
            <Select
                aria-label={t('lifecycle.retention')}
                value={current}
                onChange={(v) => {
                    if (mutation.isPending) return
                    mutation.mutate(v)
                }}
                loading={mutation.isPending}
                options={OPTIONS.map((o) => ({ ...o, label: t(o.labelKey) }))}
                style={{ minWidth: 160 }}
            />
        </div>
    )
}

export default LifecyclePolicyControl
