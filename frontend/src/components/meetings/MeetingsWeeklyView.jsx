/**
 * =============================================================================
 * HERMES - Meetings Weekly View
 * =============================================================================
 * 7-day grid keyed by each meeting's start_datetime date. Mirrors the
 * Tasks weekly view layout so the two calendars feel like siblings —
 * same column structure, same dark theme, same scrolling behavior.
 *
 * Meetings can run dense, so each day column scrolls internally; the
 * page itself never overflows.
 * =============================================================================
 */

import { useMemo } from 'react'
import dayjs from 'dayjs'

import MeetingCard from './MeetingCard'
import './MeetingsWeeklyView.css'

function MeetingsWeeklyView({
    weekStart,
    meetings = [],
    loggedMeetingIds,
    onSelectMeeting,
}) {
    const weekDays = useMemo(() => {
        const days = []
        for (let i = 0; i < 7; i++) days.push(dayjs(weekStart).add(i, 'day'))
        return days
    }, [weekStart])

    const meetingsByDate = useMemo(() => {
        const grouped = {}
        for (const d of weekDays) grouped[d.format('YYYY-MM-DD')] = []
        for (const m of meetings) {
            if (!m.start_datetime) continue
            const dayKey = dayjs(m.start_datetime).format('YYYY-MM-DD')
            if (dayKey in grouped) grouped[dayKey].push(m)
        }
        // Keep each day's column sorted ascending by start time.
        for (const key of Object.keys(grouped)) {
            grouped[key].sort((a, b) =>
                (a.start_datetime || '').localeCompare(b.start_datetime || '')
            )
        }
        return grouped
    }, [meetings, weekDays])

    const today = dayjs().format('YYYY-MM-DD')

    return (
        <div className="meetings-weekly-view">
            <div className="meetings-weekly-summary">
                <span>Week:</span>
                <strong>
                    {meetings.length} meeting{meetings.length === 1 ? '' : 's'}
                </strong>
            </div>

            <div className="meetings-weekly-columns">
                {weekDays.map((day) => {
                    const key = day.format('YYYY-MM-DD')
                    const list = meetingsByDate[key] || []
                    const dow = day.day()
                    const isToday = key === today
                    const isWeekend = dow === 0 || dow === 6
                    const className =
                        'meeting-day-column' +
                        (isWeekend ? ' meeting-day-column-weekend' : '') +
                        (isToday ? ' meeting-day-column-today' : '')
                    return (
                        <div key={key} className={className}>
                            <div className="meeting-day-column-header">
                                <span className="meeting-day-name">
                                    {day.format('ddd')}
                                </span>
                                <span className="meeting-day-number">
                                    {day.format('DD')}
                                </span>
                                <span className="meeting-day-count">
                                    {list.length}
                                </span>
                            </div>
                            <div className="meeting-day-column-body">
                                {list.length === 0 ? (
                                    <div className="meeting-day-column-empty">
                                        No meetings
                                    </div>
                                ) : (
                                    list.map((m) => (
                                        <MeetingCard
                                            key={m.id}
                                            meeting={m}
                                            isLogged={
                                                loggedMeetingIds?.has?.(m.id) ||
                                                false
                                            }
                                            onClick={onSelectMeeting}
                                        />
                                    ))
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

export default MeetingsWeeklyView
