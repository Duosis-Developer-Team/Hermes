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
import { Input, message, Select, Table, Tabs, Typography } from 'antd'

import { ticketErrorCode, ticketHubService } from '../../api/ticketsApi'
import {
    Button, EmptyState, FilterChip, Inline, Page, PageHeader,
    Surface, Toolbar,
} from '../../components/ui'
import AgentWorkbench from '../../features/tickets/AgentWorkbench'
import {
    AGENT_STATUS_LABELS, ERROR_MESSAGES, QUEUE_LABELS,
    isResolvedLike, labelOf,
} from '../../features/tickets/constants'
import {
    TicketPriorityBadge, TicketStatusBadge,
} from '../../features/tickets/TicketStatusBadge'
import useTicketContext from '../../features/tickets/useTicketContext'
import { queryKeys } from '../../query/queryKeys'
import '../../features/tickets/tickets.css'

const { Text } = Typography

const DEFAULT_QUEUE = 'my_group_open'

export default function TicketHubPage() {
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const [params, setParams] = useSearchParams()
    const context = useTicketContext()

    const [selectedId, setSelectedId] = useState(null)

    // Yuzey karari SUNUCUDAN: portal kullanicisi buraya gelirse kendi
    // ekranina yonlendirilir (404 yerine dogru yer).
    useEffect(() => {
        if (context.isPortal) navigate('/support', { replace: true })
    }, [context.isPortal, navigate])

    const queue = params.get('queue') || DEFAULT_QUEUE
    const applicationId = params.get('application') || undefined
    const search = params.get('q') || ''
    const statuses = params.getAll('status')

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
        return <Page><Text type="secondary">Loading…</Text></Page>
    }

    if (!context.isHub) {
        return (
            <Page>
                <EmptyState
                    title="This screen is unavailable"
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

    const columns = [
        {
            title: 'Code', dataIndex: 'ticket_number', width: 130,
            render: (value, row) => (
                <span className={isResolvedLike(row.status)
                    ? 'h-ticket-row--resolved' : undefined}
                >
                    {value}
                </span>
            ),
        },
        { title: 'Title', dataIndex: 'title', ellipsis: true },
        {
            title: 'Application', dataIndex: ['application', 'display_name'],
            width: 130,
        },
        {
            title: 'Customer', dataIndex: ['source_tenant', 'display_name'],
            width: 150,
        },
        {
            title: 'Status', dataIndex: 'status', width: 190,
            render: (status) => (
                <TicketStatusBadge status={status} surface="hub" />
            ),
        },
        {
            title: 'Priority', dataIndex: 'priority', width: 110,
            render: (priority) => <TicketPriorityBadge priority={priority} />,
        },
        {
            title: 'Team', dataIndex: ['assigned_group', 'name'], width: 150,
        },
        {
            title: 'Updated', dataIndex: 'updated_at', width: 170,
            render: (value) => new Date(value).toLocaleString(),
        },
    ]

    const appTabs = [
        { key: 'all', label: 'All' },
        ...(applications.data ?? []).map((app) => ({
            key: app.id,
            label: `${app.display_name} (${app.open_ticket_count})`,
        })),
    ]

    return (
        <Page>
            <PageHeader
                title="Tickets"
                subtitle={`${total} tickets · ${labelOf(QUEUE_LABELS, queue)}`}
                extra={(
                    <Button
                        icon={<ReloadOutlined />}
                        onClick={() => list.refetch()}
                        loading={list.isFetching}
                    >
                        Refresh
                    </Button>
                )}
            />

            <Tabs
                activeKey={applicationId ?? 'all'}
                items={appTabs}
                onChange={(key) => patchParams({
                    application: key === 'all' ? null : key,
                })}
            />

            <Toolbar>
                <Inline gap={2}>
                    {(queues.data ?? []).map((item) => (
                        <FilterChip
                            key={item.key}
                            active={item.key === queue}
                            onClick={() => patchParams({ queue: item.key })}
                        >
                            {labelOf(QUEUE_LABELS, item.key)} · {item.count}
                        </FilterChip>
                    ))}
                </Inline>
                <Toolbar.Spacer />
                <Inline gap={2}>
                    <Select
                        mode="multiple"
                        allowClear
                        style={{ minWidth: 220 }}
                        placeholder="Status"
                        value={statuses}
                        onChange={(value) => patchParams({ status: value })}
                        options={Object.entries(AGENT_STATUS_LABELS).map(
                            ([value, label]) => ({ value, label }),
                        )}
                    />
                    <Input.Search
                        allowClear
                        placeholder="Code, title, error code"
                        defaultValue={search}
                        onSearch={(value) => patchParams({ q: value || null })}
                        style={{ width: 260 }}
                    />
                    <Button onClick={() => setParams(new URLSearchParams())}>
                        Clear
                    </Button>
                </Inline>
            </Toolbar>

            {!context.hasScope ? (
                <EmptyState
                    title="No queue is visible to you"
                    description={'You are not an active member of any '
                        + 'support group yet. Ask an administrator to add '
                        + 'you to the relevant group.'}
                />
            ) : (
                <Surface>
                    <Table
                        rowKey="id"
                        size="small"
                        loading={list.isLoading}
                        dataSource={rows}
                        columns={columns}
                        pagination={false}
                        onRow={(row) => ({
                            onClick: () => setSelectedId(row.id),
                            style: { cursor: 'pointer' },
                        })}
                        locale={{
                            emptyText: (
                                <EmptyState
                                    title="No tickets in this queue"
                                    description="Try a different queue or application."
                                />
                            ),
                        }}
                    />
                </Surface>
            )}

            <AgentWorkbench
                ticketId={selectedId}
                open={Boolean(selectedId)}
                onClose={() => setSelectedId(null)}
                context={context}
                onChanged={invalidate}
                onError={onCommandError}
            />
        </Page>
    )
}
