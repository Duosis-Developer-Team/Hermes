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
import PlanTimeCard from './PlanTimeCard'
import './DayColumn.css'

dayjs.locale('en')

const DAILY_TARGET_HOURS = 8

function DayColumn({
    date,
    workLogs = [],
    planTimes = [],
    onLogTime,
    onPlanTime,
    onEditLog,
    onDeleteLog,
    onPlanTimeRespond,
    onDeletePlanTime,
    onEditPlanTime,
    isToday = false,
    isAdmin = false,
    // Copy-paste props
    selectedLogId,
    copiedLogId,
    isTargeted = false,
    hasCopiedLog = false,
    onSelectLog,
    onSelectDay
}) {
    const dateKey = dayjs(date).format('YYYY-MM-DD')
    const dayName = dayjs(date).format('ddd')
    const dayNumber = dayjs(date).format('DD')

    // 0.75 → "45m", 2.75 → "2h 45m", 2.0 → "2h"
    const formatDuration = (decimal) => {
        if (!decimal) return '0h'
        const h = Math.floor(decimal)
        const m = Math.round((decimal - h) * 60)
        if (m > 0) return `${h}h ${m}m`
        return `${h}h`
    }

    // Günlük toplam saat hesapla
    const totalHours = workLogs.reduce((sum, log) => sum + (parseFloat(log.duration_hours) || 0), 0)
    const progressPercent = Math.min((totalHours / DAILY_TARGET_HOURS) * 100, 100)

    const dayOfWeek = dayjs(date).day() // 0 = Sun, 6 = Sat
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

    // Paste target selection — fires when clicking day background (not cards or buttons)
    const handleDayClick = () => {
        if (hasCopiedLog) {
            onSelectDay?.(dateKey)
        }
    }

    // + butonu dropdown menü — Plan Time sadece Admin için
    const menuItems = [
        {
            key: 'log-time',
            label: 'Log Time',
            icon: <ClockCircleOutlined />,
            onClick: () => onLogTime?.(date),
        },
        ...(isAdmin ? [{
            key: 'plan-time',
            label: 'Plan Time',
            icon: <ScheduleOutlined />,
            onClick: () => onPlanTime?.(date),
        }] : []),
    ]

    return (
        <div
            className={`day-column${isWeekend ? ' day-column-weekend' : ''}${isToday ? ' day-column-today' : ''}${isTargeted ? ' day-column-targeted' : ''}`}
            aria-current={isToday ? 'date' : undefined}
            onClick={handleDayClick}
        >
            {/* Gün Başlığı */}
            <div className="day-column-header">
                <div className={`day-column-name${isToday ? ' h-today-flag' : ''}`}>
                    <span className="day-name">{dayName}</span>
                    <span className="day-number">{dayNumber}</span>
                    {isToday && <span className="h-today-label">Today</span>}
                </div>
                <div className="day-column-hours">
                    {formatDuration(totalHours)} / {DAILY_TARGET_HOURS}h
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
                            isCopied={copiedLogId === log.id}
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

            {/* Plan Time Kartları */}
            {planTimes.length > 0 && (
                <>
                    <div className="day-column-section-title" style={{ marginTop: 8 }}>
                        PLANNED
                    </div>
                    <div className="day-column-logs">
                        {planTimes.map(pt => (
                            <PlanTimeCard
                                key={pt.assignment_id || pt.id}
                                planTime={pt}
                                onRespond={onPlanTimeRespond}
                                onDelete={onDeletePlanTime}
                                onEdit={onEditPlanTime}
                                isAdmin={isAdmin}
                                calendarDate={dateKey}
                            />
                        ))}
                    </div>
                </>
            )}
        </div>
    )
}

export default DayColumn
