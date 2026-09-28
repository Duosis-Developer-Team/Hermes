/**
 * =============================================================================
 * HERMES - Duosis Ticket Hub (agent yüzeyi)
 * =============================================================================
 * Uygulama seçici KATALOGDAN gelir: `hermes`/`logislot` kodları burada
 * HARDCODE EDİLMEZ, yeni bir ürün bağlandığında ekran kendiliğinden
 * öğrenir.
 *
 * Filtre durumu URL'e yazılır — bir kuyruk linki paylaşılabilir; ama
 * erişimi yine backend belirler (link, yetki vermez).
 *
 * "Erişiminiz yok" ile "ticket yok" AYRI durumlardır ve ayrı mesajlarla
 * gösterilir: aktif grup üyeliği olmayan bir agent'a boş bir liste
 * göstermek, sorunu sessizce gizlerdi.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ReloadOutlined } from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Input, message, Select, Skeleton } from 'antd'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

import { ticketErrorCode, ticketHubService } from '../../api/ticketsApi'
import { Button, EmptyState, Page } from '../../components/ui'
import { GlassCard, LiquidSegmented, PageHero } from '../../components/liquid'
import AgentWorkbench from '../../features/tickets/AgentWorkbench'
import {
    AGENT_STATUS_LABELS, ERROR_MESSAGES,
} from '../../features/tickets/constants'
import {
    TicketPriorityBadge, TicketStatusBadge,
} from '../../features/tickets/TicketStatusBadge'
import useTicketContext from '../../features/tickets/useTicketContext'
import { queryKeys } from '../../query/queryKeys'
import '../../features/tickets/tickets.css'
import { useTicketLabel } from '../../features/tickets/useTicketLabel'
import { useT } from '../../i18n'

dayjs.extend(relativeTime)

const DEFAULT_QUEUE = 'my_group_open'
// Bu genislikten itibaren liste + satir ici calisma bolmesi yan yana
// (prototip); daha darda liste tek basina, detay cekmecede acilir.
const SPLIT_QUERY = '(min-width: 1100px)'

export default function TicketHubPage() {
    const t = useT()
    const tl = useTicketLabel()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const [params, setParams] = useSearchParams()
    const context = useTicketContext()

    const [selectedId, setSelectedId] = useState(null)
    const [split, setSplit] = useState(
        () => typeof window !== 'undefined' && window.matchMedia(SPLIT_QUERY).matches,
    )
    useEffect(() => {
        const mq = window.matchMedia(SPLIT_QUERY)
        const onChange = (e) => setSplit(e.matches)
        mq.addEventListener('change', onChange)
        return () => mq.removeEventListener('change', onChange)
    }, [])

    // A6 derin link: is kaleminden gelen `?ticket=<id>` calisma alanini acar
    // (tek seferlik; parametre okunup temizlenir).
    useEffect(() => {
        const wanted = params.get('ticket')
        if (!wanted) return
        setSelectedId(wanted)
        const next = new URLSearchParams(params)
        next.delete('ticket')
        setParams(next, { replace: true })
    }, [params, setParams])

    // Yuzey karari SUNUCUDAN: portal kullanicisi buraya gelirse kendi
    // ekranina yonlendirilir (404 yerine dogru yer).
    useEffect(() => {
        if (context.isPortal) navigate('/support', { replace: true })
    }, [context.isPortal, navigate])

    const queue = params.get('queue') || DEFAULT_QUEUE
    const applicationId = params.get('application') || undefined
    const search = params.get('q') || ''
    const statuses = params.getAll('status')
    // "Clear" ancak temizlenecek bir sey varken gorunur — bos bir
    // filtre cubugunda olu buton durmaz.
    const hasFilters = Boolean(
        search || statuses.length || applicationId
        || (queue && queue !== DEFAULT_QUEUE),
    )

    const patchParams = (patch) => {
        const next = new URLSearchParams(params)
        Object.entries(patch).forEach(([key, value]) => {
            next.delete(key)
            if (Array.isArray(value)) value.forEach((v) => next.append(key, v))
            else if (value) next.set(key, value)
        })
        setParams(next, { replace: true })
    }

    // Cache anahtari icin DETERMINISTIK filtre: dizi kimligi degil
    // ICERIGI onemli, bu yuzden bagimlilik olarak birlestirilmis metin
    // kullanilir (ayni secim → ayni anahtar → gereksiz refetch yok).
    const statusKey = statuses.join(',')
    const filters = useMemo(() => ({
        queue,
        application_id: applicationId,
        q: search || undefined,
        status: statusKey ? statusKey.split(',') : [],
    }), [queue, applicationId, search, statusKey])

    const applications = useQuery({
        queryKey: queryKeys.tickets.applications,
        queryFn: ticketHubService.listApplications,
        enabled: context.isHub,
    })

    const queues = useQuery({
        queryKey: [...queryKeys.tickets.queues, applicationId ?? 'all'],
        queryFn: () => ticketHubService.listQueues(
            applicationId ? { application_id: applicationId } : {},
        ),
        enabled: context.isHub,
    })

    const list = useQuery({
        queryKey: queryKeys.tickets.list(filters),
        queryFn: () => ticketHubService.list({
            queue,
            application_id: applicationId,
            search: search || undefined,
            status: statuses,
            limit: 50,
        }),
        enabled: context.isHub,
        keepPreviousData: true,
    })

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.tickets.all })
    }

    const onCommandError = (error) => {
        const code = ticketErrorCode(error)
        message.error(
            ERROR_MESSAGES[code]
            || error?.normalized?.message
            || 'The action could not be completed.',
        )
        // Surum catismasinda son hali yukle; composer taslagi
        // AgentWorkbench icinde KORUNUR.
        if (code === 'ticket_version_conflict') invalidate()
    }

    if (context.isLoading) {
        return (
            <Page className="tickets-page fade-in">
                <Skeleton active paragraph={{ rows: 6 }} />
            </Page>
        )
    }

    if (!context.isHub) {
        return (
            <Page className="tickets-page fade-in">
                <EmptyState
                    title={t('hub.unavailable')}
                    description={
                        context.context?.reason === 'missing_permission'
                            ? 'You do not have access to the support module.'
                            : 'The support module is not configured on this environment.'
                    }
                />
            </Page>
        )
    }

    const rows = list.data?.items ?? []
    const total = list.data?.total ?? 0

    // Genis ekranda secim yoksa listenin ilk talebi acilir (prototip).
    const firstId = rows[0]?.id
    const activeId = selectedId || (split ? firstId : null)

    const appOptions = [
        { value: 'all', label: t('common.all') },
        ...(applications.data ?? []).map((app) => ({
            value: app.id,
            label: `${app.display_name} ${app.open_ticket_count ?? ''}`.trim(),
        })),
    ]

    return (
        <Page className="tickets-page">
            <PageHero
                title={t('hub.tickets')}
                subtitle={`${t('hub.countLabel', { count: total })} \u00b7 ${tl('queue', queue)}`}
                actions={(
                    <>
                        <Input.Search
                            allowClear
                            className="tickets-search"
                            placeholder={t('hub.searchPlaceholder')}
                            defaultValue={search}
                            onSearch={(value) => patchParams({ q: value || null })}
                        />
                        <Button
                            icon={<ReloadOutlined />}
                            onClick={() => list.refetch()}
                            loading={list.isFetching}
                        >{t('common.refresh')}</Button>
                    </>
                )}
            />

            <div className="tickets-filters">
                <LiquidSegmented
                    ariaLabel={t('integrations.application')}
                    value={applicationId ?? 'all'}
                    onChange={(key) => patchParams({ application: key === 'all' ? null : key })}
                    options={appOptions}
                />
                <div className="tickets-queues">
                    {(queues.data ?? []).map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            className={`lq-chip${item.key === queue ? ' is-on' : ''}`}
                            aria-pressed={item.key === queue}
                            onClick={() => patchParams({ queue: item.key })}
                        >
                            {tl('queue', item.key)} <b>{item.count}</b>
                        </button>
                    ))}
                    <Select
                        mode="multiple"
                        allowClear
                        className="tickets-status-filter"
                        placeholder={t('common.status')}
                        value={statuses}
                        onChange={(value) => patchParams({ status: value })}
                        options={Object.keys(AGENT_STATUS_LABELS).map(
                            (value) => ({ value, label: tl('agentStatus', value) }),
                        )}
                    />
                    {hasFilters && (
                        <Button onClick={() => setParams(new URLSearchParams())}>{t('common.clear')}</Button>
                    )}
                </div>
            </div>

            {!context.hasScope ? (
                <EmptyState
                    title={t('hub.noQueueVisible')}
                    description={'You are not an active member of any '
                        + 'support group yet. Ask an administrator to add '
                        + 'you to the relevant group.'}
                />
            ) : (
                <div className={`tickets-split${split ? ' is-split' : ''}`}>
                    <GlassCard className="tickets-list" aria-busy={list.isLoading}>
                        {list.isLoading && <Skeleton active paragraph={{ rows: 6 }} />}
                        {!list.isLoading && rows.length === 0 && (
                            <EmptyState title={t('hub.noTickets')} description={t('hub.tryAnotherQueue')} />
                        )}
                        <ul className="tickets-list__rows">
                            {rows.map((row, i) => (
                                <li key={row.id} style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                                    <button
                                        type="button"
                                        className={`tickets-row${row.id === activeId ? ' is-active' : ''}`}
                                        aria-current={row.id === activeId ? 'true' : undefined}
                                        onClick={() => setSelectedId(row.id)}
                                    >
                                        <span className="tickets-row__main">
                                            <span className="tickets-row__title">
                                                <span className="tickets-row__code">{row.ticket_number}</span>
                                                {row.title}
                                            </span>
                                            <span className="tickets-row__meta">
                                                <TicketPriorityBadge priority={row.priority} />
                                                {[row.application?.display_name, row.source_tenant?.display_name,
                                                    row.assigned_group?.name, row.updated_at ? dayjs(row.updated_at).fromNow() : null]
                                                    .filter(Boolean).join(' \u00b7 ')}
                                            </span>
                                        </span>
                                        <span className="tickets-row__badges">
                                            <TicketStatusBadge status={row.status} surface="hub" />
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </GlassCard>

                    {split && (
                        <AgentWorkbench
                            inline
                            ticketId={activeId}
                            open={Boolean(activeId)}
                            onClose={() => setSelectedId(null)}
                            context={context}
                            onChanged={invalidate}
                            onError={onCommandError}
                        />
                    )}
                </div>
            )}

            {!split && (
            <AgentWorkbench
                ticketId={selectedId}
                open={Boolean(selectedId)}
                onClose={() => setSelectedId(null)}
                context={context}
                onChanged={invalidate}
                onError={onCommandError}
            />
            )}
        </Page>
    )
}
