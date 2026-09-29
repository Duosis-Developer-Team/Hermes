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
 *
 * Hermes Liquid (CTO 29.09, prototip): faturalanabilir oran halkasi +
 * saat KPI'lari, sinyaller uc kutucuk, musteri kirilimi yatay cubuk
 * (en cok CUSTOMER_MAX; fazlasi "+N" — kart boyu veriyle uzamaz).
 * =============================================================================
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import dayjs from 'dayjs'

import { homeService } from '../../../services/api'
import { queryKeys } from '../../../query/queryKeys'
import { useT } from '../../../i18n'
import { formatHours } from '../model/home'
import { Ring } from '../../../components/liquid'

const CUSTOMER_MAX = 4

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
    const ratio = data?.billable_ratio
    const hasRatio = ratio !== null && ratio !== undefined
    const customers = data?.by_customer || []
    const shown = customers.slice(0, CUSTOMER_MAX)
    const peak = Math.max(1, ...shown.map((r) => Number(r.hours) || 0))

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
                    <div className="home-org__top">
                        <Ring value={hasRatio ? ratio : 0} size={100} stroke={12} color="var(--h-success)" label={t('home.org.billableRatio')}>
                            <div className="home-org__ring">
                                <b>{hasRatio ? `${ratio}%` : '—'}</b>
                                <span>{t('home.org.billableShort')}</span>
                            </div>
                        </Ring>
                        <dl className="home-org__kpis">
                            <div>
                                <dd>{formatHours(data.total_hours)}h</dd>
                                <dt>{t('home.org.totalHours')}</dt>
                            </div>
                            <div>
                                <dd>{formatHours(data.billable_hours)}h</dd>
                                <dt>{t('home.org.billableHours')}</dt>
                            </div>
                        </dl>
                    </div>

                    <ul className="home-org__signals" aria-label={t('home.org.signals')}>
                        {data.signals.map((s) => <Signal key={s.key} signal={s} />)}
                    </ul>

                    <div className="home-org__byc">
                        <div className="home-bucket__head">
                            <span className="home-bucket__title">{t('home.org.byCustomer')}</span>
                            {customers.length > CUSTOMER_MAX && (
                                <span className="home-org__more">{t('home.org.moreCustomers', { count: customers.length - CUSTOMER_MAX })}</span>
                            )}
                        </div>
                        {customers.length === 0 ? (
                            <p className="home-bucket__empty">{t('home.org.noEffort')}</p>
                        ) : (
                            <ul className="home-org__customers">
                                {shown.map((row) => (
                                    <li key={row.name || row.display_name} className="home-org__customer">
                                        <span className="home-org__customer-name">{row.name || row.display_name}</span>
                                        <span className="home-org__bar" aria-hidden="true"><i style={{ width: `${((Number(row.hours) || 0) / peak) * 100}%` }} /></span>
                                        <span className="home-org__customer-hours">{formatHours(row.hours)}h</span>
                                    </li>
                                ))}
                            </ul>
                        )}
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
