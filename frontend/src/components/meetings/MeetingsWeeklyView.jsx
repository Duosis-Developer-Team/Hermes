/**
 * =============================================================================
 * HERMES - Toplanti takvimi (Hermes Liquid prototipi)
 * =============================================================================
 * Saat izgarali takvim: toplantilar baslangic/bitis saatine gore KONUMLANIR
 * (eski "gun basina kart yigini" yerine). Uc gorunum:
 *   workweek is haftasi — hafta ici 5 gun (Outlook "Work week")
 *   week     tam hafta — hafta sonu dahil 7 gun
 *   day    tek gun (focusDate)
 *   agenda gun gun liste
 * Cakisan toplantilar yan yana seritlere bolunur. Bugun basliginda ortak
 * `.h-today-flag` + "simdi" cizgisi. Tum gun toplantilari ustte ayri serit.
 * Tiklama → onSelectMeeting (inceleme modali — davranis ayni).
 * =============================================================================
 */

import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { CalendarOutlined, CheckCircleFilled, LockOutlined } from '@ant-design/icons'

import './MeetingsWeeklyView.css'
import { layoutLanes } from './meetingsModel'
import { useT } from '../../i18n'

const HOUR_PX = 56
const minutesOf = (d) => d.hour() * 60 + d.minute()
const isPrivate = (m) => m.sensitivity === 'private' || m.sensitivity === 'confidential'

function MeetingEvent({ meeting, logged, style, onSelect }) {
    const t = useT()
    const start = dayjs(meeting.start_datetime)
    const end = dayjs(meeting.end_datetime)
    const cls = 'meeting-event'
        + (meeting.is_cancelled ? ' is-cancelled' : '')
        + (logged ? ' is-logged' : '')
        + (isPrivate(meeting) ? ' is-private' : '')
        + (!meeting.join_url ? ' is-offline' : '')
    return (
        <button
            type="button"
            className={cls}
            style={style}
            onClick={(e) => { e.stopPropagation(); onSelect?.(meeting) }}
            aria-label={`${meeting.subject || t('meetingsPage.untitled')}, ${start.format('HH:mm')}–${end.format('HH:mm')}`
                + (logged ? `, ${t('meetingCard.logged')}` : '')
                + (meeting.is_cancelled ? `, ${t('meetingCard.cancelled')}` : '')}
        >
            <span className="meeting-event__title">
                {isPrivate(meeting) ? <LockOutlined aria-hidden="true" /> : <CalendarOutlined aria-hidden="true" />}
                <span>{meeting.subject || t('meetingsPage.untitled')}</span>
                {logged && <CheckCircleFilled className="meeting-event__logged" aria-hidden="true" />}
            </span>
            <span className="meeting-event__time">{start.format('HH:mm')}–{end.format('HH:mm')}</span>
        </button>
    )
}

function NowLine({ startHour, endHour }) {
    const [now, setNow] = useState(() => dayjs())
    useEffect(() => {
        const id = setInterval(() => setNow(dayjs()), 60 * 1000)
        return () => clearInterval(id)
    }, [])
    const top = ((minutesOf(now) - startHour * 60) / 60) * HOUR_PX
    if (top < 0 || minutesOf(now) >= endHour * 60) return null
    return (
        <div className="meetings-now" style={{ top }} aria-hidden="true">
            <span className="meetings-now__label">{now.format('HH:mm')}</span>
        </div>
    )
}

function Agenda({ days, byDay, loggedMeetingIds, onSelectMeeting }) {
    const t = useT()
    return (
        <div className="meetings-agenda">
            {days.map((d) => {
                const list = byDay[d.format('YYYY-MM-DD')] || []
                if (!list.length) return null
                const today = d.isSame(dayjs(), 'day')
                return (
                    <section key={d.format('YYYY-MM-DD')} className="meetings-agenda__day">
                        <h4 className={today ? 'h-today-flag' : undefined}>
                            {d.format('dddd, D MMMM')}
                            {today && <span className="h-today-label">{t('meetings.today')}</span>}
                        </h4>
                        {list.map((m) => (
                            <MeetingEvent
                                key={m.id}
                                meeting={m}
                                logged={loggedMeetingIds?.has(m.id)}
                                onSelect={onSelectMeeting}
                            />
                        ))}
                    </section>
                )
            })}
        </div>
    )
}

