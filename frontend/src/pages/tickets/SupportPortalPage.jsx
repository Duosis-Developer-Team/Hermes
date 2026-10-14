/**
 * =============================================================================
 * HERMES - Müşteri destek portalı
 * =============================================================================
 * Talep ağı bağlantısı OLAN her tenant'ta görünür ("Açtığım talepler").
 * Birden fazla sağlayıcı varsa kullanıcı talebi KİME açtığını seçer;
 * liste tüm sağlayıcılardaki talepleri birlikte gösterir.
 *
 * Hedef ekip DEĞİŞTİRİLEMEZ bir bilgi kutusudur: son kullanıcı ekip
 * seçmez (yanlış kuyruğa düşen ticket, kaybolan ticket demektir). Route
 * yapılandırılmamışsa gönderim KAPALIDIR ve sessizce bir "genel"
 * gruba düşmez.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PlusOutlined, ReadOutlined, ReloadOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Input, message, Pagination, Select, Skeleton } from 'antd'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

import { helpCenterService, supportPortalService, ticketErrorCode } from '../../api/ticketsApi'
import ArticleDrawer from '../../features/kb/ArticleDrawer'
import {
    Button, Card, EmptyState, Page, StatusBadge,
} from '../../components/ui'
import { LiquidSegmented, PageHero } from '../../components/liquid'
import CreateTicketModal from '../../features/tickets/CreateTicketModal'
import CustomerTicketDetail from '../../features/tickets/CustomerTicketDetail'
import { LIVE_REFRESH_MS } from '../../features/tickets/AgentWorkbench'
import {
    ERROR_MESSAGES, isResolvedLike,
} from '../../features/tickets/constants'
import { TicketStatusBadge } from '../../features/tickets/TicketStatusBadge'
import SurfaceSwitch from '../../features/tickets/SurfaceSwitch'
import useTicketContext from '../../features/tickets/useTicketContext'
import { queryKeys } from '../../query/queryKeys'
import '../../features/tickets/tickets.css'
import { useTicketLabel } from '../../features/tickets/useTicketLabel'
import { useT } from '../../i18n'

dayjs.extend(relativeTime)


// Sekme listesi ANAHTAR tasir; ceviri render'da yapilir.
const TABS = [
    { key: 'open', labelKey: 'portal.open', statuses: ['open', 'reopened'] },
    { key: 'in_progress', labelKey: 'portal.inProgress', statuses: ['in_progress'] },
    {
        key: 'waiting_customer', labelKey: 'portal.waitingForYou',
        statuses: ['waiting_customer'],
    },
    {
        key: 'done', labelKey: 'portal.resolvedClosed',
        statuses: ['resolved', 'closed', 'cancelled'],
    },
]

const PAGE_SIZE = 24
const SORTS = ['updated', 'newest', 'oldest']

export default function SupportPortalPage() {
    const t = useT()
    const tl = useTicketLabel()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const context = useTicketContext()

    const [tab, setTab] = useState('open')
    const [search, setSearch] = useState('')
    const [page, setPage] = useState(1)
    const [sort, setSort] = useState('updated')
    const [createOpen, setCreateOpen] = useState(false)
    // Yardim merkezinden "talep olustur" → /support?new=1 (tek seferlik).
    const [searchParams, setSearchParams] = useSearchParams()
    useEffect(() => {
        if (searchParams.get('new') !== '1') return
        setCreateOpen(true)
        const next = new URLSearchParams(searchParams)
        next.delete('new')
        setSearchParams(next, { replace: true })
    }, [searchParams, setSearchParams])
    // Secili talep + saglayicisi (birden fazla saglayicida detay/komut
    // cagrilari saglayiciyi tasir).
    const [selected, setSelected] = useState(null)
    // E-posta bildirimindeki baglanti: /support?ticket=<id>&provider=<id>
    // (tek seferlik; adres cubugundan temizlenir).
    useEffect(() => {
        const wanted = searchParams.get('ticket')
        if (!wanted) return
        setSelected({ id: wanted, provider: searchParams.get('provider') || undefined })
        const next = new URLSearchParams(searchParams)
        next.delete('ticket')
        next.delete('provider')
        setSearchParams(next, { replace: true })
    }, [searchParams, setSearchParams])
    const [providerId, setProviderId] = useState(null)
    const [articleId, setArticleId] = useState(null)

    // Yalniz saglayici (talep acmayan) tenant buraya gelirse hub'a gider.
    useEffect(() => {
        if (context.isHub && !context.isPortal) navigate('/tickets', { replace: true })
    }, [context.isHub, context.isPortal, navigate])

    const statuses = useMemo(
        () => TABS.find((item) => item.key === tab)?.statuses ?? [],
        [tab],
    )

    // Sekme/arama/siralama degisince ilk sayfaya donulur.
    useEffect(() => { setPage(1) }, [tab, search, sort])

    const list = useQuery({
        queryKey: queryKeys.supportTickets.list({ tab, search, sort, page }),
        queryFn: () => supportPortalService.list({
            status: statuses,
            search: search || undefined,
            sort: sort === 'updated' ? undefined : sort,
            limit: PAGE_SIZE,
            offset: (page - 1) * PAGE_SIZE,
        }),
        enabled: context.isPortal,
        keepPreviousData: true,
        refetchInterval: LIVE_REFRESH_MS,
    })

    const invalidate = () => queryClient.invalidateQueries({
        queryKey: queryKeys.supportTickets.all,
    })

    const create = useMutation({
        mutationFn: ({ payload, idempotencyKey, provider }) =>
            supportPortalService.create(payload, idempotencyKey, provider),
        onSuccess: (created) => {
            invalidate()
            setCreateOpen(false)
            setSelected({ id: created.id, provider: created.provider?.tenant_id })
            message.success(
                `Your request was received: ${created.ticket_number}`,
            )
        },
        onError: (error) => {
            const code = ticketErrorCode(error)
            message.error(
                ERROR_MESSAGES[code]
                || error?.normalized?.message
                || 'The request could not be sent. Your input was kept.',
            )
        },
    })

    if (context.isLoading) {
        return (
            <Page className="tickets-page fade-in">
                <Skeleton active paragraph={{ rows: 6 }} />
            </Page>
        )
    }

    if (!context.isPortal) {
        return (
            <Page className="tickets-page fade-in">
                <EmptyState
                    title={t('portal.unavailable')}
                    description={(() => {
                        const reason = context.context?.reason
                        if (reason === 'missing_permission') return 'You do not have access to the support module.'
                        if (reason === 'not_connected') return t('portal.notConnected')
                        return 'The support module is not configured on this environment.'
                    })()}
                />
            </Page>
        )
    }

    const rows = list.data?.items ?? []
    const providers = context.providers
    const multi = providers.length > 1
    const creatable = providers.filter((p) => p.can_create)
    const activeProvider = creatable.find((p) => p.tenant_id === providerId) || creatable[0] || null
    const routeReady = Boolean(activeProvider)
    const subtitle = (() => {
        if (multi) return t('portal.providersSubtitle', { count: providers.length })
        const only = providers[0]
        if (only?.can_create && only.route?.group_name) {
            return only.display_name
                ? t('portal.goesTo', { provider: only.display_name, team: only.route.group_name })
                : t('portal.goesToTeam', { team: only.route.group_name })
        }
        return t('portal.routingNotConfigured')
    })()
    const openTicket = (ticket) => setSelected({ id: ticket.id, provider: ticket.provider?.tenant_id })

    return (
        <Page className="tickets-page support-portal">
            <SurfaceSwitch />
            <PageHero
                title={context.isDual ? t('tickets.outgoing') : t('portal.support')}
                subtitle={subtitle}
                actions={(
                    <>
                        <Input.Search
                            allowClear
                            className="tickets-search"
                            placeholder={t('portal.searchPlaceholder')}
                            onSearch={setSearch}
                        />
                        <Button
                            icon={<ReloadOutlined />}
                            onClick={() => list.refetch()}
                            loading={list.isFetching}
                        >{t('common.refresh')}</Button>
                        <Button icon={<ReadOutlined />} onClick={() => navigate('/support/help')}>
                            {t('kb.helpCenter')}
                        </Button>
                        <Button
                            variant="primary"
                            icon={<PlusOutlined />}
                            disabled={!context.canCreate}
                            onClick={() => setCreateOpen(true)}
                        >{t('portal.newRequest')}</Button>
                    </>
                )}
            />

            {!routeReady && (
                <Alert
                    type="warning"
                    showIcon
                    message={t('portal.routingNotConfigured')}
                    description={'New requests cannot be created. Please '
                        + 'contact your administrator; this screen enables '
                        + 'itself once a target support team is set.'}
                    style={{ marginBottom: 16 }}
                />
            )}

            <div className="support-tabs">
                <LiquidSegmented
                    ariaLabel={t('portal.support')}
                    value={tab}
                    onChange={setTab}
                    options={TABS.map((item) => ({ value: item.key, label: t(item.labelKey) }))}
                />
                <Select
                    className="tickets-sort"
                    aria-label={t('hub.sortBy')}
                    value={sort}
                    onChange={setSort}
                    options={SORTS.map((value) => ({ value, label: t(`hub.sort.${value}`) }))}
                />
            </div>

            <div className="support-grid lq-enter">
                {rows.map((ticket) => (
                    <Card
                        key={ticket.id}
                        interactive
                        className={`support-card${isResolvedLike(ticket.status) ? ' h-ticket-row--resolved' : ''}${ticket.has_update ? ' has-update' : ''}`}
                        onClick={() => openTicket(ticket)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                openTicket(ticket)
                            }
                        }}
                        aria-label={`${ticket.ticket_number} ${ticket.title}`}
                    >
                        <span className="support-card__code">
                            {ticket.has_update && <span className="tickets-row__dot" aria-label={t('portal.hasUpdate')} />}
                            {ticket.ticket_number}
                        </span>
                        {/* Baslik STRIKETHROUGH YAPILMAZ: cozulmus bir
                            talebin basligi da okunabilir kalmali. */}
                        <b className="support-card__title">{ticket.title}</b>
                        <span className="support-card__tags">
                            <TicketStatusBadge status={ticket.status} />
                            <StatusBadge tone="neutral">
                                {tl('category', ticket.category)}
                            </StatusBadge>
                            {multi && ticket.provider?.display_name && (
                                <StatusBadge tone="info">
                                    {ticket.provider.display_name}
                                </StatusBadge>
                            )}
                        </span>
                        <span className="support-card__when">
                            {dayjs(ticket.updated_at).fromNow()}
                        </span>
                    </Card>
                ))}
            </div>
            {(list.data?.total ?? 0) > PAGE_SIZE && (
                <Pagination
                    className="support-pager"
                    simple
                    size="small"
                    current={page}
                    pageSize={PAGE_SIZE}
                    total={list.data.total}
                    onChange={setPage}
                />
            )}
            {!rows.length && !list.isLoading && (
                <EmptyState
                    title={t('portal.noRequests')}
                    description={context.canCreate
                        ? 'You can open a new support request.'
                        : 'You do not have permission to open requests.'}
                />
            )}

            <CreateTicketModal
                open={createOpen}
                onCancel={() => setCreateOpen(false)}
                onSubmit={(payload, idempotencyKey) =>
                    create.mutate({ payload, idempotencyKey, provider: activeProvider?.tenant_id })}
                pending={create.isPending}
                groupName={activeProvider?.route?.group_name}
                routeReady={routeReady}
                attachmentsEnabled={context.attachmentsEnabled}
                providers={creatable}
                provider={activeProvider}
                onProviderChange={setProviderId}
                suggest={(q) => helpCenterService.suggest(q, activeProvider?.tenant_id || undefined)}
                onOpenArticle={setArticleId}
            />

            <ArticleDrawer
                articleId={articleId}
                provider={activeProvider?.tenant_id || undefined}
                onClose={() => setArticleId(null)}
            />

            <CustomerTicketDetail
                ticketId={selected?.id}
                provider={selected?.provider}
                attachmentsEnabled={context.attachmentsEnabled}
                open={Boolean(selected)}
                onClose={() => setSelected(null)}
                onChanged={invalidate}
            />
        </Page>
    )
}
