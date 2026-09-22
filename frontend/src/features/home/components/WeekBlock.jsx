/**
 * =============================================================================
 * HERMES - "Takvimim" blogu (ana sayfa, PM rework P3 / D4)
 * =============================================================================
 * Uc kaynak TEK seritte (04-roller §4.3): toplantilar (Graph senkronu,
 * iptaller haric), planli zaman ve termini o gune dusen islerim. Ayri bir
 * takvim sayfasi degil, gun seridi; tiklama ilgili kaydi acar:
 *   toplanti → /meetings?date=   plan → /time-entry?week=   is → /work/KEY
 * Hafta sonu gunleri yalnizca icerigi varsa gorunur; bos gun sessizdir.
 * =============================================================================
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import dayjs from 'dayjs'

import { homeService } from '../../../services/api'
import { queryKeys } from '../../../query/queryKeys'
import { useT } from '../../../i18n'
import { dueTone, weekDaysToShow } from '../model/home'

const hm = (iso) => dayjs(iso).format('HH:mm')

function MeetingRow({ meeting }) {
    const day = dayjs(meeting.start_datetime).format('YYYY-MM-DD')
    return (
        <li className="home-week__entry home-week__entry--meeting" data-entry="meeting">
            <Link to={`/meetings?date=${day}`} className="home-week__entry-link">
                <span className="home-week__time">{hm(meeting.start_datetime)}–{hm(meeting.end_datetime)}</span>
                <span className="home-week__label">{meeting.subject}</span>
            </Link>
        </li>
    )
}

function PlanRow({ plan, date }) {
    const t = useT()
    const time = plan.start_time && plan.end_time ? `${plan.start_time}–${plan.end_time}` : t('home.week.allDay')
    const label = [plan.customer_name, plan.project_name].filter(Boolean).join(' · ') || plan.description || t('home.week.plan')
    return (
        <li className={`home-week__entry home-week__entry--plan home-week__entry--${plan.status}`} data-entry="plan">
            <Link to={`/time-entry?week=${date}`} className="home-week__entry-link">
                <span className="home-week__time">{time}</span>
                <span className="home-week__label">{label}</span>
            </Link>
        </li>
    )
}

function ItemRow({ item, today }) {
    const t = useT()
    const tone = dueTone(item.due_date, today)
    return (
        <li className={`home-week__entry home-week__entry--item home-item--${tone}`} data-entry="item" data-due-tone={tone}>
            <Link to={`/work/${item.item_key}`} className="home-week__entry-link">
                <span className="home-week__time">{t('home.week.due')}</span>
                <span className="home-week__label">
                    <span className="home-item__key">{item.item_key}</span> {item.title}
                </span>
            </Link>
        </li>
    )
}

function DayColumn({ day, today }) {
    const t = useT()
    const empty = !day.meetings.length && !day.plans.length && !day.items.length
    return (
        <li className={`home-week__day ${day.is_today ? 'home-week__day--today' : ''}`} data-date={day.date}>
            <div className="home-week__day-head">
                <span className="home-week__day-name">{dayjs(day.date).format('ddd')}</span>
                <span className="home-week__day-num">{dayjs(day.date).format('DD')}</span>
            </div>
            {empty ? (
                <p className="home-week__empty">{t('home.week.nothing')}</p>
            ) : (
                <ul className="home-week__entries">
                    {day.meetings.map((m) => <MeetingRow key={m.id} meeting={m} />)}
                    {day.plans.map((p) => <PlanRow key={p.assignment_id} plan={p} date={day.date} />)}
                    {day.items.map((i) => <ItemRow key={i.id} item={i} today={today} />)}
                </ul>
            )}
        </li>
    )
}

function WeekBlock() {
    const t = useT()
    const { data, isLoading, isError } = useQuery({
        queryKey: queryKeys.home.week({}),
        queryFn: () => homeService.week(),
    })
    const days = weekDaysToShow(data)

    return (
        <section className="home-block home-week" aria-labelledby="home-week-title" aria-busy={isLoading} data-testid="home-week">
            <div className="home-block__head">
                <h2 id="home-week-title" className="home-block__title">{t('home.week.title')}</h2>
                {data && (
                    <span className="home-block__meta">
                        {`${dayjs(data.week_start).format('DD MMM')} – ${dayjs(data.week_end).format('DD MMM')}`}
                    </span>
                )}
                <span className="home-block__spacer" />
                <Link to="/meetings" className="home-block__link">{t('home.week.openMeetings')}</Link>
            </div>
            {isError && <div className="h-inline-error">{t('home.loadFailed')}</div>}
            {days.length > 0 && (
                <ol className="home-week__days">
                    {days.map((day) => <DayColumn key={day.date} day={day} today={data.today} />)}
                </ol>
            )}
        </section>
    )
}

export default WeekBlock
