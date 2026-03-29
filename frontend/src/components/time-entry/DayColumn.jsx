/**
 * =============================================================================
 * HERMES - Day Column Component
 * =============================================================================
 * Tek bir günü temsil eden kolon - haftalık List view'da kullanılır.
 * Jira Tempo tarzı: Gün başlığı, progress, + butonu, worklog kartları.
 * Copy-paste: hasCopiedLog=true iken kolona tıklamak onu paste hedefi yapar.
 * =============================================================================
 */

import { Dropdown, Progress } from 'antd'
import { PlusOutlined, ClockCircleOutlined, ScheduleOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import 'dayjs/locale/en'
import WorkLogCard from './WorkLogCard'
import './DayColumn.css'

dayjs.locale('en')

const DAILY_TARGET_HOURS = 8

function DayColumn({
    date,
    workLogs = [],
    onLogTime,
    onPlanTime,
    onEditLog,
    onDeleteLog,
    isToday = false,
    // Copy-paste props
    selectedLogId,
    isTargeted = false,
    hasCopiedLog = false,
    onSelectLog,
    onSelectDay
}) {
    const dateKey = dayjs(date).format('YYYY-MM-DD')
    const dayName = dayjs(date).format('ddd')
    const dayNumber = dayjs(date).format('DD')

    // Format hours: 1.00 -> 1, 2.50 -> 2.5
    const formatHours = (hours) => {
        if (!hours) return '0'
        const num = parseFloat(hours)
        if (Number.isInteger(num)) return num
        return parseFloat(num.toFixed(2))
    }

    // Günlük toplam saat hesapla
    const totalHours = workLogs.reduce((sum, log) => sum + (parseFloat(log.duration_hours) || 0), 0)
    const progressPercent = Math.min((totalHours / DAILY_TARGET_HOURS) * 100, 100)

    // Paste target selection — fires when clicking day background (not cards or buttons)
    const handleDayClick = () => {
        if (hasCopiedLog) {
            onSelectDay?.(dateKey)
        }
    }

    // + butonu dropdown menü
    const menuItems = [
        {
            key: 'log-time',
            label: 'Log Time',
            icon: <ClockCircleOutlined />,
            onClick: () => onLogTime?.(date),
        },
        {
            key: 'plan-time',
            label: 'Plan Time',
            icon: <ScheduleOutlined />,
            onClick: () => onPlanTime?.(date),
        },
    ]

    return (
        <div
            className={`day-column${isToday ? ' day-column-today' : ''}${isTargeted ? ' day-column-targeted' : ''}`}
            onClick={handleDayClick}
        >
            {/* Gün Başlığı */}
            <div className="day-column-header">
                <div className="day-column-name">
                    <span className="day-name">{dayName}</span>
                    <span className="day-number">{dayNumber}</span>
                </div>
                <div className="day-column-hours">
                    {formatHours(totalHours)}h / {DAILY_TARGET_HOURS}h
                </div>
            </div>

            {/* Progress Bar */}
            <div className="day-column-progress">
                <Progress
                    percent={progressPercent}
                    showInfo={false}
                    strokeColor={progressPercent >= 100 ? '#52c41a' : 'var(--color-primary)'}
                    trailColor="var(--bg-tertiary)"
                    size="small"
                />
            </div>

            {/* + Butonu — stopPropagation to avoid triggering day selection */}
            <Dropdown menu={{ items: menuItems }} trigger={['click']}>
                <button
                    className="day-column-add-btn"
                    onClick={(e) => e.stopPropagation()}
                >
                    <PlusOutlined />
                </button>
            </Dropdown>

            {/* Worklogs Başlık */}
            <div className="day-column-section-title">
                LOGS
            </div>

            {/* Worklog Kartları */}
            <div className="day-column-logs">
                {workLogs.length === 0 ? (
                    <div className={`day-column-empty${hasCopiedLog ? ' day-column-empty-paste' : ''}`}>
                        {hasCopiedLog ? '↓ Click here or press Ctrl+V' : 'No logs'}
                    </div>
                ) : (
                    workLogs.map(log => (
                        <WorkLogCard
                            key={log.id}
                            workLog={log}
                            onEdit={onEditLog}
                            onDelete={onDeleteLog}
                            isSelected={selectedLogId === log.id}
                            onSelect={onSelectLog}
                        />
                    ))
                )}

                {/* Paste hint — shown at bottom when day has logs and clipboard is active */}
                {workLogs.length > 0 && hasCopiedLog && (
                    <div className="day-column-paste-hint">
                        + Paste here (Ctrl+V)
                    </div>
                )}
            </div>
        </div>
    )
}

export default DayColumn
