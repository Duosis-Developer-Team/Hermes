/**
 * =============================================================================
 * HERMES - Toplantilar sol rayi (Hermes Liquid prototipi)
 * =============================================================================
 * Yalniz yuklenmis haftanin toplantilarindan turetilir (yeni uc yok):
 *   - Siradaki toplanti: bugunun henuz bitmemis ilk toplantisi (koyu kart)
 *   - Mini ay takvimi: tiklanan gunun haftasina gider; secili hafta vurgulu
 *   - Bu hafta: toplanti sayisi, toplam saat, efor kaydedilmemis gecmis
 *   - Takvim filtreleri: Teams / yuz yuze / efor kaydedilmis / iptal
 * =============================================================================
 */
import dayjs from 'dayjs'
import { Checkbox } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'

import { GlassCard } from '../liquid'
import { useT } from '../../i18n'
import { MEETING_FILTERS } from './meetingsModel'

function NextMeeting({ meetings }) {
    const t = useT()
    const now = dayjs()
    const next = meetings
        .filter((m) => !m.is_cancelled && m.start_datetime && m.end_datetime
            && dayjs(m.start_datetime).isSame(now, 'day') && dayjs(m.end_datetime).isAfter(now))
        .sort((a, b) => dayjs(a.start_datetime).diff(dayjs(b.start_datetime)))[0]
    if (!next) return null
    const start = dayjs(next.start_datetime)
    const mins = Math.ceil(start.diff(now, 'minute', true))
    const when = mins <= 0
        ? t('shellExtra.liveNow')
        : mins >= 60
            ? t('shellExtra.liveInHours', { h: Math.floor(mins / 60), m: mins % 60 })
            : t('shellExtra.liveIn', { n: mins })
    return (
        <div className="home-next meetings-rail__next">
            <span className="home-next__eyebrow">{t('home.week.next')}{next.join_url ? ' · Microsoft Teams' : ''}</span>
            <b className="home-next__title">{next.subject}</b>
            <div className="home-next__row">
                <span className="home-next__when">{start.format('HH:mm')} · {when}</span>
                <span className="home-block__spacer" />
                {next.join_url && (
                    <a className="home-next__join" href={next.join_url} target="_blank" rel="noreferrer">{t('home.week.join')}</a>
                )}
            </div>
        </div>
    )
}

function MiniMonth({ weekStart, meetings, onPickWeek }) {
    const t = useT()
    const month = dayjs(weekStart).startOf('month')
    const gridStart = month.startOf('isoWeek')
    const days = Array.from({ length: 42 }, (_, i) => gridStart.add(i, 'day'))
    const weeks = []
    for (let i = 0; i < 6; i++) {
        const row = days.slice(i * 7, i * 7 + 7)
        if (i > 3 && !row.some((d) => d.month() === month.month())) break
        weeks.push(row)
    }
    const busy = new Set(meetings.map((m) => dayjs(m.start_datetime).format('YYYY-MM-DD')))
    const selStart = dayjs(weekStart)
    return (
        <GlassCard className="meetings-rail__month">
            <div className="meetings-rail__month-head">
                <b>{month.format('MMMM YYYY')}</b>
                <span>
                    <button type="button" className="meetings-rail__nav" aria-label={t('meetingsPage.prevMonth')}
                        onClick={() => onPickWeek(month.subtract(1, 'month').startOf('month').startOf('isoWeek'))}><LeftOutlined /></button>
                    <button type="button" className="meetings-rail__nav" aria-label={t('meetingsPage.nextMonth')}
                        onClick={() => onPickWeek(month.add(1, 'month').startOf('month').startOf('isoWeek'))}><RightOutlined /></button>
                </span>
            </div>
            <div className="meetings-rail__grid" role="grid">
                {days.slice(0, 7).map((d) => <span key={d.day()} className="meetings-rail__wd">{d.format('dd')}</span>)}
                {weeks.flat().map((d) => {
                    const inWeek = !d.isBefore(selStart, 'day') && d.isBefore(selStart.add(7, 'day'), 'day')
                    const cls = 'meetings-rail__d'
                        + (d.month() !== month.month() ? ' is-out' : '')
                        + (inWeek ? ' is-week' : '')
                        + (d.isSame(dayjs(), 'day') ? ' is-today' : '')
                    return (
                        <button key={d.format('YYYY-MM-DD')} type="button" className={cls}
                            aria-label={d.format('D MMMM YYYY')}
                            onClick={() => onPickWeek(d.startOf('isoWeek'))}>
                            {d.date()}
                            {busy.has(d.format('YYYY-MM-DD')) && <i aria-hidden="true" />}
                        </button>
                    )
                })}
            </div>
        </GlassCard>
    )
}

function WeekStats({ meetings, loggedMeetingIds }) {
    const t = useT()
    const live = meetings.filter((m) => !m.is_cancelled && m.start_datetime && m.end_datetime)
    const hours = live.reduce((a, m) => a + dayjs(m.end_datetime).diff(dayjs(m.start_datetime), 'minute') / 60, 0)
    const unlogged = live.filter((m) => dayjs(m.end_datetime).isBefore(dayjs()) && !loggedMeetingIds?.has(m.id)).length
    return (
        <GlassCard title={t('meetingsPage.thisWeek')} className="meetings-rail__stats">
            <div className="meetings-rail__kpis">
                <div><b>{live.length}</b><span>{t('meetingsPage.meetings')}</span></div>
                <div><b>{hours.toFixed(1).replace(/\.0$/, '')}</b><span>{t('meetingsPage.hours')}</span></div>
                <div className={unlogged ? 'is-warn' : undefined}><b>{unlogged}</b><span>{t('meetingsPage.unlogged')}</span></div>
            </div>
        </GlassCard>
    )
}

function Filters({ filters, onChange }) {
    const t = useT()
    return (
        <GlassCard title={t('meetingsPage.calendars')} className="meetings-rail__filters">
            {MEETING_FILTERS.map((k) => (
                <label key={k} className={`meetings-rail__filter meetings-rail__filter--${k}`}>
                    <Checkbox checked={filters[k]} onChange={(e) => onChange({ ...filters, [k]: e.target.checked })} />
                    <i aria-hidden="true" />
                    {t(`meetingsPage.filter.${k}`)}
                </label>
            ))}
        </GlassCard>
    )
}

export default function MeetingsRail({ weekStart, meetings, loggedMeetingIds, filters, onFiltersChange, onPickWeek }) {
    return (
        <aside className="meetings-rail lq-enter">
            <NextMeeting meetings={meetings} />
            <MiniMonth weekStart={weekStart} meetings={meetings} onPickWeek={onPickWeek} />
            <WeekStats meetings={meetings} loggedMeetingIds={loggedMeetingIds} />
            <Filters filters={filters} onChange={onFiltersChange} />
        </aside>
    )
}
