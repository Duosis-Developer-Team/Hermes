/**
 * =============================================================================
 * HERMES - "Organizasyon ozeti" blogu (PM rework P3 / D6)
 * =============================================================================
 * Dashboard'in yerine degil ONUNE gecer (04-roller §6): donem KPI'lari
 * (toplam efor, faturalanabilir oran, musteri kirilimi) + uc anomali
 * sinyali (bu hafta giris yapmamis kisi, gecikmis is + bu hafta artisi,
 * sahipsiz birikme). Esik SUNUCUDA; istemci yalniz `level`i boyar —
 * esik asilinca sinyal one cikar, digerleri notr kalir. Kisayollar:
 * raporlar, faturalanabilir saatler, sozlesme durumu, detay dashboard.
 * =============================================================================
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import dayjs from 'dayjs'

import { homeService } from '../../../services/api'
import { queryKeys } from '../../../query/queryKeys'
import { useT } from '../../../i18n'
import { formatHours } from '../model/home'

const SIGNAL_LABEL = {
    no_entry_users: 'home.org.noEntryUsers',
    overdue: 'home.org.overdue',
    unassigned: 'home.org.unassigned',
}

function Signal({ signal }) {
    const t = useT()
    const warn = signal.level === 'warn'
    return (
        <li className={`home-org__signal ${warn ? 'home-org__signal--warn' : ''}`} data-signal={signal.key} data-level={signal.level}>
            <span className="home-org__signal-value">{signal.value}</span>
            <span className="home-org__signal-label">
                {t(SIGNAL_LABEL[signal.key] || signal.key)}
                {signal.key === 'overdue' && signal.delta > 0 ? (
                    <span className="home-org__signal-delta"> {t('home.org.newThisWeek', { count: signal.delta })}</span>
                ) : null}
            </span>
        </li>
    )
}

function OrgBlock() {
    const t = useT()
    const { data, isLoading, isError } = useQuery({
        queryKey: queryKeys.home.org({}),
        queryFn: () => homeService.org(),
    })

    return (
        <section className="home-block home-org" aria-labelledby="home-org-title" aria-busy={isLoading} data-testid="home-org">
            <div className="home-block__head">
                <h2 id="home-org-title" className="home-block__title">{t('home.org.title')}</h2>
                {data && (
                    <span className="home-block__meta">
                        {`${dayjs(data.period_start).format('DD MMM')} – ${dayjs(data.period_end).format('DD MMM')}`}
                    </span>
                )}
                <span className="home-block__spacer" />
                <Link to="/dashboard" className="home-block__link">{t('home.org.openDashboard')}</Link>
            </div>
            {isError && <div className="h-inline-error">{t('home.loadFailed')}</div>}
            {data && (
                <>
                    <div className="h-metric-strip home-org__metrics">
                        <div className="h-metric-strip__item">
                            <span className="h-metric-strip__accent" />
                            <div className="h-metric-strip__value">{formatHours(data.total_hours)}h</div>
                            <div className="h-metric-strip__label">{t('home.org.totalHours')}</div>
                        </div>
                        <div className="h-metric-strip__item">
                            <div className="h-metric-strip__value">
                                {data.billable_ratio === null || data.billable_ratio === undefined ? '—' : `${data.billable_ratio}%`}
                            </div>
                            <div className="h-metric-strip__label">{t('home.org.billableRatio')}</div>
                        </div>
                        <div className="h-metric-strip__item">
                            <div className="h-metric-strip__value">{formatHours(data.billable_hours)}h</div>
                            <div className="h-metric-strip__label">{t('home.org.billableHours')}</div>
                        </div>
                    </div>

                    <div className="home-org__columns">
                        <div className="home-org__col">
                            <div className="home-bucket__head">
                                <span className="home-bucket__title">{t('home.org.signals')}</span>
                            </div>
                            <ul className="home-org__signals">
                                {data.signals.map((s) => <Signal key={s.key} signal={s} />)}
                            </ul>
                        </div>
                        <div className="home-org__col">
                            <div className="home-bucket__head">
                                <span className="home-bucket__title">{t('home.org.byCustomer')}</span>
                            </div>
                            {data.by_customer.length === 0 ? (
                                <p className="home-bucket__empty">{t('home.org.noEffort')}</p>
                            ) : (
                                <ul className="home-org__customers">
                                    {data.by_customer.map((row) => (
                                        <li key={row.name} className="home-org__customer">
                                            <span className="home-org__customer-name">{row.name}</span>
                                            <span className="home-org__customer-hours">{formatHours(row.hours)}h</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>

                    <nav className="home-org__shortcuts" aria-label={t('home.org.shortcuts')}>
                        <Link to="/management/reports" className="h-chip">{t('nav.reports')}</Link>
                        <Link to="/management/billable-hours" className="h-chip">{t('nav.billableHours')}</Link>
                        <Link to="/management/contracts" className="h-chip">{t('nav.contractStatus')}</Link>
                    </nav>
                </>
            )}
        </section>
    )
}

export default OrgBlock
