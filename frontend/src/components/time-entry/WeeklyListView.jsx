/**
 * =============================================================================
 * HERMES - Weekly List View Component
 * =============================================================================
 * Haftalık takvim görünümü - Jira Tempo List view tarzı.
 * 7 günlük kolonlar, her gün için worklogs.
 * Copy-paste (Ctrl+C / Ctrl+V) desteği ile log klonlama.
 * =============================================================================
 */

import { useMemo } from 'react'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import DayColumn from './DayColumn'
import './WeeklyListView.css'

dayjs.extend(isoWeek)

function WeeklyListView({
    weekStart,
    workLogs = [],
    onLogTime,
    onPlanTime,
    onEditLog,
    onDeleteLog,
    // Copy-paste props
    selectedLogId,
    copiedLog,
    targetDate,
    onSelectLog,
    onSelectDay,
    onClearClipboard
}) {
    // Haftanın 7 gününü hesapla
    const weekDays = useMemo(() => {
        const days = []
        for (let i = 0; i < 7; i++) {
            days.push(dayjs(weekStart).add(i, 'day'))
        }
        return days
    }, [weekStart])

    // Worklogs'u günlere göre grupla
    const logsByDate = useMemo(() => {
        const grouped = {}
        weekDays.forEach(day => {
            const dateKey = day.format('YYYY-MM-DD')
            grouped[dateKey] = workLogs.filter(
                log => log.date_worked === dateKey
            )
        })
        return grouped
    }, [weekDays, workLogs])

    // Bugünün tarihi
    const today = dayjs().format('YYYY-MM-DD')

    // Haftalık toplam saat
    const weekTotalHours = workLogs.reduce((sum, log) => sum + (parseFloat(log.duration_hours) || 0), 0)
    const weekTargetHours = 40

    // 0.75 → "45m", 2.75 → "2h 45m", 2.0 → "2h"
    const formatDuration = (decimal) => {
        if (!decimal) return '0h'
        const h = Math.floor(decimal)
        const m = Math.round((decimal - h) * 60)
        if (m > 0) return `${h}h ${m}m`
        return `${h}h`
    }

    return (
        <div className="weekly-list-view">
            {/* Clipboard Banner — görünür olduğunda kullanıcıyı bilgilendirir */}
            {copiedLog && (
                <div className="weekly-clipboard-banner">
                    <span className="clipboard-banner-icon">📋</span>
                    <span className="clipboard-banner-text">
                            <strong>{copiedLog.project_name || 'Log'}</strong> copied
                        — click a target day, then press <kbd>Ctrl+V</kbd> to paste
                    </span>
                    <button
                        className="clipboard-close-btn"
                        onClick={onClearClipboard}
                        title="Clear (Esc)"
                    >
                        ✕
                    </button>
                </div>
            )}

            {/* Hafta özeti */}
            <div className="weekly-list-summary">
                <span>Week: </span>
                <strong>{formatDuration(weekTotalHours)}</strong>
                <span className="weekly-target"> / {weekTargetHours}h</span>
            </div>

            {/* Günlük kolonlar */}
            <div className="weekly-list-columns">
                {weekDays.map(day => {
                    const dateKey = day.format('YYYY-MM-DD')
                    return (
                        <DayColumn
                            key={dateKey}
                            date={day}
                            workLogs={logsByDate[dateKey] || []}
                            onLogTime={onLogTime}
                            onPlanTime={onPlanTime}
                            onEditLog={onEditLog}
                            onDeleteLog={onDeleteLog}
                            isToday={dateKey === today}
                            selectedLogId={selectedLogId}
                            isTargeted={dateKey === targetDate}
                            hasCopiedLog={!!copiedLog}
                            onSelectLog={onSelectLog}
                            onSelectDay={onSelectDay}
                        />
                    )
                })}
            </div>
        </div>
    )
}

export default WeeklyListView
