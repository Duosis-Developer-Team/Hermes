/**
 * =============================================================================
 * HERMES - Takvim yerlesimi (PM rework P3.5 / E5)
 * =============================================================================
 * Ayri bir takvim sayfasi DEGIL: secili gorunumun isleri, TERMINE gore
 * hafta izgarasinda. Uzerine kullanicinin toplantilari (ana sayfa
 * takvim verisi) — takvime yazma/davet YOK (05 kapsam disi). Kart
 * tiklamasi detay panelini acar. Terminsiz ve hafta disi isler sayiyla
 * soylenir, kaybolmaz.
 *
 * SUNUM KATMANI: sorgu yok (toplantilar prop olarak gelir).
 * =============================================================================
 */
import { Button } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

import { calendarDays, dueBucketOf, tasksByDay } from '../model/viewGroups'
import { useT } from '../../../i18n'
import './tasksViews.css'

const hm = (iso) => dayjs(iso).format('HH:mm')

function TasksCalendarView({
    tasks = [],
    userMap = {},
    weekStart,
    onPreviousWeek, onNextWeek, onCurrentWeek,
    onOpenPanel,
    /** Ana sayfa /home/week ciktisi (gun → toplantilar); istege bagli. */
    meetings = null,
}) {
    const t = useT()
    const today = dayjs()
    const days = calendarDays(weekStart)
    const { byDay, outside, undated } = tasksByDay(tasks, weekStart, { userMap })
    const meetingsByDay = Object.fromEntries((meetings?.days || []).map((d) => [d.date, d.meetings || []]))

    return (
        <div className="tv-cal" data-testid="tasks-calendar">
            <div className="tv-cal__nav">
                <Button type="text" icon={<LeftOutlined />} onClick={onPreviousWeek} aria-label={t('meetings.previousWeek')} />
                <span className="tv-cal__title">
                    {`${days[0].format('DD MMM')} – ${days[6].format('DD MMM YYYY')}`}
                </span>
                <Button type="text" icon={<RightOutlined />} onClick={onNextWeek} aria-label={t('meetings.nextWeek')} />
                <Button size="small" onClick={onCurrentWeek}>{t('meetings.today')}</Button>
            </div>
            <ol className="tv-cal__grid">
                {days.map((day) => {
                    const key = day.format('YYYY-MM-DD')
                    const isToday = day.isSame(today, 'day')
                    const weekend = day.isoWeekday() >= 6
                    const items = byDay[key] || []
                    const dayMeetings = meetingsByDay[key] || []
                    return (
                        <li
                            key={key}
                            className={`tv-cal__day${isToday ? ' tv-cal__day--today' : ''}${weekend ? ' tv-cal__day--weekend' : ''}`}
                            data-date={key}
                        >
                            <div className="tv-cal__day-head">
                                <span className="tv-cal__day-name">{day.format('ddd')}</span>
                                <span className="tv-cal__day-num">{day.format('DD')}</span>
                            </div>
                            <ul className="tv-cal__list">
                                {dayMeetings.map((m) => (
                                    <li key={m.id}>
                                        <div className="tv-cal__item tv-cal__item--meeting" data-entry="meeting">
                                            <span className="tv-cal__time">{`${hm(m.start_datetime)}–${hm(m.end_datetime)}`}</span>
                                            <span className="tv-cal__label">{m.subject}</span>
                                        </div>
                                    </li>
                                ))}
                                {items.map((item) => {
                                    const task = item.assignments[0]?.task
                                    const completed = item.aggregateStatus === 'completed'
                                    const tone = completed ? 'completed' : dueBucketOf(item.dueDate, today)
                                    return (
                                        <li key={item.key}>
                                            <button
                                                type="button"
                                                className={`tv-cal__item tv-cal__item--${tone}`}
                                                data-entry="item"
                                                data-due-tone={tone}
                                                onClick={() => task && onOpenPanel?.(task)}
                                            >
                                                <span className="tv-cal__key">{task?.task_code}</span>
                                                <span className="tv-cal__label">{item.title}</span>
                                            </button>
                                        </li>
                                    )
                                })}
                            </ul>
                        </li>
                    )
                })}
            </ol>
            {(outside > 0 || undated > 0) && (
                <p className="tv-cal__outside" role="status">
                    {outside > 0 ? `${outside} outside this week` : ''}
                    {outside > 0 && undated > 0 ? ' · ' : ''}
                    {undated > 0 ? `${undated} ${t('views.noDueDate').toLowerCase()}` : ''}
                </p>
            )}
        </div>
    )
}

export default TasksCalendarView
