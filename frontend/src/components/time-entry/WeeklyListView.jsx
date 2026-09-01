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
import { useT } from '../../i18n'

dayjs.extend(isoWeek)

function WeeklyListView({
    weekStart,
    workLogs = [],
    planTimes = [],
    onLogTime,
    onPlanTime,
    onEditLog,
    onDeleteLog,
    onPlanTimeRespond,
    onDeletePlanTime,
    onEditPlanTime,
    isAdmin = false,
    // Copy-paste props
    selectedLogId,
    copiedLogId,
    copiedLog,
    targetDate,
    onSelectLog,
    onSelectDay,
    onClearClipboard
}) {
    const t = useT()
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

    // Plan times'ı günlere göre grupla — recurrence mantığıyla
    const planTimesByDate = useMemo(() => {
        const grouped = {}
        weekDays.forEach(day => {
            const dateKey = day.format('YYYY-MM-DD')
            grouped[dateKey] = planTimes.filter(pt => {
                if (dateKey < pt.start_date) return false

                if (pt.recurrence === 'weekly') {
                    // Haftanın aynı günü (start_date ile aynı gün)
                    return dayjs(dateKey).day() === dayjs(pt.start_date).day()
                }
                if (pt.recurrence === 'monthly') {
                    // 28 günde bir (4 haftada bir) aynı hafta içi gün
                    const diffDays = dayjs(dateKey).diff(dayjs(pt.start_date), 'day')
                    return diffDays >= 0 && diffDays % 28 === 0
                }
                // one_time / daily (legacy): start_date ile end_date arasındaki tüm günler
                return dateKey <= pt.end_date
            })
        })
        return grouped
    }, [weekDays, planTimes])

    // Bugünün tarihi
    const today = dayjs().format('YYYY-MM-DD')

    /* Sprint 8: haftalik toplam/hedef/formatDuration burada HESAPLANMIYOR
       artik — ozet bandi kaldirildi, ayni bilgi WeekNavigator'da. */

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
                        title={t('timesheet.clearEsc')}
                    >
                        ✕
                    </button>
                </div>
            )}

            {/*
             * Sprint 8: buradaki ikinci "Week: Xh / 40h" bandi KALDIRILDI.
             * Ayni bilgi hemen ustteki WeekNavigator'da zaten var; iki
             * ust uste gri bant ekran goruntusundeki "kutu yigini"
             * gorunumunun ana nedenlerindendi. Bilgi kaybi yok.
             */}
            {/* Günlük kolonlar */}
            <div className="weekly-list-columns">
                {weekDays.map(day => {
                    const dateKey = day.format('YYYY-MM-DD')
                    return (
                        <DayColumn
                            key={dateKey}
                            date={day}
                            workLogs={logsByDate[dateKey] || []}
                            planTimes={planTimesByDate[dateKey] || []}
                            onLogTime={onLogTime}
                            onPlanTime={isAdmin ? onPlanTime : undefined}
                            onEditLog={onEditLog}
                            onDeleteLog={onDeleteLog}
                            onPlanTimeRespond={onPlanTimeRespond}
                            onDeletePlanTime={onDeletePlanTime}
                            onEditPlanTime={onEditPlanTime}
                            isToday={dateKey === today}
                            isAdmin={isAdmin}
                            selectedLogId={selectedLogId}
                    copiedLogId={copiedLogId}
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
