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
import { Alert, App as AntApp, Input, Tabs, Typography } from 'antd'

import { supportPortalService, ticketErrorCode } from '../../api/ticketsApi'
import {
    Button, Card, EmptyState, Inline, Page, PageHeader, Stack,
    StatusBadge, Surface, Toolbar,
} from '../../components/ui'
import CreateTicketModal from '../../features/tickets/CreateTicketModal'
import CustomerTicketDetail from '../../features/tickets/CustomerTicketDetail'
import {
    CATEGORY_LABELS, ERROR_MESSAGES, isResolvedLike, labelOf,
} from '../../features/tickets/constants'
import { TicketStatusBadge } from '../../features/tickets/TicketStatusBadge'
import useTicketContext from '../../features/tickets/useTicketContext'
import { queryKeys } from '../../query/queryKeys'
import '../../features/tickets/tickets.css'

const { Text } = Typography

const TABS = [
    { key: 'open', label: 'Open', statuses: ['open', 'reopened'] },
    { key: 'in_progress', label: 'In progress', statuses: ['in_progress'] },
    {
        key: 'waiting_customer', label: 'Waiting for your reply',
        statuses: ['waiting_customer'],
    },
    {
        key: 'done', label: 'Resolved / Closed',
        statuses: ['resolved', 'closed', 'cancelled'],
    },
]

export default function SupportPortalPage() {
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { message } = AntApp.useApp()
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
        return <Page><Text type="secondary">Loading…</Text></Page>
    }

    if (!context.isPortal) {
        return (
            <Page>
                <EmptyState
                    title="The support portal is unavailable"
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
        <Page>
            <PageHeader
                title="Destek"
                subtitle={routeReady
                    ? `Your requests go to the ${context.route.group_name} team.`
                    : 'Support routing has not been configured yet.'}
                extra={(
                    <Inline gap={2}>
                        <Button
                            icon={<ReloadOutlined />}
                            onClick={() => list.refetch()}
                            loading={list.isFetching}
                        >
                            Refresh
                        </Button>
                        <Button
                            variant="primary"
                            icon={<PlusOutlined />}
                            disabled={!context.canCreate}
                            onClick={() => setCreateOpen(true)}
                        >
                            New request
                        </Button>
                    </Inline>
                )}
            />

            {!routeReady && (
                <Alert
                    type="warning"
                    showIcon
                    message="Support routing has not been configured"
                    description={'New requests cannot be created. Please '
                        + 'contact your administrator; this screen enables '
                        + 'itself once a target support team is set.'}
                    style={{ marginBottom: 16 }}
                />
            )}

            <Tabs
                activeKey={tab}
                onChange={setTab}
                items={TABS.map((item) => ({
                    key: item.key, label: item.label,
                }))}
            />

            <Toolbar>
                <Input.Search
                    allowClear
                    placeholder="Ticket code or title"
                    onSearch={setSearch}
                    style={{ width: 320 }}
                />
            </Toolbar>

            <Stack gap={2}>
                {rows.map((ticket) => (
                    <Card
                        key={ticket.id}
                        interactive
                        className={isResolvedLike(ticket.status)
                            ? 'h-ticket-row--resolved' : undefined}
                        onClick={() => setSelectedId(ticket.id)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                setSelectedId(ticket.id)
                            }
                        }}
                        aria-label={`${ticket.ticket_number} ${ticket.title}`}
                    >
                        <Inline gap={2}>
                            <Text strong>{ticket.ticket_number}</Text>
                            {/* Baslik STRIKETHROUGH YAPILMAZ: cozulmus bir
                                talebin basligi da okunabilir kalmali. */}
                            <Text>{ticket.title}</Text>
                            <TicketStatusBadge status={ticket.status} />
                            <StatusBadge tone="neutral">
                                {labelOf(CATEGORY_LABELS, ticket.category)}
                            </StatusBadge>
                            <Text type="secondary" style={{ marginLeft: 'auto' }}>
                                {new Date(ticket.updated_at).toLocaleString()}
                            </Text>
                        </Inline>
                    </Card>
                ))}
                {!rows.length && !list.isLoading && (
                    <Surface>
                        <EmptyState
                            title="No requests in this tab"
                            description={context.canCreate
                                ? 'You can open a new support request.'
                                : 'You do not have permission to open requests.'}
                        />
                    </Surface>
                )}
            </Stack>

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
