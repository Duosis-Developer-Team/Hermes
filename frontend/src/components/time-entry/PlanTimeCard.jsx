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
 *   Organizer → Mor (#8b5cf6) — sadece oluşturan admin için
 * =============================================================================
 */

import { Button, Tooltip } from 'antd'
import { CheckOutlined, CloseOutlined, ClockCircleOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import './PlanTimeCard.css'

function getCardStyle(status, isExpired) {
    if (isExpired) {
        return { bg: 'rgba(22, 119, 255, 0.15)', border: '#1677ff', label: 'Expired', labelColor: '#1677ff' }
    }
    switch (status) {
        case 'accepted':
            return { bg: 'rgba(82, 196, 26, 0.15)', border: '#52c41a', label: 'Accepted', labelColor: '#52c41a' }
        case 'rejected':
            return { bg: 'rgba(255, 77, 79, 0.15)', border: '#ff4d4f', label: 'Rejected', labelColor: '#ff4d4f' }
        case null:
        case undefined:
            return { bg: 'rgba(139, 92, 246, 0.15)', border: '#8b5cf6', label: 'Scheduled', labelColor: '#8b5cf6' }
        default: // pending
            return { bg: 'rgba(250, 173, 20, 0.15)', border: '#faad14', label: 'Pending', labelColor: '#faad14' }
    }
}

function PlanTimeCard({ planTime, onRespond, onDelete, onEdit, isAdmin = false, responding = false }) {
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

    // Recurring planlar için expired kontrolü: weekly/monthly ise expired sayılmaz
    const isRecurring = recurrence === 'weekly' || recurrence === 'monthly'
    const endMoment = end_time
        ? dayjs(`${end_date} ${end_time}`)
        : dayjs(end_date).endOf('day')
    const isExpired = !isRecurring && endMoment.isBefore(dayjs())

    const { bg, border, label, labelColor } = getCardStyle(status, isExpired)

    const timeLabel = start_time && end_time
        ? `${start_time} – ${end_time}`
        : start_date === end_date ? start_date : `${start_date} → ${end_date}`

    const recurrenceLabel = recurrence && recurrence !== 'one_time'
        ? ` · ${recurrence === 'weekly' ? 'Weekly' : 'Monthly'}`
        : ''

    return (
        <div
            className="plan-time-card"
            style={{
                background: bg,
                border: `1px solid ${border}`,
                borderLeft: `3px solid ${border}`,
                borderRadius: 6,
                padding: '8px 10px',
                marginBottom: 6,
            }}
        >
            {/* Admin: hover action butonları (WorkLogCard tarzı) */}
            {canManage && (
                <div className="plan-time-card-actions">
                    <Tooltip title="Edit">
                        <button
                            className="plan-time-action-btn"
                            onClick={(e) => { e.stopPropagation(); onEdit?.(planTime) }}
                        >
                            <EditOutlined />
                        </button>
                    </Tooltip>
                    <Tooltip title="Delete">
                        <button
                            className="plan-time-action-btn delete"
                            onClick={(e) => { e.stopPropagation(); onDelete?.(planTime) }}
                        >
                            <DeleteOutlined />
                        </button>
                    </Tooltip>
                </div>
            )}

            {/* Başlık satırı */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0, paddingRight: canManage ? 52 : 0 }}>
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

            {/* Accept / Reject — altta, kartın içinde (süresi geçmemişse ve kişisel atama varsa) */}
            {!isExpired && hasAssignment && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button
                        onClick={(e) => { e.stopPropagation(); onRespond?.(id, 'accepted') }}
                        style={{
                            flex: 1,
                            height: 26,
                            border: `1px solid ${status === 'accepted' ? '#52c41a' : 'rgba(82,196,26,0.4)'}`,
                            borderRadius: 4,
                            background: status === 'accepted' ? 'rgba(82,196,26,0.25)' : 'transparent',
                            color: '#52c41a',
                            cursor: 'pointer',
                            fontSize: 11,
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 4,
                        }}
                    >
                        <CheckOutlined style={{ fontSize: 10 }} /> Accept
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); onRespond?.(id, 'rejected') }}
                        style={{
                            flex: 1,
                            height: 26,
                            border: `1px solid ${status === 'rejected' ? '#ff4d4f' : 'rgba(255,77,79,0.4)'}`,
                            borderRadius: 4,
                            background: status === 'rejected' ? 'rgba(255,77,79,0.25)' : 'transparent',
                            color: '#ff4d4f',
                            cursor: 'pointer',
                            fontSize: 11,
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 4,
                        }}
                    >
                        <CloseOutlined style={{ fontSize: 10 }} /> Reject
                    </button>
                </div>
            )}
        </div>
    )
}

export default PlanTimeCard
