/**
 * =============================================================================
 * HERMES - Efor durumu seridi (ana sayfa, PM rework P3 / D2 verisi)
 * =============================================================================
 * Time Entry'deki kapasite verisinin ana sayfadaki ozeti (04-roller §4.1):
 * haftalik dolum cubugu + gun kutulari. Eksik gun sari NOKTA ve
 * tiklanabilir (o gune giris acar); haftada >=2 bos gun tek sari satir.
 * Modal/toast yok; bugun ve gelecek asla eksik degildir (sunucu kurali).
 * =============================================================================
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import dayjs from 'dayjs'

import { capacityService } from '../../../services/api'
import { queryKeys } from '../../../query/queryKeys'
import { useT } from '../../../i18n'
import { effortSummary, formatHours, mondayOf } from '../model/home'

function dayHours(t, day) {
    if (day.off) return day.absent ? t('home.effort.leave') : t('home.effort.off')
    return `${formatHours(day.logged)}h`
}

function EffortStrip() {
    const t = useT()
    const start = mondayOf()
    const { data, isLoading } = useQuery({
        queryKey: queryKeys.capacity.week({ start }),
        queryFn: () => capacityService.getWeek({ start }),
    })
    const summary = effortSummary(data)

    if (!summary) {
        return <section className="home-block home-effort" aria-busy={isLoading} data-testid="home-effort" />
    }

    const { expected, logged, fillPercent, missingCount, days } = summary
    const width = Math.max(0, Math.min(100, fillPercent ?? 0))

    return (
        <section className="home-block home-effort" aria-labelledby="home-effort-title" data-testid="home-effort">
            <div className="home-block__head">
                <h2 id="home-effort-title" className="home-block__title">{t('home.effort.title')}</h2>
                <span className="home-block__meta">
                    {t('home.effort.logged', { logged: formatHours(logged), expected: formatHours(expected) })}
                </span>
                {fillPercent !== null && fillPercent !== undefined && (
                    <span className="home-effort__fill">{fillPercent}%</span>
                )}
                <span className="home-block__spacer" />
                <Link to="/time-entry" className="home-block__link">{t('home.effort.open')}</Link>
            </div>

            <div
                className="home-effort__bar"
                role="progressbar"
                aria-label={t('home.effort.title')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={width}
            >
                <span className="home-effort__bar-fill" style={{ width: `${width}%` }} />
            </div>

            <ol className="home-effort__days">
                {days.map((day) => (
                    <li
                        key={day.date}
                        className={`home-effort__day home-effort__day--${day.status}`}
                        data-day-status={day.status}
                    >
                        <Link
                            to={`/time-entry?date=${day.date}`}
                            className="home-effort__day-link"
                            aria-label={`${dayjs(day.date).format('dddd DD MMM')}: ${dayHours(t, day)}`}
                            title={day.holidayName || undefined}
                        >
                            <span className="home-effort__day-name">{dayjs(day.date).format('ddd')}</span>
                            <span className="home-effort__day-hours">{dayHours(t, day)}</span>
                            {day.status === 'missing' && (
                                <span className="home-effort__dot" aria-hidden="true" />
                            )}
                        </Link>
                    </li>
                ))}
            </ol>

            {missingCount >= 2 && (
                <div className="home-effort__missing" role="status">
                    <span className="home-effort__dot" aria-hidden="true" />
                    {t('home.effort.missingDays', { count: missingCount })}
                </div>
            )}
        </section>
    )
}

export default EffortStrip
