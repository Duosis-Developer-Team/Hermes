/**
 * =============================================================================
 * HERMES - Weekly List View Component
 * =============================================================================
 * Haftalık takvim görünümü - Jira Tempo List view tarzı.
 * 7 günlük kolonlar, her gün için worklogs.
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
    onDeleteLog
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
    // Haftalık toplam saat
    const weekTotalHours = workLogs.reduce((sum, log) => sum + (parseFloat(log.duration_hours) || 0), 0)
    const weekTargetHours = 40

    return (
        <div className="weekly-list-view">
            {/* Hafta özeti */}
            <div className="weekly-list-summary">
                <span>Hafta: </span>
                <strong>{weekTotalHours}s</strong>
                <span className="weekly-target"> / {weekTargetHours}s</span>
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
                        />
                    )
                })}
            </div>
        </div>
    )
}

export default WeeklyListView
