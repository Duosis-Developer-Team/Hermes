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
import { useT } from '../../i18n'

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
    onSelectDay,
    // PM rework P0 / D2 — kapasite: {expected_hours, status, is_holiday,
    // holiday_name, is_absent, absence_type, absence_id}. Yoksa eski
    // davranis (8h sabiti, uyari yok) AYNEN korunur.
    capacity = null,
    onMarkAbsence,
    onRemoveAbsence,
}) {
    const t = useT()
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
    /*
     * Beklenen saat artik KAPASITE ayarindan gelir (kiraci varsayilani +
     * kullanici override + tatil/izin). Sunucu 'off' dedigi gun icin 0
     * doner; o gun hedef ve ilerleme cubugu cizilmez. Kapasite verisi
     * yoksa 8h sabiti — eski davranis, sessiz gerileme.
     */
    const expectedHours = capacity ? Number(capacity.expected_hours) : DAILY_TARGET_HOURS
    const hasTarget = expectedHours > 0
    const progressPercent = hasTarget ? Math.min((totalHours / expectedHours) * 100, 100) : 0
    const dayStatus = capacity?.status || null
    const isMissing = dayStatus === 'missing'
    const isAbsent = !!capacity?.is_absent
    const isHoliday = !!capacity?.is_holiday

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
            label: t('taskUi.logTime'),
            icon: <ClockCircleOutlined />,
            onClick: () => onLogTime?.(date),
        },
        ...(isAdmin ? [{
            key: 'plan-time',
            label: t('timesheet.planTime'),
            icon: <ScheduleOutlined />,
            onClick: () => onPlanTime?.(date),
        }] : []),
    ]

    return (
        <div
            className={`day-column${isWeekend ? ' day-column-weekend' : ''}${isToday ? ' day-column-today' : ''}${isTargeted ? ' day-column-targeted' : ''}${isMissing ? ' day-column-missing' : ''}${dayStatus === 'off' ? ' day-column-off' : ''}`}
            data-day-status={dayStatus || undefined}
            aria-current={isToday ? 'date' : undefined}
            onClick={handleDayClick}
        >
            {/* Gün Başlığı */}
            <div className="day-column-header">
                <div className={`day-column-name${isToday ? ' h-today-flag' : ''}`}>
                    <span className="day-name">{dayName}</span>
                    <span className="day-number">{dayNumber}</span>
                    {isToday && <span className="h-today-label">{t('meetings.today')}</span>}
                    {isMissing && (
                        <span
                            className="day-column-missing-dot"
                            role="img"
                            aria-label={t('timeEntry.dayEmpty')}
                            title={t('timeEntry.dayEmpty')}
                        />
                    )}
                </div>
                <div className="day-column-hours">
                    {hasTarget
                        ? <>{formatDuration(totalHours)} / {expectedHours}h</>
                        : isHoliday
                            ? <span className="day-column-off-label" title={capacity.holiday_name || ''}>{t('timeEntry.holiday')}</span>
                            : isAbsent
                                ? <span className="day-column-off-label">{t('timeEntry.onLeave')}</span>
                                : formatDuration(totalHours)}
                </div>
            </div>

            {/* Progress Bar — yalniz beklenen saati olan gunlerde */}
            {hasTarget && (
                <div className="day-column-progress">
                    <Progress
                        percent={progressPercent}
                        showInfo={false}
                        strokeColor={progressPercent >= 100 ? '#52c41a' : 'var(--color-primary)'}
                        trailColor="var(--bg-tertiary)"
                        size="small"
                    />
                </div>
            )}

            {/* Eksik gun durtmesi: sari, tiklanabilir, suclayici DEGIL (04-roller §7).
                Modal yok, toast yok — uyari bulundugu kutunun icinde. */}
            {isMissing && (
                <div className="day-column-missing-hint" onClick={(e) => e.stopPropagation()}>
                    <span className="day-column-missing-text">{t('timeEntry.dayEmpty')}</span>
                    <div className="day-column-missing-actions">
                        <button
                            type="button"
                            className="day-column-mini-btn"
                            onClick={() => onLogTime?.(date)}
                        >
                            {t('taskUi.logTime')}
                        </button>
                        {onMarkAbsence && (
                            <button
                                type="button"
                                className="day-column-mini-btn"
                                onClick={() => onMarkAbsence(dateKey)}
                            >
                                {t('timeEntry.markLeave')}
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Izin etiketi — kaldirma yalniz izin verilmisse (kendi izni / admin) */}
            {isAbsent && (
                <div className="day-column-absence" onClick={(e) => e.stopPropagation()}>
                    <span>{t('timeEntry.onLeave')}</span>
                    {onRemoveAbsence && capacity.absence_id && (
                        <button
                            type="button"
                            className="day-column-mini-btn"
                            aria-label={t('timeEntry.removeLeave')}
                            title={t('timeEntry.removeLeave')}
                            onClick={() => onRemoveAbsence(capacity.absence_id)}
                        >
                            ✕
                        </button>
                    )}
                </div>
            )}

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
