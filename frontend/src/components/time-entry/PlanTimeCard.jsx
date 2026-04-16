/**
 * =============================================================================
 * HERMES - Plan Time Card Component
 * =============================================================================
 * Takvimde plan time olaylarını renk kodlu gösterir.
 * Kullanıcı Accept / Reject yapabilir ve fikir değiştirebilir.
 *
 * Renk Kodlama:
 *   Pending  → Sarı  (#faad14)
 *   Accepted → Yeşil (#52c41a)
 *   Rejected → Kırmızı (#ff4d4f)
 *   Süresi Geçmiş → Mavi (#1677ff) — diğer tüm statüsleri override eder
 * =============================================================================
 */

import { Button, Tooltip } from 'antd'
import { CheckOutlined, CloseOutlined, ClockCircleOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

function getCardStyle(status, isExpired) {
    if (isExpired) {
        return { bg: 'rgba(22, 119, 255, 0.15)', border: '#1677ff', label: 'Expired', labelColor: '#1677ff' }
    }
    switch (status) {
        case 'accepted':
            return { bg: 'rgba(82, 196, 26, 0.15)', border: '#52c41a', label: 'Accepted', labelColor: '#52c41a' }
        case 'rejected':
            return { bg: 'rgba(255, 77, 79, 0.15)', border: '#ff4d4f', label: 'Rejected', labelColor: '#ff4d4f' }
        default: // pending
            return { bg: 'rgba(250, 173, 20, 0.15)', border: '#faad14', label: 'Pending', labelColor: '#faad14' }
    }
}

function PlanTimeCard({ planTime, onRespond, responding = false }) {
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
    } = planTime

    // Süresi geçmiş mi? end_date + end_time ikilisini karşılaştır
    const endMoment = end_time
        ? dayjs(`${end_date} ${end_time}`)
        : dayjs(end_date).endOf('day')
    const isExpired = endMoment.isBefore(dayjs())

    const { bg, border, label, labelColor } = getCardStyle(status, isExpired)

    const timeLabel = start_time && end_time
        ? `${start_time} – ${end_time}`
        : start_date === end_date ? start_date : `${start_date} → ${end_date}`

    const recurrenceLabel = recurrence && recurrence !== 'one_time'
        ? ` · ${recurrence.charAt(0).toUpperCase() + recurrence.slice(1)}`
        : ''

    return (
        <div
            style={{
                background: bg,
                border: `1px solid ${border}`,
                borderLeft: `3px solid ${border}`,
                borderRadius: 6,
                padding: '8px 10px',
                marginBottom: 6,
                position: 'relative',
            }}
        >
            {/* Başlık satırı */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, color: '#fff', lineHeight: 1.3, marginBottom: 2 }}>
                        {project_name || 'Plan Time'}
                    </div>
                    <div style={{ fontSize: 11, color: '#aaa' }}>
                        {customer_name}
                    </div>
                </div>
                {/* Statü badge */}
                <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: labelColor,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginLeft: 6,
                    flexShrink: 0,
                }}>
                    {label}
                </span>
            </div>

            {/* Zaman */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5, color: '#888', fontSize: 11 }}>
                <ClockCircleOutlined style={{ fontSize: 10 }} />
                <span>{timeLabel}{recurrenceLabel}</span>
            </div>

            {/* Açıklama */}
            {description && (
                <Tooltip title={description}>
                    <div style={{
                        marginTop: 4,
                        fontSize: 11,
                        color: '#777',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                    }}>
                        {description}
                    </div>
                </Tooltip>
            )}

            {/* Accept / Reject butonları — süresi geçmemişse göster */}
            {!isExpired && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <Button
                        size="small"
                        type={status === 'accepted' ? 'primary' : 'default'}
                        icon={<CheckOutlined />}
                        loading={responding}
                        onClick={() => onRespond?.(id, 'accepted')}
                        style={{
                            fontSize: 11,
                            height: 24,
                            padding: '0 8px',
                            ...(status === 'accepted'
                                ? { background: '#52c41a', borderColor: '#52c41a' }
                                : { borderColor: '#52c41a', color: '#52c41a' }),
                        }}
                    >
                        Accept
                    </Button>
                    <Button
                        size="small"
                        type={status === 'rejected' ? 'primary' : 'default'}
                        icon={<CloseOutlined />}
                        loading={responding}
                        onClick={() => onRespond?.(id, 'rejected')}
                        style={{
                            fontSize: 11,
                            height: 24,
                            padding: '0 8px',
                            ...(status === 'rejected'
                                ? { background: '#ff4d4f', borderColor: '#ff4d4f' }
                                : { borderColor: '#ff4d4f', color: '#ff4d4f' }),
                        }}
                    >
                        Reject
                    </Button>
                </div>
            )}
        </div>
    )
}

export default PlanTimeCard
