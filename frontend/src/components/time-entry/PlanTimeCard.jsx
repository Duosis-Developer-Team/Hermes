/**
 * =============================================================================
 * HERMES - Plan Time Card Component
 * =============================================================================
 * Takvimde plan time olaylarını renk kodlu gösterir.
 * Kullanıcı Accept / Reject yapabilir ve fikir değiştirebilir.
 *
 * Durum tonu (Hermes Liquid, token — PlanTimeCard.css):
 *   pending → amber · accepted → yesil · rejected → kirmizi ·
 *   expired → mavi (digerlerini ezer) · organizer → mor (olusturan admin)
 * =============================================================================
 */

import { Tooltip } from 'antd'
import { CheckOutlined, CloseOutlined, ClockCircleOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import './PlanTimeCard.css'
import { useT } from '../../i18n'

// Saf yardimci — hook CAGIRAMAZ. Ceviri ANAHTARI + ton doner; renk
// CSS'te (PlanTimeCard.css, token). Hermes Liquid: ham hex yok.
function cardTone(status, isExpired) {
    if (isExpired) return { tone: 'expired', labelKey: 'planCard.expired' }
    switch (status) {
        case 'accepted': return { tone: 'accepted', labelKey: 'plan.accepted' }
        case 'rejected': return { tone: 'rejected', labelKey: 'plan.rejected' }
        case null:
        case undefined: return { tone: 'organizer', labelKey: 'planCard.scheduled' }
        default: return { tone: 'pending', labelKey: 'plan.pending' }
    }
}

function PlanTimeCard({ planTime, onRespond, onDelete, onEdit, isAdmin = false, calendarDate = null }) {
    const t = useT()
    const {
        id,
        project_name,
        customer_name,
        start_date,
        end_date,
        start_time,
        end_time,
        description,
        status,
        recurrence,
        assignment_id,  // undefined → admin organizer view
    } = planTime

    // Admin her zaman edit/delete yapabilir
    const canManage = isAdmin
    // Kişisel assignment varsa accept/reject göster
    const hasAssignment = !!assignment_id

    const isRecurring = recurrence === 'weekly' || recurrence === 'monthly'

    // Recurring planlar için o günün occurrence'ına göre expired kontrol et
    // calendarDate: kartın gösterildiği takvim günü (YYYY-MM-DD)
    const checkDate = isRecurring && calendarDate ? calendarDate : end_date
    const endMoment = end_time
        ? dayjs(`${checkDate} ${end_time}`)
        : dayjs(checkDate).endOf('day')
    const isExpired = endMoment.isBefore(dayjs())

    const { tone, labelKey } = cardTone(status, isExpired)

    const timeLabel = start_time && end_time
        ? `${start_time} – ${end_time}`
        : start_date === end_date ? start_date : `${start_date} → ${end_date}`

    const recurrenceLabel = recurrence && recurrence !== 'one_time'
        ? ` · ${recurrence === 'weekly' ? 'Weekly' : 'Monthly'}`
        : ''

    return (
        <div className={`plan-time-card plan-time-card--${tone}`}>
            {/* Admin: hover action butonlari (WorkLogCard tarzi) */}
            {canManage && (
                <div className="plan-time-card-actions">
                    <Tooltip title={t('common.edit')}>
                        <button
                            className="plan-time-action-btn"
                            aria-label={t('common.edit')}
                            onClick={(e) => { e.stopPropagation(); onEdit?.(planTime) }}
                        >
                            <EditOutlined />
                        </button>
                    </Tooltip>
                    <Tooltip title={t('common.delete')}>
                        <button
                            className="plan-time-action-btn delete"
                            aria-label={t('common.delete')}
                            onClick={(e) => { e.stopPropagation(); onDelete?.(planTime) }}
                        >
                            <DeleteOutlined />
                        </button>
                    </Tooltip>
                </div>
            )}

            <div className="plan-time-card-title">
                {[customer_name, project_name].filter(Boolean).join(' \u00b7 ') || 'Plan Time'}
            </div>
            <div className="plan-time-card-meta">
                <ClockCircleOutlined aria-hidden="true" />
                <span className="lq-mono">{timeLabel}</span>
                <span>{recurrenceLabel ? recurrenceLabel.replace(' \u00b7 ', '') + ' \u00b7 ' : ''}{t(labelKey)}</span>
            </div>

            {description && (
                <Tooltip title={description}>
                    <div className="plan-time-card-desc">{description}</div>
                </Tooltip>
            )}

            {/* Kabul / Ret — suresi gecmemis kisisel atamada */}
            {!isExpired && hasAssignment && (
                <div className="plan-time-card-respond">
                    <button
                        type="button"
                        className={`plan-time-respond${status === 'accepted' ? ' is-on' : ''}`}
                        aria-pressed={status === 'accepted'}
                        onClick={(e) => { e.stopPropagation(); onRespond?.(id, 'accepted') }}
                    >
                        <CheckOutlined aria-hidden="true" />{t('planCard.accept')}
                    </button>
                    <button
                        type="button"
                        className={`plan-time-respond plan-time-respond--reject${status === 'rejected' ? ' is-on' : ''}`}
                        aria-pressed={status === 'rejected'}
                        onClick={(e) => { e.stopPropagation(); onRespond?.(id, 'rejected') }}
                    >
                        <CloseOutlined aria-hidden="true" />{t('planCard.reject')}
                    </button>
                </div>
            )}
        </div>
    )
}

export default PlanTimeCard
