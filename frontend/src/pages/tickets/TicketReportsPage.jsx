/**
 * =============================================================================
 * HERMES - Talep raporlari (Dalga C, 00-plan §4.3)
 * =============================================================================
 * Hacim (acilan/cozulen), birikim, medyan ilk yanit / cozum, SLA uyumu,
 * memnuniyet (CSAT), ekip ve ajan kirilimi, kategori/oncelik dagilimi.
 *
 * Kapsam SUNUCUDA: yonetici saglayicinin tamamini, ajan kendi ekiplerini
 * gorur (liste ile ayni kural). Sureler duvar saati; SLA uyumu takvimli
 * SLA vadesine gore.
 * =============================================================================
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Select, Skeleton } from 'antd'
import {
    Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import dayjs from 'dayjs'

import { authService } from '../../api/authApi'
import { ticketHelpdeskService, ticketHubService } from '../../api/ticketsApi'
import { EmptyState, Page } from '../../components/ui'
import { BackLink, BarList, CountUp, GlassCard, LiquidSegmented, PageHero } from '../../components/liquid'
import { formatSpan } from '../../features/tickets/SlaBadge'
import useTicketContext from '../../features/tickets/useTicketContext'
import { useTicketLabel } from '../../features/tickets/useTicketLabel'
import { queryKeys } from '../../query/queryKeys'
import { useT } from '../../i18n'
import '../../features/tickets/tickets.css'

const PERIODS = [7, 30, 90]

const pct = (rate) => (rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`)

export default function TicketReportsPage() {
    const t = useT()
    const tl = useTicketLabel()
    const navigate = useNavigate()
    const context = useTicketContext()
    const [days, setDays] = useState(30)
    const [groupId, setGroupId] = useState(null)

    const groups = useQuery({
        queryKey: queryKeys.tickets.routingGroups,
        queryFn: ticketHubService.routingGroups,
        enabled: context.isHub,
        staleTime: 300_000,
    })
    const report = useQuery({
        queryKey: ['tickets', 'reports', days, groupId ?? 'all'],
        queryFn: () => ticketHelpdeskService.reports({ days, group_id: groupId || undefined }),
        enabled: context.isHub,
        keepPreviousData: true,
    })
    const data = report.data
    const agentIds = useMemo(() => (data?.agents ?? []).map((a) => a.user_id).sort(), [data])
    const people = useQuery({
        queryKey: queryKeys.authUsersLookup.byIds(agentIds),
        queryFn: () => authService.lookupUsers({ ids: agentIds }),
        enabled: agentIds.length > 0,
        staleTime: 60_000,
    })
    const nameOf = useMemo(() => Object.fromEntries(
        (people.data ?? []).map((u) => [u.id, u.full_name || u.email]),
    ), [people.data])

    if (context.isLoading) return <Page className="tickets-page"><Skeleton active /></Page>
    if (!context.isHub) {
        return <Page className="tickets-page"><EmptyState title={t('hub.unavailable')} description={t('ticketReports.providerOnly')} /></Page>
    }

    const minutes = (value) => (value === null || value === undefined ? '—' : formatSpan(t, value * 60000))
    const totals = data?.totals
    const kpis = totals ? [
        { key: 'created', label: t('ticketReports.created'), value: totals.created },
        { key: 'resolved', label: t('ticketReports.resolved'), value: totals.resolved },
        { key: 'backlog', label: t('ticketReports.backlog'), value: totals.backlog },
        { key: 'reopened', label: t('ticketReports.reopened'), value: totals.reopened },
    ] : []
    const series = (data?.series ?? []).map((d) => ({ ...d, label: dayjs(d.date).format('D MMM') }))

    return (
        <Page className="tickets-page ticket-reports">
            <BackLink onClick={() => navigate('/tickets')}>{t('hub.tickets')}</BackLink>
            <PageHero
                title={t('ticketReports.title')}
                subtitle={t('ticketReports.subtitle', { days })}
                actions={(
                    <>
                        <Select
                            allowClear
                            className="tickets-status-filter"
                            placeholder={t('ticketReports.allTeams')}
                            aria-label={t('hub.targetTeam')}
                            value={groupId}
                            onChange={(v) => setGroupId(v || null)}
                            options={(groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))}
                        />
                        <LiquidSegmented
                            ariaLabel={t('ticketReports.period')}
                            value={days}
                            onChange={setDays}
                            options={PERIODS.map((d) => ({ value: d, label: t('ticketReports.lastDays', { days: d }) }))}
                        />
                    </>
                )}
            />

            {!data ? <Skeleton active paragraph={{ rows: 8 }} /> : (
                <>
                    <div className="lq-kpis lq-enter" role="group" aria-label={t('ticketReports.summary')}>
                        {kpis.map((k) => (
                            <GlassCard key={k.key} className="lq-kpi">
                                <span className="lq-kpi__dash" aria-hidden="true" />
                                <span className="lq-kpi__value"><CountUp value={k.value} /></span>
                                <span className="lq-kpi__label">{k.label}</span>
                            </GlassCard>
                        ))}
                    </div>

                    <div className="ticket-reports__facts lq-enter">
                        <GlassCard className="ticket-fact">
                            <span className="ticket-fact__label">{t('ticketReports.medianFirstResponse')}</span>
                            <b>{minutes(totals.median_first_response_minutes)}</b>
                        </GlassCard>
                        <GlassCard className="ticket-fact">
                            <span className="ticket-fact__label">{t('ticketReports.medianResolution')}</span>
                            <b>{minutes(totals.median_resolution_minutes)}</b>
                        </GlassCard>
                        <GlassCard className="ticket-fact">
                            <span className="ticket-fact__label">{t('ticketReports.slaFirstResponse')}</span>
                            <b>{pct(data.sla.first_response.rate)}</b>
                            <small>{t('ticketReports.slaOf', { met: data.sla.first_response.met, total: data.sla.first_response.total })}</small>
                        </GlassCard>
                        <GlassCard className="ticket-fact">
                            <span className="ticket-fact__label">{t('ticketReports.slaResolution')}</span>
                            <b>{pct(data.sla.resolution.rate)}</b>
                            <small>{t('ticketReports.slaOf', { met: data.sla.resolution.met, total: data.sla.resolution.total })}</small>
                        </GlassCard>
                        <GlassCard className="ticket-fact">
                            <span className="ticket-fact__label">{t('ticketReports.csat')}</span>
                            <b>{data.csat.average ? `${data.csat.average.toFixed(1)} / 5` : '—'}</b>
                            <small>{t('ticketReports.csatOf', { count: data.csat.responses, rate: pct(data.csat.satisfied_rate) })}</small>
                        </GlassCard>
                    </div>

                    <div className="lq-bento lq-enter">
                        <GlassCard className="lq-c12" title={t('ticketReports.volume')}>
                            <ResponsiveContainer width="100%" height={260}>
                                <BarChart data={series} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
                                    <CartesianGrid vertical={false} stroke="var(--h-chart-grid)" />
                                    <XAxis dataKey="label" stroke="var(--h-chart-axis)" tickLine={false} axisLine={false}
                                           interval="preserveStartEnd" minTickGap={18} />
                                    <YAxis allowDecimals={false} stroke="var(--h-chart-axis)" tickLine={false} axisLine={false} />
                                    <Tooltip cursor={{ fill: 'var(--h-bg-hover)' }} />
                                    <Legend />
                                    <Bar dataKey="created" name={t('ticketReports.created')} fill="var(--h-chart-1)" radius={[6, 6, 0, 0]} maxBarSize={22} />
                                    <Bar dataKey="resolved" name={t('ticketReports.resolved')} fill="var(--h-chart-2)" radius={[6, 6, 0, 0]} maxBarSize={22} />
                                </BarChart>
                            </ResponsiveContainer>
                        </GlassCard>
                        <GlassCard className="lq-c6" title={t('ticketReports.byTeam')}>
                            <table className="ticket-report-table">
                                <thead><tr>
                                    <th>{t('hub.targetTeam')}</th><th>{t('ticketReports.created')}</th><th>{t('ticketReports.resolved')}</th>
                                    <th>{t('ticketReports.open')}</th><th>{t('ticketReports.medianResolution')}</th>
                                </tr></thead>
                                <tbody>
                                    {(data.teams ?? []).map((row) => (
                                        <tr key={row.group_id}>
                                            <th scope="row">{row.name}</th><td>{row.created}</td><td>{row.resolved}</td>
                                            <td>{row.open}</td><td>{minutes(row.median_resolution_minutes)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {!(data.teams ?? []).length && <p className="lq-barlist__empty">{t('ticketReports.empty')}</p>}
                        </GlassCard>
                        <GlassCard className="lq-c6" title={t('ticketReports.byAgent')}>
                            <table className="ticket-report-table">
                                <thead><tr>
                                    <th>{t('hub.assignee')}</th><th>{t('ticketReports.resolved')}</th><th>{t('ticketReports.openAssigned')}</th>
                                </tr></thead>
                                <tbody>
                                    {(data.agents ?? []).map((row) => (
                                        <tr key={row.user_id}>
                                            <th scope="row">{nameOf[row.user_id] ?? '…'}</th><td>{row.resolved}</td><td>{row.open}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {!(data.agents ?? []).length && <p className="lq-barlist__empty">{t('ticketReports.empty')}</p>}
                        </GlassCard>
                        <GlassCard className="lq-c6" title={t('ticketReports.byCategory')}>
                            <BarList tone="blue" emptyText={t('ticketReports.empty')}
                                     items={Object.entries(data.by_category ?? {}).map(([k, v]) => ({ key: k, name: tl('category', k), value: v }))} />
                        </GlassCard>
                        <GlassCard className="lq-c6" title={t('ticketReports.byPriority')}>
                            <BarList tone="violet" emptyText={t('ticketReports.empty')}
                                     items={['urgent', 'high', 'normal', 'low'].filter((p) => data.by_priority?.[p])
                                         .map((p) => ({ key: p, name: tl('priority', p), value: data.by_priority[p] }))} />
                        </GlassCard>
                    </div>
                </>
            )}
        </Page>
    )
}
