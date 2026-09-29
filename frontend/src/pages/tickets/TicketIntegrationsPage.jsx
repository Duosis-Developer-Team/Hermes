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
 *
 * Hermes Liquid (29.09): tam genislik; hap segment ile bolum secimi, her
 * bolum cam kart (settingsKit), teslimat metrikleri KPI karolari. Sorgular,
 * mutation'lar ve izin ayrimi AYNI.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Form, Input, message, Select, Spin, Table, Typography } from 'antd'
import {
    ApiOutlined, BranchesOutlined, DashboardOutlined, InfoCircleOutlined, KeyOutlined, LockOutlined,
    PlusOutlined, SendOutlined, StopOutlined,
} from '@ant-design/icons'

import { ticketAdminService, ticketHubService } from '../../api/ticketsApi'
import { AppModal } from '../../components/ui'
import { ModalHead } from '../../components/liquid'
import useTicketContext from '../../features/tickets/useTicketContext'
import { queryKeys } from '../../query/queryKeys'
import '../admin/settingsKit.css'
import './TicketIntegrationsPage.css'
import { useT } from '../../i18n'
import { SettingsEmpty, SettingsKpis, SettingsSection, SettingsTabs } from '../admin/settingsKit'

const { Paragraph } = Typography

const SCOPES = [
    'support:groups:read',
    'support:tickets:read',
    'support:tickets:write',
    'support:attachments:write',
]

/* Durum → (etiket anahtari, hap tonu). Bilinmeyen deger ham gosterilir. */
const RECORD_STATUS = {
    active: ['integrations.statusActive', 'ok'],
    disabled: ['integrations.statusDisabled', ''],
    revoked: ['integrations.statusRevoked', 'bad'],
    suspended: ['integrations.statusSuspended', 'warn'],
    archived: ['integrations.statusArchived', ''],
}
const DELIVERY_STATUS = {
    delivered: ['integrations.delivered', 'ok'],
    pending: ['integrations.pending', 'info'],
    in_flight: ['integrations.inFlight', 'violet'],
    dead: ['integrations.deadLetter', 'bad'],
}
const ENV_LABEL = { dev: ['api.development', 'warn'], live: ['api.live', 'ok'] }