function MeetingsWeeklyView({
    weekStart,
    meetings = [],
    loggedMeetingIds,
    onSelectMeeting,
    mode = 'workweek',
    focusDate,
}) {
    const t = useT()

    const byDay = useMemo(() => {
        const g = {}
        for (const m of meetings) {
            if (!m.start_datetime) continue
            const k = dayjs(m.start_datetime).format('YYYY-MM-DD')
            ;(g[k] ||= []).push(m)
        }
        for (const k of Object.keys(g)) g[k].sort((a, b) => dayjs(a.start_datetime).diff(dayjs(b.start_datetime)))
        return g
    }, [meetings])

    const days = useMemo(() => {
        const all = Array.from({ length: 7 }, (_, i) => dayjs(weekStart).add(i, 'day'))
        if (mode === 'day') {
            const f = dayjs(focusDate || weekStart)
            return [all.find((d) => d.isSame(f, 'day')) || all[0]]
        }
        // Hafta sonu yalniz kullanici isterse (Outlook gibi): is haftasi 5 gun.
        return mode === 'workweek' ? all.slice(0, 5) : all
    }, [weekStart, mode, focusDate])

    if (mode === 'agenda') {
        return <Agenda days={days} byDay={byDay} loggedMeetingIds={loggedMeetingIds} onSelectMeeting={onSelectMeeting} />
    }

    // Saat araligi: 08–18 varsayilan, toplantilar tasiyorsa genisler.
    let startHour = 8
    let endHour = 18
    for (const d of days) {
        for (const m of byDay[d.format('YYYY-MM-DD')] || []) {
            if (m.is_all_day) continue
            startHour = Math.min(startHour, dayjs(m.start_datetime).hour())
            endHour = Math.max(endHour, Math.ceil(minutesOf(dayjs(m.end_datetime)) / 60))
        }
    }
    endHour = Math.min(24, Math.max(endHour, startHour + 1))
    const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i)
    const cols = `56px repeat(${days.length}, minmax(0, 1fr))`

    return (
        <div className="meetings-grid" style={{ '--hour-px': `${HOUR_PX}px` }}>
            <div className="meetings-grid__head" style={{ gridTemplateColumns: cols }}>
                <span />
                {days.map((d) => {
                    const key = d.format('YYYY-MM-DD')
                    const today = d.isSame(dayjs(), 'day')
                    const n = (byDay[key] || []).length
                    return (
                        <div key={key} className={`meetings-grid__day${today ? ' is-today' : ''}`} aria-current={today ? 'date' : undefined}>
                            <span className={`meetings-grid__dname${today ? ' h-today-flag' : ''}`}>{d.format('ddd')}</span>
                            <span className="meetings-grid__dnum">{d.format('D')}</span>
                            <span className="meetings-grid__dcount">{t('meetingsPage.count', { count: n })}</span>
                        </div>
                    )
                })}
            </div>

            {days.some((d) => (byDay[d.format('YYYY-MM-DD')] || []).some((m) => m.is_all_day)) && (
                <div className="meetings-grid__allday" style={{ gridTemplateColumns: cols }}>
                    <span className="meetings-grid__hour">{t('home.week.allDay')}</span>
                    {days.map((d) => (
                        <div key={d.format('YYYY-MM-DD')}>
                            {(byDay[d.format('YYYY-MM-DD')] || []).filter((m) => m.is_all_day).map((m) => (
                                <MeetingEvent key={m.id} meeting={m} logged={loggedMeetingIds?.has(m.id)} onSelect={onSelectMeeting} />
                            ))}
                        </div>
                    ))}
                </div>
            )}

            <div className="meetings-grid__body" style={{ gridTemplateColumns: cols, height: hours.length * HOUR_PX }}>
                <div className="meetings-grid__hours">
                    {hours.map((h) => (
                        <span key={h} className="meetings-grid__hour" style={{ top: (h - startHour) * HOUR_PX }}>
                            {String(h).padStart(2, '0')}:00
                        </span>
                    ))}
                </div>
                {days.map((d) => {
                    const key = d.format('YYYY-MM-DD')
                    const today = d.isSame(dayjs(), 'day')
                    const items = (byDay[key] || [])
                        .filter((m) => !m.is_all_day && m.end_datetime)
                        .map((m) => ({ m, start: minutesOf(dayjs(m.start_datetime)), end: minutesOf(dayjs(m.end_datetime)) || 24 * 60 }))
                    return (
                        <div key={key} className={`meetings-grid__col${today ? ' is-today' : ''}`}>
                            {hours.map((h) => <i key={h} className="meetings-grid__line" style={{ top: (h - startHour) * HOUR_PX }} />)}
                            {layoutLanes(items).map(({ m, start, end, lane, lanes }, i) => (
                                <MeetingEvent
                                    key={m.id}
                                    meeting={m}
                                    logged={loggedMeetingIds?.has(m.id)}
                                    onSelect={onSelectMeeting}
                                    style={{
                                        top: ((start - startHour * 60) / 60) * HOUR_PX + 2,
                                        height: Math.max(26, ((end - start) / 60) * HOUR_PX - 4),
                                        left: `calc(${(lane / lanes) * 100}% + 4px)`,
                                        width: `calc(${100 / lanes}% - 8px)`,
                                        animationDelay: `${i * 40}ms`,
                                    }}
                                />
                            ))}
                            {today && <NowLine startHour={startHour} endHour={endHour} />}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

export default MeetingsWeeklyView
