/**
 * =============================================================================
 * HERMES PLATFORM - Dashboard Page
 * =============================================================================
 * Admin dashboard - zaman verilerinin görselleştirilmesi (FR 5.x).
 * =============================================================================
 */

import { useEffect, useMemo, useState } from 'react'
import { Spin, Button } from 'antd'
import { BarChartOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts'
import dayjs from 'dayjs'
import { reportsService, authService } from '../services/api'
import { useT } from '../i18n'
import { queryKeys } from '../query/queryKeys'
import { BarList, CountUp, GlassCard, PageHero } from '../components/liquid'
import {
    chartState, dashboardSummary, formatDuration, resolveUserNames, toChartSeries,
} from '../features/dashboard/model/dashboardData'

// Hermes Liquid (prototip): musteri/proje = animasyonlu cubuk listeler
// (BarList), kisi = yuvarlak koseli degradeli sutun grafik. Renkler
// token; Recharts SVG'si CSS degiskenini dogrudan kabul eder.

function DashboardPage() {
    const t = useT()
    const [dateRange, setDateRange] = useState([
        dayjs().subtract(30, 'day'),
        dayjs(),
    ])

    // Dashboard data
    const { data, isLoading } = useQuery({
        queryKey: queryKeys.dashboard.range(
            dateRange[0]?.format('YYYY-MM-DD'),
            dateRange[1]?.format('YYYY-MM-DD')
        ),
        queryFn: () => reportsService.getDashboard({
            start_date: dateRange[0]?.format('YYYY-MM-DD'),
            end_date: dateRange[1]?.format('YYYY-MM-DD'),
        }),
        enabled: !!dateRange[0] && !!dateRange[1],
        // Tarih degisince sayfa spinner'a dusup yeniden KURULMAZ: onceki
        // veri yeni gelene kadar durur (animasyon yalniz ilk acilista).
        placeholderData: keepPreviousData,
    })

    // Giris animasyonu (sayac, cubuklar, grafik) yalniz sayfanin ILK
    // acilisinda oynar; ay degisiminde degerler dogrudan yerine oturur.
    const [settled, setSettled] = useState(false)
    useEffect(() => {
        if (!data || settled) return undefined
        const id = setTimeout(() => setSettled(true), 1200)
        return () => clearTimeout(id)
    }, [data, settled])

    /* Yalniz "By User" serisindeki kimlikleri ADA cevirmek icin. Eskiden
       admin-only /auth/users ucundan geliyordu; users.manage olmayan
       kullanicida 403 donuyor ve tum satirlar "—" oluyordu. */
    const { data: usersResponse } = useQuery({
        queryKey: queryKeys.users.lookup,
        queryFn: () => authService.lookupUsers(),
    })
    const users = useMemo(
        () => (Array.isArray(usersResponse) ? usersResponse : (usersResponse?.data || [])),
        [usersResponse]
    )

    // Donusumler TEST EDILEBILIR adaptorden gelir (features/dashboard/
    // model): sayisal olmayan degerler NaN olarak grafige gitmez, ham
    // UUID ekrana sizmaz.
    const customerData = toChartSeries(data?.by_customer, { limit: 8 })
    const projectData = toChartSeries(data?.by_project, { limit: 8 })

    const goToPreviousMonth = () => {
        setDateRange(prev => [prev[0].subtract(1, 'month').startOf('month'), prev[0].subtract(1, 'month').endOf('month')])
    }
    const goToNextMonth = () => {
        setDateRange(prev => [prev[0].add(1, 'month').startOf('month'), prev[0].add(1, 'month').endOf('month')])
    }
    const goToThisMonth = () => {
        setDateRange([dayjs().startOf('month'), dayjs().endOf('month')])
    }

    // Backend `by_user.name` alaninda user_id gonderir; adaptor onu
    // goruntulenen ada cevirir ve cozulemezse notr tire yazar.
    const userData = resolveUserNames(data?.by_user, users)
    const summary = dashboardSummary(data, userData)

    /**
     * Grafik cercevesi: veri yoksa veya tamami sifir saatse GRAFIK
     * CIZILMEZ, durumu anlatan bir mesaj gosterilir. "Veri yok" ile
     * "kayit var ama sifir saat" ayri mesajlardir — ikisini ayni
     * gostermek kullaniciyi yanlis yonlendirirdi.
     */
    const ChartFrame = ({ series, children }) => {
        const state = chartState(series)
        if (state === 'ready') return children
        return (
            /* Premium UI: 300px bos gri alan yerine kompakt, ferah bos
               durum — ikon + kisa metin; panel yuksekligi iceriktir. */
            <div
                role="status"
                style={{
                    padding: '40px 24px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8,
                    textAlign: 'center',
                    color: 'var(--c-text-muted)',
                    fontSize: 13,
                }}
            >
                <BarChartOutlined aria-hidden="true" style={{ fontSize: 20, opacity: 0.45 }} />
                {state === 'empty'
                    ? t('dashboard.noData')
                    : 'Records exist but no hours were logged in this range.'}
            </div>
        )
    }

    const CustomTooltip = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            return (
                <div style={{
                    background: 'var(--h-surface-overlay)',
                    border: '1px solid color-mix(in srgb, var(--h-brand) 20%, var(--h-border-subtle))',
                    borderRadius: 10,
                    padding: '8px 12px',
                    color: 'var(--h-text-primary)',
                    boxShadow: 'var(--h-shadow-dropdown)'
                }}>
                    <p style={{ margin: 0, fontWeight: 600, color: 'var(--h-text-primary)' }}>{label}</p>
                    <p style={{ margin: 0 }}>{`${payload[0].value} h`}</p>
                </div>
            )
        }
        return null
    }

    if (isLoading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
                <Spin size="large" />
            </div>
        )
    }

    const emptyText = t('dashboard.noData')
    // Iki liste AYNI ust sinirla kesilir; kartlar ayni satirda esit boy
    // (simetri). Kalanlar tek satir notla belirtilir.
    const LIST_MAX = 8
    const listItems = (series) => series.slice(0, LIST_MAX).map((d) => ({ key: d.name, name: d.name, value: d.hours }))
    const moreNote = (series) => (series.length > LIST_MAX
        ? <p className="dashboard-more">{t('dashboard.more', { count: series.length - LIST_MAX })}</p>
        : null)
    // Kullanici adlari: HICBIRI atlanmaz. Kalabalikta egik, cok kalabalikta
    // "Ad S." (tam ad ipucunda).
    const crowded = userData.length > 7
    const veryCrowded = userData.length > 12
    const shortName = (name = '') => {
        const parts = String(name).trim().split(/\s+/)
        return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0]
    }
    const UserTick = ({ x, y, payload }) => {
        const label = veryCrowded ? shortName(payload.value) : payload.value
        return (
            <g transform={`translate(${x},${y + 6})`}>
                <title>{payload.value}</title>
                <text
                    textAnchor={crowded ? 'end' : 'middle'}
                    transform={crowded ? 'rotate(-35)' : undefined}
                    dy={crowded ? 4 : 10}
                    fill="var(--h-chart-axis)"
                    fontSize={12}
                >
                    {label}
                </text>
            </g>
        )
    }
    const kpis = [
        // Saat: HAM sayi sayilir, bicim (1284h 30m) her karede uygulanir.
        { key: 'hours', value: Number(data?.total_hours) || 0, format: formatDuration, decimals: 2, label: t('dashboard.totalHours') },
        { key: 'customers', value: summary.customerCount, label: t('entity.customers') },
        { key: 'projects', value: summary.projectCount, label: t('entity.projects') },
        { key: 'members', value: summary.memberCount, label: t('dashboard.activeMembers') },
    ]

    return (
        <div className="dashboard-page">
            <PageHero
                title={t('dashboard.title')}
                subtitle={t('dashboard.subtitle')}
                actions={(
                    <>
                        <Button shape="circle" aria-label={t('dashboard.previousMonth')} icon={<LeftOutlined />} onClick={goToPreviousMonth} />
                        <span className="dashboard-range">
                            {dateRange[0].format('D MMM')} – {dateRange[1].format('D MMM YYYY')}
                        </span>
                        <Button shape="circle" aria-label={t('dashboard.nextMonth')} icon={<RightOutlined />} onClick={goToNextMonth} />
                        <Button onClick={goToThisMonth}>{t('dashboard.thisMonth')}</Button>
                    </>
                )}
            />

            {/* KPI karolari: acilista sayarak dolar (h-metric-strip rolu). */}
            <div className="lq-kpis lq-enter h-metric-strip" role="group" aria-label={t('dashboard.summaryMetrics')}>
                {kpis.map((k) => (
                    <GlassCard key={k.key} className="lq-kpi">
                        <span className="lq-kpi__dash" aria-hidden="true" />
                        <span className="lq-kpi__value"><CountUp value={k.value} format={k.format} decimals={k.decimals} /></span>
                        <span className="lq-kpi__label">{k.label}</span>
                    </GlassCard>
                ))}
            </div>

            <div className="lq-bento lq-enter dashboard-bento">
                <GlassCard className="lq-c6" title={t('dashboard.byCustomer')} link={<span className="dashboard-unit">{t('dashboard.hoursUnit')}</span>}>
                    <BarList items={listItems(customerData)} tone="blue" emptyText={emptyText} animate={!settled} />
                    {moreNote(customerData)}
                </GlassCard>
                <GlassCard className="lq-c6" title={t('dashboard.byProject')} link={<span className="dashboard-unit">{t('dashboard.hoursUnit')}</span>}>
                    <BarList items={listItems(projectData)} tone="violet" emptyText={emptyText} animate={!settled} />
                    {moreNote(projectData)}
                </GlassCard>
                <GlassCard className="lq-c12" title={t('dashboard.byUser')} link={<span className="dashboard-unit">{t('dashboard.hoursUnit')}</span>}>
                    <ChartFrame series={userData}>
                        <ResponsiveContainer width="100%" height={crowded ? 360 : 320}>
                            <BarChart data={userData} margin={{ top: 28, right: 8, left: -12, bottom: crowded ? 36 : 4 }}>
                                <defs>
                                    <linearGradient id="dash-user-bar" x1="0" x2="0" y1="0" y2="1">
                                        {/* SVG ozniteligi CSS degiskenini cozmez; stil cozer. */}
                                        <stop offset="0" style={{ stopColor: 'var(--hp-blue-400)' }} />
                                        <stop offset="1" style={{ stopColor: 'var(--hp-blue-600)' }} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid vertical={false} stroke="var(--h-chart-grid)" />
                                <XAxis
                                    dataKey="name"
                                    interval={0}
                                    height={crowded ? 70 : 34}
                                    tick={<UserTick />}
                                    stroke="var(--h-chart-axis)"
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <YAxis stroke="var(--h-chart-axis)" tickLine={false} axisLine={false} />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--h-bg-hover)', radius: 12 }} />
                                <Bar dataKey="hours" name="Hours" fill="url(#dash-user-bar)" radius={[14, 14, 14, 14]} maxBarSize={72} animationDuration={900}
                                    isAnimationActive={!settled && !window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches}>
                                    <LabelList dataKey="hours" position="top" fill="var(--h-text-secondary)" fontSize={12} />
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </ChartFrame>
                </GlassCard>
            </div>
        </div>
    )
}

export default DashboardPage