function StatusPill({ map, value }) {
    const t = useT()
    const [key, tone] = map[value] ?? [null, '']
    return (
        <span className={`lq-tag${tone ? ` lq-tag--${tone}` : ''}`}>
            {key ? t(key) : value}
        </span>
    )
}

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
            error?.normalized?.message || t('integrations.routeFailed'),
        ),
    })

    const appName = (id) => (applications.data ?? [])
        .find((a) => a.id === id)?.display_name ?? '—'

    return (
        <SettingsSection
            icon={<BranchesOutlined />}
            tone="blue"
            title={t('integrations.routing')}
            subtitle={t('integrations.oneTargetPerWorkspace')}
            count={sources.data?.length}
        >
            <p className="sk-hint">
                <InfoCircleOutlined aria-hidden="true" />
                <span>{t('integrations.routeChangeHint')}</span>
            </p>
            <Table
                rowKey="id"
                loading={sources.isLoading}
                dataSource={sources.data ?? []}
                pagination={false}
                scroll={{ x: 'max-content' }}
                locale={{
                    emptyText: (
                        <SettingsEmpty
                            icon={<BranchesOutlined />}
                            title={t('integrations.noWorkspaces')}
                            text={t('integrations.mappingHint')}
                        />
                    ),
                }}
                columns={[
                    {
                        title: t('integrations.workspace'), dataIndex: 'display_name',
                        render: (name, row) => (
                            <span className="ti-ws">
                                <span className="ti-ws__name">{name}</span>
                                <span className="ti-ws__id">{row.source_tenant_id}</span>
                            </span>
                        ),
                    },
                    {
                        title: t('integrations.application'), dataIndex: 'application_id',
                        render: (id) => <span className="lq-tag">{appName(id)}</span>,
                    },
                    {
                        title: t('common.status'), dataIndex: 'status',
                        render: (status) => <StatusPill map={RECORD_STATUS} value={status} />,
                    },
                    {
                        title: t('integrations.targetTeam'),
                        render: (_, row) => (
                            <Select
                                className="ti-route-select"
                                aria-label={t('integrations.targetTeamFor', { name: row.display_name })}
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
                        /* Eski baslik ("Route v" / "Yonlendirme s") dar
                           kolonda iki satira kiriliyordu. */
                        title: t('integrations.version'), dataIndex: ['route', 'route_version'],
                        align: 'right',
                        render: (v) => (v == null
                            ? <span className="sk-muted">—</span>
                            : <span className="sk-mono">v{v}</span>),
                    },
                ]}
            />
        </SettingsSection>
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
            error?.normalized?.message || t('integrations.createFailed'),
        ),
    })
    const issueToken = useMutation({
        mutationFn: (clientId) => ticketAdminService.issueToken(clientId),
        onSuccess: (data) => { setIssuedToken(data); invalidate() },
        onError: (error) => message.error(
            error?.normalized?.message || t('integrations.issueFailed'),
        ),
    })
    const revokeToken = useMutation({
        mutationFn: ({ clientId, tokenId }) =>
            ticketAdminService.revokeToken(clientId, tokenId),
        onSuccess: invalidate,
    })

    const newClientAction = (
        <Button
            className="h-create-action"
            icon={<PlusOutlined />}
            onClick={() => setCreateOpen(true)}
        >{t('integrations.newClient')}</Button>
    )
    const list = clients.data ?? []

    return (
        <SettingsSection
            icon={<KeyOutlined />}
            tone="green"
            title={t('integrations.credentials')}
            subtitle={t('integrations.credentialsSub')}
            count={clients.data ? list.length : undefined}
            actions={list.length > 0 ? newClientAction : null}
        >
            {clients.isLoading && <div className="ti-loading"><Spin /></div>}
            {!clients.isLoading && list.length === 0 && (
                <SettingsEmpty
                    icon={<KeyOutlined />}
                    title={t('integrations.noClientsTitle')}
                    text={t('integrations.noClientsText')}
                    action={newClientAction}
                />
            )}

            <div className="ti-clients">
                {list.map((client) => (
                    <article key={client.id} className="ti-client">
                        <header className="ti-client__head">
                            <span className="ti-client__icon" aria-hidden="true"><ApiOutlined /></span>
                            <div className="ti-client__titles">
                                <h3 className="ti-client__name">{client.name}</h3>
                                <div className="ti-client__tags">
                                    <span className="lq-tag lq-mono">{client.application_code}</span>
                                    <StatusPill map={RECORD_STATUS} value={client.status} />
                                    <StatusPill map={ENV_LABEL} value={client.environment} />
                                </div>
                            </div>
                            <Button
                                size="small"
                                className="h-create-action ti-client__issue"
                                icon={<KeyOutlined />}
                                loading={issueToken.isPending}
                                aria-label={t('integrations.issueTokenFor', { name: client.name })}
                                onClick={() => issueToken.mutate(client.id)}
                            >{t('integrations.issueToken')}</Button>
                        </header>

                        <div className="ti-client__scopes">
                            {client.scopes.map((scope) => (
                                <span key={scope} className="lq-tag lq-tag--info lq-mono">{scope}</span>
                            ))}
                        </div>

                        <Table
                            rowKey="id"
                            size="small"
                            className="ti-client__tokens"
                            pagination={false}
                            dataSource={client.tokens}
                            locale={{
                                emptyText: (
                                    <SettingsEmpty compact text={t('integrations.noTokens')} />
                                ),
                            }}
                            columns={[
                                {
                                    title: t('integrations.prefix'), dataIndex: 'token_prefix',
                                    render: (v) => <code className="sk-mono">{v}…</code>,
                                },
                                {
                                    title: t('common.status'), dataIndex: 'status',
                                    render: (v) => <StatusPill map={RECORD_STATUS} value={v} />,
                                },
                                {
                                    title: t('integrations.lastUsed'), dataIndex: 'last_used_at',
                                    render: (v) => (v
                                        ? <span className="sk-nowrap">{new Date(v).toLocaleString()}</span>
                                        : <span className="sk-muted">{t('integrations.never')}</span>),
                                },
                                {
                                    title: <span className="h-sr-only">{t('common.actions')}</span>,
                                    key: 'actions',
                                    align: 'right',
                                    render: (_, token) => (token.status === 'active'
                                        ? (
                                            <Button
                                                size="small"
                                                className="h-inline-action h-inline-action--danger"
                                                icon={<StopOutlined />}
                                                aria-label={t('integrations.revokeTokenAria', { prefix: token.token_prefix })}
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
                    </article>
                ))}
            </div>

            <AppModal
                open={createOpen}
                title={<ModalHead icon={<KeyOutlined />} tone="green" title={t('integrations.newClient')} />}
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
                title={<ModalHead icon={<KeyOutlined />} tone="green" title={t('integrations.copyTokenNow')} />}
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
                <Paragraph className="ti-token" copyable={{ text: issuedToken?.token }} code>
                    {issuedToken?.token}
                </Paragraph>
            </AppModal>
        </SettingsSection>
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
            error?.normalized?.message || t('integrations.retryFailed'),
        ),
    })

    const h = health.data
    const dead = stats.data?.dead

    return (
        <>
            <SettingsKpis
                ariaLabel={t('integrations.deliverySummary')}
                items={[
                    { key: 'pending', label: t('integrations.pending'), value: stats.data?.pending },
                    { key: 'inflight', label: t('integrations.inFlight'), value: stats.data?.in_flight },
                    { key: 'delivered', label: t('integrations.delivered'), value: stats.data?.delivered },
                    {
                        key: 'dead',
                        label: t('integrations.deadLetter'),
                        value: dead,
                        hint: stats.data
                            ? (dead ? t('integrations.deadHint') : t('integrations.healthy'))
                            : undefined,
                    },
                ]}
            />

            {h && (
                <SettingsSection
                    icon={<DashboardOutlined />}
                    tone={h.module_state === 'ok' ? 'green' : 'red'}
                    title={t('integrations.health')}
                    subtitle={t('integrations.contentNeverShown')}
                >
                    <div className="ti-health">
                        <span className={`lq-tag ${h.module_state === 'ok' ? 'lq-tag--ok' : 'lq-tag--bad'}`}>
                            {h.module_state === 'ok'
                                ? t('integrations.moduleOk')
                                : t('integrations.moduleState', { state: h.module_state })}
                        </span>
                        <span className={`lq-tag ${h.attachments_production_ready ? 'lq-tag--ok' : 'lq-tag--warn'}`}>
                            {h.attachments_production_ready
                                ? t('integrations.attachmentsReady')
                                : t('integrations.attachmentsNotReady', {
                                    reason: h.attachments_reason ?? t('integrations.attachmentsNotReadyDefault'),
                                })}
                        </span>
                        {h.unrouted_source_tenants > 0 && (
                            <span className="lq-tag lq-tag--warn">
                                {t(h.unrouted_source_tenants === 1
                                    ? 'integrations.unroutedOne'
                                    : 'integrations.unroutedMany', { n: h.unrouted_source_tenants })}
                            </span>
                        )}
                    </div>
                </SettingsSection>
            )}

            <SettingsSection
                icon={<SendOutlined />}
                tone="violet"
                title={t('integrations.outboundEvents')}
                subtitle={t('integrations.outboundEventsSub')}
                bodyClassName="sk-card__body--flush"
            >
                <Table
                    rowKey="id"
                    loading={events.isLoading}
                    dataSource={events.data ?? []}
                    pagination={false}
                    scroll={{ x: 'max-content' }}
                    locale={{
                        emptyText: (
                            <SettingsEmpty
                                icon={<SendOutlined />}
                                title={t('integrations.noEvents')}
                                text={t('integrations.eventsHint')}
                            />
                        ),
                    }}
                    columns={[
                        {
                            title: t('integrations.ticket'), dataIndex: 'ticket_number',
                            render: (v) => <span className="sk-mono sk-nowrap">{v}</span>,
                        },
                        {
                            title: t('integrations.event'), dataIndex: 'event_type',
                            render: (v) => <span className="sk-mono">{v}</span>,
                        },
                        {
                            title: t('integrations.app'), dataIndex: 'application_code',
                            render: (v) => <span className="lq-tag lq-mono">{v}</span>,
                        },
                        {
                            title: t('common.status'), dataIndex: 'status',
                            render: (status) => <StatusPill map={DELIVERY_STATUS} value={status} />,
                        },
                        {
                            title: t('integrations.tries'), dataIndex: 'attempts', align: 'right',
                            render: (v) => <span className="sk-mono">{v}</span>,
                        },
                        {
                            title: t('integrations.lastError'), dataIndex: 'last_error_code',
                            render: (v) => (v
                                ? <span className="sk-mono ti-error">{v}</span>
                                : <span className="sk-muted">—</span>),
                        },
                        {
                            title: <span className="h-sr-only">{t('common.actions')}</span>,
                            key: 'actions',
                            align: 'right',
                            render: (_, row) => (row.status === 'dead' ? (
                                <Button
                                    size="small"
                                    className="h-inline-action"
                                    loading={retry.isPending}
                                    onClick={() => retry.mutate(row.id)}
                                >{t('integrations.retryNow')}</Button>
                            ) : null),
                        },
                    ]}
                />
            </SettingsSection>
        </>
    )
}

export default function TicketIntegrationsPage() {
    const t = useT()
    const context = useTicketContext()
    const canConfigure = context.can('tickets.config.manage')
    const canOperate = context.can('tickets.admin')
    const [active, setActive] = useState(null)

    const header = (
        <div className="page-header">
            <h1>{t('integrations.title')}</h1>
            <p>{t('integrations.subtitle')}</p>
        </div>
    )

    if (!context.isHub) {
        return (
            <div className="ti-page">
                {header}
                <section className="sk-card">
                    <SettingsEmpty
                        icon={<LockOutlined />}
                        title={t('integrations.unavailable')}
                        text={t('integrations.livesInDuosis')}
                    />
                </section>
            </div>
        )
    }

    const items = [
        ...(canConfigure ? [
            { key: 'routing', label: t('integrations.routing'), render: () => <RoutingTab /> },
            { key: 'credentials', label: t('integrations.credentials'), render: () => <CredentialsTab /> },
        ] : []),
        ...(canOperate ? [
            { key: 'delivery', label: t('integrations.delivery'), render: () => <DeliveryTab /> },
        ] : []),
    ]
    const current = items.find((i) => i.key === active) ?? items[0]

    return (
        <div className="ti-page">
            {header}
            {items.length ? (
                <>
                    {items.length > 1 && (
                        <SettingsTabs
                            ariaLabel={t('integrations.sections')}
                            value={current.key}
                            onChange={setActive}
                            options={items.map((i) => ({ value: i.key, label: i.label }))}
                        />
                    )}
                    <div className="lq-enter ti-body" key={current.key}>
                        {current.render()}
                    </div>
                </>
            ) : (
                <section className="sk-card">
                    <SettingsEmpty
                        icon={<LockOutlined />}
                        title={t('integrations.noSections')}
                        text={t('integrations.needPermission')}
                    />
                </section>
            )}
        </div>
    )
}
