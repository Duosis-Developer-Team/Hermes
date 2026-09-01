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
import { useT } from '../../i18n'

const { Text, Paragraph } = Typography

const SCOPES = [
    'support:groups:read',
    'support:tickets:read',
    'support:tickets:write',
    'support:attachments:write',
]

function RoutingTab() {
    const t = useT()
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
            message.success(t('integrations.routingUpdated'))
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
                message={t('integrations.oneTargetPerWorkspace')}
                description={t('integrations.routeChangeHint')}
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
                                title={t('integrations.noWorkspaces')}
                                description={t('integrations.mappingHint')}
                            />
                        ),
                    }}
                    columns={[
                        {
                            title: t('integrations.application'), dataIndex: 'application_id',
                            render: appName, width: 140,
                        },
                        { title: t('integrations.workspace'), dataIndex: 'display_name' },
                        {
                            title: t('integrations.sourceId'), dataIndex: 'source_tenant_id',
                            ellipsis: true,
                        },
                        {
                            title: t('common.status'), dataIndex: 'status', width: 110,
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
                            title: t('integrations.targetTeam'), width: 260,
                            render: (_, row) => (
                                <Select
                                    style={{ width: '100%' }}
                                    placeholder={t('integrations.notConfigured')}
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
                            title: t('integrations.routeVersion'), dataIndex: ['route', 'route_version'],
                            width: 90,
                        },
                    ]}
                />
            </Surface>
        </Stack>
    )
}

function CredentialsTab() {
    const t = useT()
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
                <Button variant="primary" onClick={() => setCreateOpen(true)}>{t('integrations.newClient')}</Button>
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
                            >{t('integrations.issueToken')}</Button>
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
                            locale={{ emptyText: t('integrations.noTokens') }}
                            columns={[
                                { title: t('integrations.prefix'), dataIndex: 'token_prefix' },
                                { title: t('common.status'), dataIndex: 'status' },
                                {
                                    title: t('integrations.lastUsed'), dataIndex: 'last_used_at',
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
                                            >{t('integrations.revoke')}</Button>
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
                title={t('integrations.newClient')}
                okText={t('common.create')}
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
                        label={t('integrations.application')}
                        rules={[{ required: true, message: t('integrations.selectApplication') }]}
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
                        label={t('common.name')}
                        rules={[{ required: true, message: t('integrations.nameRequired') }]}
                    >
                        <Input maxLength={120} />
                    </Form.Item>
                    <Form.Item
                        name="scopes"
                        label={t('integrations.scopes')}
                        extra={t('integrations.scopesHint')}
                        rules={[{ required: true, message: t('integrations.selectScope') }]}
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
                title={t('integrations.copyTokenNow')}
                okText={t('integrations.savedIt')}
                cancelButtonProps={{ style: { display: 'none' } }}
                onOk={() => setIssuedToken(null)}
                onCancel={() => setIssuedToken(null)}
                destroyOnHidden
            >
                <Alert
                    type="warning"
                    showIcon
                    message={t('integrations.shownOnce')}
                    description={t('integrations.tokenHashOnly')}
                />
                <Paragraph copyable={{ text: issuedToken?.token }} code>
                    {issuedToken?.token}
                </Paragraph>
            </AppModal>
        </Stack>
    )
}

function DeliveryTab() {
    const t = useT()
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
            message.success(t('integrations.requeued'))
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
                    <Metric label={t('integrations.pending')} value={stats.data?.pending ?? '—'} />
                    <Metric label={t('integrations.inFlight')} value={stats.data?.in_flight ?? '—'} />
                    <Metric label={t('integrations.delivered')} value={stats.data?.delivered ?? '—'} />
                    <Metric
                        label={t('integrations.deadLetter')}
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
                        <Text type="secondary">{t('integrations.contentNeverShown')}</Text>
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
                                title={t('integrations.noEvents')}
                                description={t('integrations.eventsHint')}
                            />
                        ),
                    }}
                    columns={[
                        { title: t('integrations.ticket'), dataIndex: 'ticket_number', width: 130 },
                        { title: t('integrations.event'), dataIndex: 'event_type' },
                        { title: t('integrations.app'), dataIndex: 'application_code', width: 110 },
                        {
                            title: t('common.status'), dataIndex: 'status', width: 110,
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
                        { title: t('integrations.tries'), dataIndex: 'attempts', width: 80 },
                        { title: t('integrations.lastError'), dataIndex: 'last_error_code' },
                        {
                            title: '', width: 110,
                            render: (_, row) => (row.status === 'dead' ? (
                                <Button
                                    size="small"
                                    loading={retry.isPending}
                                    onClick={() => retry.mutate(row.id)}
                                >{t('integrations.retryNow')}</Button>
                            ) : null),
                        },
                    ]}
                />
            </Surface>
        </Stack>
    )
}

export default function TicketIntegrationsPage() {
    const t = useT()
    const context = useTicketContext()
    const canConfigure = context.can('tickets.config.manage')
    const canOperate = context.can('tickets.admin')

    if (!context.isHub) {
        return (
            <Page>
                <EmptyState
                    title={t('integrations.unavailable')}
                    description={t('integrations.livesInDuosis')}
                />
            </Page>
        )
    }

    const items = [
        ...(canConfigure ? [
            { key: 'routing', label: t('integrations.routing'), children: <RoutingTab /> },
            {
                key: 'credentials', label: t('integrations.credentials'),
                children: <CredentialsTab />,
            },
        ] : []),
        ...(canOperate ? [
            { key: 'delivery', label: t('integrations.delivery'), children: <DeliveryTab /> },
        ] : []),
    ]

    return (
        <Page>
            <PageHeader
                title={t('integrations.title')}
                subtitle="Applications, routing, service credentials and event delivery."
            />
            {items.length
                ? <Tabs items={items} />
                : (
                    <EmptyState
                        title={t('integrations.noSections')}
                        description={t('integrations.needPermission')}
                    />
                )}
        </Page>
    )
}
