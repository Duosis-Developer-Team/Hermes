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
import { Spin, message } from 'antd'

import { ChipGroup } from '../../../components/liquid'

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

    /* Hermes Liquid (29.09): secim bir cip grubudur (prototip); deger ve
       kaydetme davranisi AYNI — secim aninda tek istek, pending iken kilit. */
    return (
        <div className="tm-policy-row">
            <div className="tm-policy-text">
                <div className="tm-policy-label">{t('lifecycle.autoArchiveAfter')}</div>
                <div className="tm-policy-hint">{t('lifecycle.policyHint')}</div>
            </div>
            <div className="tm-policy-control">
                <ChipGroup
                    ariaLabel={t('lifecycle.retention')}
                    value={current}
                    onChange={(v) => {
                        if (v === undefined || v === current) return
                        if (mutation.isPending) return
                        mutation.mutate(v)
                    }}
                    options={OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
                />
                {mutation.isPending && <Spin size="small" />}
            </div>
        </div>
    )
}

export default LifecyclePolicyControl
