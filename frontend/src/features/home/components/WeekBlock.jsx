/**
 * =============================================================================
 * HERMES - "Takvimim" blogu (ana sayfa, PM rework P3 / D4)
 * =============================================================================
 * Uc kaynak TEK seritte (04-roller §4.3): toplantilar (Graph senkronu,
 * iptaller haric), planli zaman ve termini o gune dusen islerim. Ayri bir
 * takvim sayfasi degil, AJANDA: gun satirlari (tarih rozeti + kayitlar);
 * bos gunler cizilmez (yalniz bugun bos ise "plan yok" der). Tiklama
 * ilgili kaydi acar:
 *   toplanti → /meetings?date=   plan → /time-entry?week=   is → /work/KEY
 * =============================================================================
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import dayjs from 'dayjs'

import { homeService } from '../../../services/api'
import { queryKeys } from '../../../query/queryKeys'
import { useT } from '../../../i18n'
import { dueTone, weekDaysToShow } from '../model/home'
import { pickNextMeeting } from '../hooks/useNextMeeting'

const hm = (iso) => dayjs(iso).format('HH:mm')

function MeetingRow({ meeting }) {
    const day = dayjs(meeting.start_datetime).format('YYYY-MM-DD')
    return (
        <li className="home-week__entry home-week__entry--meeting" data-entry="meeting">
            <Link to={`/meetings?date=${day}`} className="home-week__entry-link">
                <span className="home-week__time">{`${hm(meeting.start_datetime)}–${hm(meeting.end_datetime)}`}</span>
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

function DayRow({ day, today }) {
    const t = useT()
    const empty = !day.meetings.length && !day.plans.length && !day.items.length
    return (
        <li className={`home-week__day${day.is_today ? ' home-week__day--today' : ''}`} data-date={day.date}>
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

/** Prototip: hafta ici gun cipleri; nokta sayisi = o gunun kayit sayisi.
 *  Tiklamak ajandada o gune kaydirir (ayri filtre DEGIL — liste tam kalir). */
function DayChips({ week }) {
    const days = (week?.days || []).filter((d) => {
        const wd = dayjs(d.date).isoWeekday()
        const n = (d.meetings?.length || 0) + (d.plans?.length || 0) + (d.items?.length || 0)
        return wd <= 5 || n > 0
    })
    if (!days.length) return null
    const jump = (date) => {
        document.querySelector(`.home-week__day[data-date="${date}"]`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
    return (
        <div className="home-week__chips">
            {days.map((d) => {
                const n = (d.meetings?.length || 0) + (d.plans?.length || 0) + (d.items?.length || 0)
                return (
                    <button
                        key={d.date}
                        type="button"
                        className={`home-week__chip${d.is_today ? ' is-today' : ''}`}
                        onClick={() => jump(d.date)}
                        aria-label={dayjs(d.date).format('dddd DD MMMM')}
                    >
                        <span className="home-week__chip-name">{dayjs(d.date).format('ddd')}</span>
                        <span className="home-week__chip-num">{dayjs(d.date).format('D')}</span>
                        <span className="home-week__chip-dots" aria-hidden="true">
                            {Array.from({ length: Math.min(n, 3) }, (_, i) => <i key={i} />)}
                        </span>
                    </button>
                )
            })}
        </div>
    )
}

/** Prototip: bugunun siradaki toplantisi icin koyu mavi one cikan kart. */
function NextMeetingHero({ week }) {
    const t = useT()
    const next = pickNextMeeting(week)
    if (!next) return null
    const when = next.status === 'now'
        ? t('shellExtra.liveNow')
        : next.minutes >= 60
            ? t('shellExtra.liveInHours', { h: Math.floor(next.minutes / 60), m: next.minutes % 60 })
            : t('shellExtra.liveIn', { n: next.minutes })
    return (
        <div className="home-next">
            <span className="home-next__eyebrow">{t('home.week.next')}</span>
            <b className="home-next__title">{next.subject}</b>
            <div className="home-next__row">
                <span className="home-next__when">{when}</span>
                <span className="home-block__spacer" />
                {next.joinUrl ? (
                    <a className="home-next__join" href={next.joinUrl} target="_blank" rel="noreferrer">{t('home.week.join')}</a>
                ) : (
                    <Link className="home-next__join" to={`/meetings?date=${dayjs().format('YYYY-MM-DD')}`}>{t('home.week.openMeetings')}</Link>
                )}
            </div>
        </div>
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
            {data && <DayChips week={data} />}
            {data && <NextMeetingHero week={data} />}
            {data && days.length === 0 && (
                <p className="home-week__none">{t('home.week.nothingWeek')}</p>
            )}
            {days.length > 0 && (
                <ol className="home-week__days">
                    {days.map((day) => <DayRow key={day.date} day={day} today={data.today} />)}
                </ol>
            )}
        </section>
    )
}

export default WeekBlock
