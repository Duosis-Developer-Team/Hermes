/**
 * =============================================================================
 * HERMES - Müşteri destek portalı
 * =============================================================================
 * Duosis DIŞINDAKİ her Hermes tenant'ında görünür.
 *
 * Hedef ekip DEĞİŞTİRİLEMEZ bir bilgi kutusudur: son kullanıcı ekip
 * seçmez (yanlış kuyruğa düşen ticket, kaybolan ticket demektir). Route
 * yapılandırılmamışsa gönderim KAPALIDIR ve sessizce bir "genel"
 * gruba düşmez.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Input, message, Skeleton } from 'antd'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

import { supportPortalService, ticketErrorCode } from '../../api/ticketsApi'
import {
    Button, Card, EmptyState, Page, StatusBadge,
} from '../../components/ui'
import { LiquidSegmented, PageHero } from '../../components/liquid'
import CreateTicketModal from '../../features/tickets/CreateTicketModal'
import CustomerTicketDetail from '../../features/tickets/CustomerTicketDetail'
import {
    ERROR_MESSAGES, isResolvedLike,
} from '../../features/tickets/constants'
import { TicketStatusBadge } from '../../features/tickets/TicketStatusBadge'
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

export default function SupportPortalPage() {
    const t = useT()
    const tl = useTicketLabel()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const context = useTicketContext()

    const [tab, setTab] = useState('open')
    const [search, setSearch] = useState('')
    const [createOpen, setCreateOpen] = useState(false)
    const [selectedId, setSelectedId] = useState(null)

    // Duosis kullanicisi buraya gelirse hub'a yonlendirilir.
    useEffect(() => {
        if (context.isHub) navigate('/tickets', { replace: true })
    }, [context.isHub, navigate])

    const statuses = useMemo(
        () => TABS.find((item) => item.key === tab)?.statuses ?? [],
        [tab],
    )

    const list = useQuery({
        queryKey: queryKeys.supportTickets.list({ tab, search }),
        queryFn: () => supportPortalService.list({
            status: statuses,
            search: search || undefined,
            limit: 50,
        }),
        enabled: context.isPortal,
        keepPreviousData: true,
    })

    const invalidate = () => queryClient.invalidateQueries({
        queryKey: queryKeys.supportTickets.all,
    })

    const create = useMutation({
        mutationFn: ({ payload, idempotencyKey }) =>
            supportPortalService.create(payload, idempotencyKey),
        onSuccess: (created) => {
            invalidate()
            setCreateOpen(false)
            setSelectedId(created.id)
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
    const routeReady = Boolean(context.route?.configured)

    return (
        <Page className="tickets-page support-portal">
            <PageHero
                title={t('portal.support')}
                subtitle={routeReady
                    ? `Your requests go to the ${context.route.group_name} team.`
                    : 'Support routing has not been configured yet.'}
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
            </div>

            <div className="support-grid lq-enter">
                {rows.map((ticket) => (
                    <Card
                        key={ticket.id}
                        interactive
                        className={`support-card${isResolvedLike(ticket.status) ? ' h-ticket-row--resolved' : ''}`}
                        onClick={() => setSelectedId(ticket.id)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                setSelectedId(ticket.id)
                            }
                        }}
                        aria-label={`${ticket.ticket_number} ${ticket.title}`}
                    >
                        <span className="support-card__code">{ticket.ticket_number}</span>
                        {/* Baslik STRIKETHROUGH YAPILMAZ: cozulmus bir
                            talebin basligi da okunabilir kalmali. */}
                        <b className="support-card__title">{ticket.title}</b>
                        <span className="support-card__tags">
                            <TicketStatusBadge status={ticket.status} />
                            <StatusBadge tone="neutral">
                                {tl('category', ticket.category)}
                            </StatusBadge>
                        </span>
                        <span className="support-card__when">
                            {dayjs(ticket.updated_at).fromNow()}
                        </span>
                    </Card>
                ))}
            </div>
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
                    create.mutate({ payload, idempotencyKey })}
                pending={create.isPending}
                groupName={context.route?.group_name}
                routeReady={routeReady}
                attachmentsEnabled={context.attachmentsEnabled}
            />

            <CustomerTicketDetail
                ticketId={selectedId}
                open={Boolean(selectedId)}
                onClose={() => setSelectedId(null)}
                onChanged={invalidate}
            />
        </Page>
    )
}
