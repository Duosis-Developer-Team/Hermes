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
import { Ring } from '../../../components/liquid'

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
    const remaining = Math.max(0, expected - logged)
    const daysLeft = days.filter((d) => d.status === 'today' || d.status === 'future').length
    const firstMissing = days.find((d) => d.status === 'missing')

    return (
        <section className="home-block home-effort" aria-labelledby="home-effort-title" data-testid="home-effort">
            <div className="home-block__head">
                <h2 id="home-effort-title" className="home-block__title">{t('home.effort.title')}</h2>
                <span className="home-block__meta">
                    {t('home.effort.logged', { logged: formatHours(logged), expected: formatHours(expected) })}
                </span>
                <span className="home-block__spacer" />
                <Link to="/time-entry" className="home-block__link">{t('home.effort.open')}</Link>
            </div>

            <div className="home-effort__body">
                {/* Halka: haftalik dolum, acilista cizilerek dolar. */}
                <div
                    className="home-effort__ring"
                    role="progressbar"
                    aria-label={t('home.effort.title')}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={width}
                >
                    <Ring value={width} size={140} stroke={12}>
                        <div className="home-effort__ring-inner">
                            <span className="home-effort__big">{formatHours(logged)}</span>
                            <span className="home-effort__of">{t('home.effort.ofExpected', { expected: formatHours(expected) })}</span>
                        </div>
                    </Ring>
                </div>

                <ol className="home-effort__days">
                    {days.map((day, i) => (
                        <li
                            key={day.date}
                            className={`home-effort__day home-effort__day--${day.status}`}
                            data-day-status={day.status}
                            style={{ animationDelay: `${i * 60}ms` }}
                        >
                            <Link
                                to={`/time-entry?date=${day.date}`}
                                className="home-effort__day-link"
                                aria-label={`${dayjs(day.date).format('dddd DD MMM')}: ${dayHours(t, day)}`}
                                title={day.holidayName || undefined}
                            >
                                <span className="home-effort__meter" aria-hidden="true">
                                    <i style={{ height: `${day.expected > 0 ? Math.min(100, Math.round((day.logged / day.expected) * 100)) : 0}%` }} />
                                </span>
                                <span className="home-effort__day-hours">{dayHours(t, day)}</span>
                                <span className="home-effort__day-name">{dayjs(day.date).format('ddd')}</span>
                                {day.status === 'missing' && (
                                    <span className="home-effort__dot" aria-hidden="true" />
                                )}
                            </Link>
                        </li>
                    ))}
                </ol>

                <dl className="home-effort__stats">
                    {fillPercent !== null && fillPercent !== undefined && (
                        <div>
                            <dt className="home-effort__stat">{fillPercent}%</dt>
                            <dd>{t('home.effort.fillLabel')}</dd>
                        </div>
                    )}
                    <div>
                        <dt className="home-effort__stat">{formatHours(remaining)}h</dt>
                        <dd>{t('home.effort.remaining', { count: daysLeft })}</dd>
                    </div>
                </dl>
            </div>

            {missingCount >= 2 && (
                <div className="home-effort__missing">
                    <span className="home-effort__dot" aria-hidden="true" />
                    <span role="status">{t('home.effort.missingDays', { count: missingCount })}</span>
                    <span className="home-block__spacer" />
                    {firstMissing && (
                        <Link to={`/time-entry?date=${firstMissing.date}`} className="home-effort__missing-cta">
                            + {t('home.quickLog')}
                        </Link>
                    )}
                </div>
            )}
        </section>
    )
}

export default EffortStrip
