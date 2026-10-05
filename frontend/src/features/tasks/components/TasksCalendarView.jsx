/**
 * =============================================================================
 * HERMES - Takvim yerlesimi (PM rework P3.5 / E5)
 * =============================================================================
 * Ayri bir takvim sayfasi DEGIL: secili gorunumun isleri, TERMINE gore
 * hafta izgarasinda. Burasi IS alanidir: toplanti GOSTERILMEZ (toplantilar
 * /meetings'te). Kart tiklamasi detay panelini acar. Terminsiz isler
 * izgaranin altinda kart olarak durur; hafta disi isler sayiyla soylenir.
 *
 * SUNUM KATMANI: sorgu yok.
 * =============================================================================
 */
import { Button } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

import { calendarDays, dueBucketOf, tasksByDay } from '../model/viewGroups'
import { useT } from '../../../i18n'
import './tasksViews.css'
import { BrandLogos } from '../../../components/liquid'

function TasksCalendarView({
    tasks = [],
    userMap = {},
    weekStart,
    onPreviousWeek, onNextWeek, onCurrentWeek,
    onOpenPanel,
}) {
    const t = useT()
    const today = dayjs()
    const days = calendarDays(weekStart)
    const { byDay, outside, undatedItems } = tasksByDay(tasks, weekStart, { userMap })

    const renderItem = (item) => {
        const task = item.assignments[0]?.task
        const completed = item.aggregateStatus === 'completed'
        const tone = completed ? 'completed' : (item.dueDate ? dueBucketOf(item.dueDate, today) : 'none')
        return (
            <li key={item.key}>
                <button
                    type="button"
                    className={`tv-cal__item tv-cal__item--${tone}`}
                    data-entry="item"
                    data-due-tone={tone}
                    onClick={() => task && onOpenPanel?.(task)}
                >
                    {task && (
                        <BrandLogos
                            customerId={task.customer_id}
                            customerName={task.customer_name}
                            projectId={task.project_id}
                            projectName={task.project_name}
                            size={20}
                            className="tv-cal__logo"
                        />
                    )}
                    <span className="tv-cal__key">{task?.task_code}</span>
                    <span className="tv-cal__label">{item.title}</span>
                </button>
            </li>
        )
    }

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
                                {items.map(renderItem)}
                            </ul>
                        </li>
                    )
                })}
            </ol>
            {undatedItems.length > 0 && (
                <section className="tv-cal__undated" data-testid="tasks-calendar-undated">
                    <h4 className="tv-cal__undated-title">
                        {t('views.noDueDate')} <span>{undatedItems.length}</span>
                    </h4>
                    <ul className="tv-cal__list tv-cal__undated-list">
                        {undatedItems.map(renderItem)}
                    </ul>
                </section>
            )}
            {outside > 0 && (
                <p className="tv-cal__outside" role="status">
                    {t('views.outsideWeek', { count: outside })}
                </p>
            )}
        </div>
    )
}

export default TasksCalendarView
