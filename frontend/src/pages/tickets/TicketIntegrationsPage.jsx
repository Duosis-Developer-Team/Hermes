/**
 * =============================================================================
 * HERMES - Ticket integrations (Duosis admin)
 * =============================================================================
 * Iki AYRI izin uzayi bilincli olarak ayrilmistir:
 *   tickets.config.manage → application / route / credential
 *   tickets.admin         → teslimat operasyonu + saglik
 * Konfigurasyon yetkisi ticket ICERIGI vermez; bu sayfa hicbir ticket
 * govdesi gostermez (06 §8).
 *
 * Uretilen token PLAINTEXT olarak YALNIZCA bir kez gorunur; kapatildiktan
 * sonra hicbir uctan okunamaz.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Form, Input, message, Select, Table, Tabs, Typography } from 'antd'

import { ticketAdminService, ticketHubService } from '../../api/ticketsApi'
import {
    AppModal, Button, EmptyState, Inline, Metric, Page, PageHeader, Stack,
    StatusBadge, Surface,
} from '../../components/ui'
import useTicketContext from '../../features/tickets/useTicketContext'
import { queryKeys } from '../../query/queryKeys'
import '../../features/tickets/tickets.css'

const { Text, Paragraph } = Typography

const SCOPES = [
    'support:groups:read',
    'support:tickets:read',
    'support:tickets:write',
    'support:attachments:write',
]

function RoutingTab() {
    const queryClient = useQueryClient()

    const sources = useQuery({
        queryKey: queryKeys.ticketAdmin.sourceTenants,
        queryFn: () => ticketAdminService.listSourceTenants(),
    })
    const groups = useQuery({
        queryKey: queryKeys.tickets.routingGroups,
        queryFn: ticketHubService.routingGroups,
    })
    const applications = useQuery({
        queryKey: queryKeys.ticketAdmin.applications,
        queryFn: ticketAdminService.listApplications,
    })

    const setRoute = useMutation({
        mutationFn: ({ id, groupId }) =>
            ticketAdminService.setRoute(id, { group_id: groupId }),
        onSuccess: () => {
            message.success('Routing updated. Only new tickets are affected.')
            queryClient.invalidateQueries({
                queryKey: queryKeys.ticketAdmin.sourceTenants,
            })
        },
        onError: (error) => message.error(
            error?.normalized?.message || 'Routing could not be updated.',
        ),
    })

    const appName = (id) => (applications.data ?? [])
        .find((a) => a.id === id)?.display_name ?? '—'

    return (
        <Stack gap={3}>
            <Alert
                type="info"
                showIcon
                message="One active target team per customer workspace"
                description="Changing the route affects new tickets only; existing tickets are never moved in bulk."
            />
            <Surface>
                <Table
                    rowKey="id"
                    size="small"
                    loading={sources.isLoading}
                    dataSource={sources.data ?? []}
                    pagination={false}
                    locale={{
                        emptyText: (
                            <EmptyState
                                title="No customer workspaces mapped yet"
                                description="A mapping is created the first time a workspace raises a ticket, or manually via the API."
                            />
                        ),
                    }}
                    columns={[
                        {
                            title: 'Application', dataIndex: 'application_id',
                            render: appName, width: 140,
                        },
                        { title: 'Workspace', dataIndex: 'display_name' },
                        {
                            title: 'Source ID', dataIndex: 'source_tenant_id',
                            ellipsis: true,
                        },
                        {
                            title: 'Status', dataIndex: 'status', width: 110,
                            render: (status) => (
                                <StatusBadge
                                    tone={status === 'active'
                                        ? 'success' : 'neutral'}
                                >
                                    {status}
                                </StatusBadge>
                            ),
                        },
                        {
                            title: 'Target team', width: 260,
                            render: (_, row) => (
                                <Select
                                    style={{ width: '100%' }}
                                    placeholder="Not configured"
                                    value={row.route?.group_id}
                                    loading={setRoute.isPending}
                                    onChange={(groupId) => setRoute.mutate({
                                        id: row.id, groupId,
                                    })}
                                    options={(groups.data ?? []).map((g) => ({
                                        value: g.id,
                                        label: `${g.name} (${g.member_count})`,
                                    }))}
                                />
                            ),
                        },
                        {
                            title: 'Route v', dataIndex: ['route', 'route_version'],
                            width: 90,
                        },
                    ]}
                />
            </Surface>
        </Stack>
    )
}

function CredentialsTab() {
    const queryClient = useQueryClient()
    const [form] = Form.useForm()
    const [createOpen, setCreateOpen] = useState(false)
    const [issuedToken, setIssuedToken] = useState(null)

    const applications = useQuery({
        queryKey: queryKeys.ticketAdmin.applications,
        queryFn: ticketAdminService.listApplications,
    })
    const clients = useQuery({
        queryKey: queryKeys.ticketAdmin.clients,
        queryFn: ticketAdminService.listIntegrationClients,
    })

    const invalidate = () => queryClient.invalidateQueries({
        queryKey: queryKeys.ticketAdmin.clients,
    })

    const createClient = useMutation({
        mutationFn: ticketAdminService.createIntegrationClient,
        onSuccess: () => { setCreateOpen(false); invalidate() },
        onError: (error) => message.error(
            error?.normalized?.message || 'The client could not be created.',
        ),
    })
    const issueToken = useMutation({
        mutationFn: (clientId) => ticketAdminService.issueToken(clientId),
        onSuccess: (data) => { setIssuedToken(data); invalidate() },
        onError: (error) => message.error(
            error?.normalized?.message || 'The token could not be issued.',
        ),
    })
    const revokeToken = useMutation({
        mutationFn: ({ clientId, tokenId }) =>
            ticketAdminService.revokeToken(clientId, tokenId),
        onSuccess: invalidate,
    })

    return (
        <Stack gap={3}>
            <Inline gap={2}>
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                    New integration client
                </Button>
            </Inline>

            {(clients.data ?? []).map((client) => (
                <Surface key={client.id}>
                    <Stack gap={2}>
                        <Inline gap={2}>
                            <Text strong>{client.name}</Text>
                            <StatusBadge tone="neutral">
                                {client.application_code}
                            </StatusBadge>
                            <StatusBadge
                                tone={client.status === 'active'
                                    ? 'success' : 'neutral'}
                            >
                                {client.status}
                            </StatusBadge>
                            <StatusBadge tone="info">
                                {client.environment}
                            </StatusBadge>
                            <Button
                                style={{ marginLeft: 'auto' }}
                                loading={issueToken.isPending}
                                onClick={() => issueToken.mutate(client.id)}
                            >
                                Issue token
                            </Button>
                        </Inline>
                        <Inline gap={1}>
                            {client.scopes.map((scope) => (
                                <StatusBadge key={scope} tone="brand">
                                    {scope}
                                </StatusBadge>
                            ))}
                        </Inline>
                        <Table
                            rowKey="id"
                            size="small"
                            pagination={false}
                            dataSource={client.tokens}
                            locale={{ emptyText: 'No tokens issued yet' }}
                            columns={[
                                { title: 'Prefix', dataIndex: 'token_prefix' },
                                { title: 'Status', dataIndex: 'status' },
                                {
                                    title: 'Last used', dataIndex: 'last_used_at',
                                    render: (v) => (v
                                        ? new Date(v).toLocaleString()
                                        : 'never'),
                                },
                                {
                                    title: '', width: 110,
                                    render: (_, token) => (token.status === 'active'
                                        ? (
                                            <Button
                                                size="small"
                                                danger
                                                onClick={() => revokeToken.mutate({
                                                    clientId: client.id,
                                                    tokenId: token.id,
                                                })}
                                            >
                                                Revoke
                                            </Button>
                                        )
                                        : null),
                                },
                            ]}
                        />
                    </Stack>
                </Surface>
            ))}

            <AppModal
                open={createOpen}
                title="New integration client"
                okText="Create"
                onCancel={() => setCreateOpen(false)}
                onOk={async () => {
                    let values
                    try {
                        values = await form.validateFields()
                    } catch {
                        return
                    }
                    createClient.mutate(values)
                }}
                confirmLoading={createClient.isPending}
                destroyOnHidden
            >
                <Form form={form} layout="vertical" preserve={false}>
                    <Form.Item
                        name="application_id"
                        label="Application"
                        rules={[{ required: true, message: 'Select an application' }]}
                    >
                        <Select
                            options={(applications.data ?? []).map((app) => ({
                                value: app.id,
                                label: `${app.display_name} (${app.code})`,
                            }))}
                        />
                    </Form.Item>
                    <Form.Item
                        name="name"
                        label="Name"
                        rules={[{ required: true, message: 'A name is required' }]}
                    >
                        <Input maxLength={120} />
                    </Form.Item>
                    <Form.Item
                        name="scopes"
                        label="Scopes"
                        extra="Grant only what this integration actually needs."
                        rules={[{ required: true, message: 'Select at least one scope' }]}
                    >
                        <Select
                            mode="multiple"
                            options={SCOPES.map((s) => ({ value: s, label: s }))}
                        />
                    </Form.Item>
                </Form>
            </AppModal>

            <AppModal
                open={Boolean(issuedToken)}
                title="Copy this token now"
                okText="I saved it"
                cancelButtonProps={{ style: { display: 'none' } }}
                onOk={() => setIssuedToken(null)}
                onCancel={() => setIssuedToken(null)}
                destroyOnHidden
            >
                <Alert
                    type="warning"
                    showIcon
                    message="Shown only once"
                    description="Hermes stores only a hash of this token. If you lose it, issue a new one."
                />
                <Paragraph copyable={{ text: issuedToken?.token }} code>
                    {issuedToken?.token}
                </Paragraph>
            </AppModal>
        </Stack>
    )
}

function DeliveryTab() {
    const queryClient = useQueryClient()

    const stats = useQuery({
        queryKey: queryKeys.ticketAdmin.delivery,
        queryFn: ticketAdminService.deliveryStats,
        refetchInterval: 30_000,
    })
    const events = useQuery({
        queryKey: [...queryKeys.ticketAdmin.delivery, 'events'],
        queryFn: () => ticketAdminService.listDelivery({ limit: 50 }),
    })
    const health = useQuery({
        queryKey: queryKeys.ticketAdmin.health,
        queryFn: ticketAdminService.health,
    })

    const retry = useMutation({
        mutationFn: ticketAdminService.retryDelivery,
        onSuccess: () => {
            message.success('Event re-queued with the same event id.')
            queryClient.invalidateQueries({
                queryKey: queryKeys.ticketAdmin.delivery,
            })
        },
        onError: (error) => message.error(
            error?.normalized?.message || 'Retry failed.',
        ),
    })

    const h = health.data

    return (
        <Stack gap={3}>
            <Surface>
                <Inline gap={4}>
                    <Metric label="Pending" value={stats.data?.pending ?? '—'} />
                    <Metric label="In flight" value={stats.data?.in_flight ?? '—'} />
                    <Metric label="Delivered" value={stats.data?.delivered ?? '—'} />
                    <Metric
                        label="Dead letter"
                        value={stats.data?.dead ?? '—'}
                        hint={stats.data?.dead
                            ? 'Needs an audited manual replay'
                            : 'Healthy'}
                    />
                </Inline>
            </Surface>

            {h && (
                <Surface>
                    <Stack gap={2}>
                        <Inline gap={2}>
                            <StatusBadge
                                tone={h.module_state === 'ok'
                                    ? 'success' : 'danger'}
                            >
                                module: {h.module_state}
                            </StatusBadge>
                            <StatusBadge
                                tone={h.attachments_production_ready
                                    ? 'success' : 'warning'}
                            >
                                attachments:{' '}
                                {h.attachments_production_ready
                                    ? 'production ready'
                                    : (h.attachments_reason ?? 'not ready')}
                            </StatusBadge>
                            {h.unrouted_source_tenants > 0 && (
                                <StatusBadge tone="warning">
                                    {h.unrouted_source_tenants} workspace(s)
                                    without a route
                                </StatusBadge>
                            )}
                        </Inline>
                        <Text type="secondary">
                            Ticket content is never shown on this screen.
                        </Text>
                    </Stack>
                </Surface>
            )}

            <Surface>
                <Table
                    rowKey="id"
                    size="small"
                    loading={events.isLoading}
                    dataSource={events.data ?? []}
                    pagination={false}
                    locale={{
                        emptyText: (
                            <EmptyState
                                title="No outbound events yet"
                                description="Events appear once a source application with a callback URL is connected."
                            />
                        ),
                    }}
                    columns={[
                        { title: 'Ticket', dataIndex: 'ticket_number', width: 130 },
                        { title: 'Event', dataIndex: 'event_type' },
                        { title: 'App', dataIndex: 'application_code', width: 110 },
                        {
                            title: 'Status', dataIndex: 'status', width: 110,
                            render: (status) => (
                                <StatusBadge
                                    tone={{
                                        delivered: 'success',
                                        pending: 'info',
                                        in_flight: 'brand',
                                        dead: 'danger',
                                    }[status] ?? 'neutral'}
                                >
                                    {status}
                                </StatusBadge>
                            ),
                        },
                        { title: 'Tries', dataIndex: 'attempts', width: 80 },
                        { title: 'Last error', dataIndex: 'last_error_code' },
                        {
                            title: '', width: 110,
                            render: (_, row) => (row.status === 'dead' ? (
                                <Button
                                    size="small"
                                    loading={retry.isPending}
                                    onClick={() => retry.mutate(row.id)}
                                >
                                    Retry now
                                </Button>
                            ) : null),
                        },
                    ]}
                />
            </Surface>
        </Stack>
    )
}

export default function TicketIntegrationsPage() {
    const context = useTicketContext()
    const canConfigure = context.can('tickets.config.manage')
    const canOperate = context.can('tickets.admin')

    if (!context.isHub) {
        return (
            <Page>
                <EmptyState
                    title="This screen is unavailable"
                    description="Support integration configuration lives inside the Duosis support workspace."
                />
            </Page>
        )
    }

    const items = [
        ...(canConfigure ? [
            { key: 'routing', label: 'Routing', children: <RoutingTab /> },
            {
                key: 'credentials', label: 'Credentials',
                children: <CredentialsTab />,
            },
        ] : []),
        ...(canOperate ? [
            { key: 'delivery', label: 'Delivery', children: <DeliveryTab /> },
        ] : []),
    ]

    return (
        <Page>
            <PageHeader
                title="Ticket integrations"
                subtitle="Applications, routing, service credentials and event delivery."
            />
            {items.length
                ? <Tabs items={items} />
                : (
                    <EmptyState
                        title="No sections available"
                        description="You need tickets.config.manage or tickets.admin."
                    />
                )}
        </Page>
    )
}
