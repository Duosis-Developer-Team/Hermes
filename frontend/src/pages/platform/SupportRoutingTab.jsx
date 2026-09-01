/**
 * =============================================================================
 * HERMES Platform Console — Tenant support routing
 * =============================================================================
 * "Which tenants may raise tickets, TO WHOM, and to WHICH TEAM?"
 *
 * The provider list is deliberately a dropdown even though exactly one
 * provider exists today (the configured Duosis support workspace). The
 * multi-provider world is not built yet, but the screen is shaped for
 * it so adding a second provider later changes data, not UI.
 *
 * BOUNDARY: this screen shows CONFIGURATION only. Ticket content never
 * reaches the platform plane — the backend surface cannot return it.
 *
 * Routing is the gate: an active route means the tenant's users can
 * raise tickets; no route means the portal blocks creation with an
 * explicit "not configured" message instead of failing silently. WHO
 * inside the tenant may raise them is still the tenant admin's call
 * (RBAC), and that split is stated on screen.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, message, Select, Switch, Table, Tag, Typography } from 'antd'

import { platformService } from '../../api/platformApi'
import { useT } from '../../i18n'

const { Text } = Typography

export default function SupportRoutingTab() {
    const t = useT()
    const queryClient = useQueryClient()
    const [pendingTenant, setPendingTenant] = useState(null)

    const providers = useQuery({
        queryKey: ['platform', 'support', 'providers'],
        queryFn: platformService.supportProviders,
    })
    const routing = useQuery({
        queryKey: ['platform', 'support', 'routing'],
        queryFn: platformService.supportRouting,
    })

    // `useMemo`: bos dizi literali her render'da YENI referanstir ve
    // asagidaki memo'yu her seferinde yeniden hesaplatirdi.
    const providerList = useMemo(
        () => providers.data?.providers ?? [], [providers.data],
    )
    const moduleState = providers.data?.module_state
    const defaultProvider = providerList[0]

    const groupsByProvider = useMemo(() => {
        const map = {}
        providerList.forEach((p) => { map[p.tenant_id] = p.groups || [] })
        return map
    }, [providerList])

    const invalidate = () => queryClient.invalidateQueries({
        queryKey: ['platform', 'support'],
    })

    const onError = (error) => message.error(
        error?.response?.data?.detail
        || 'The routing could not be updated.',
    )

    const setRouting = useMutation({
        mutationFn: ({ tenantId, providerTenantId, groupId }) =>
            platformService.setSupportRouting(tenantId, {
                provider_tenant_id: providerTenantId, group_id: groupId,
            }),
        onSuccess: () => {
            message.success(t('routing.routingUpdated'))
            setPendingTenant(null)
            invalidate()
        },
        onError: (e) => { setPendingTenant(null); onError(e) },
    })

    const disableRouting = useMutation({
        mutationFn: (tenantId) =>
            platformService.disableSupportRouting(tenantId),
        onSuccess: () => {
            message.success(t('routing.raisingDisabled'))
            setPendingTenant(null)
            invalidate()
        },
        onError: (e) => { setPendingTenant(null); onError(e) },
    })

    if (moduleState && moduleState !== 'ok') {
        return (
            <Alert
                type="warning"
                showIcon
                message={t('routing.moduleNotConfigured')}
                description={`Backend reports "${moduleState}". Set the `
                    + 'support workspace id on the core service before '
                    + 'routing tenants.'}
            />
        )
    }

    const columns = [
        {
            title: t('routing.tenant'),
            render: (_, row) => (
                <div>
                    <div>{row.display_name || row.slug}</div>
                    <Text type="secondary">{row.slug}</Text>
                </div>
            ),
        },
        {
            title: t('routing.tenantStatus'), dataIndex: 'tenant_status', width: 130,
            render: (status) => (
                <Tag color={status === 'active' ? 'green' : 'default'}>
                    {status}
                </Tag>
            ),
        },
        {
            title: t('routing.canRaise'), width: 150,
            render: (_, row) => (
                <Switch
                    checked={row.enabled}
                    loading={pendingTenant === row.tenant_id}
                    onChange={(next) => {
                        setPendingTenant(row.tenant_id)
                        if (!next) {
                            disableRouting.mutate(row.tenant_id)
                            return
                        }
                        const provider = row.provider_tenant_id
                            || defaultProvider?.tenant_id
                        const groups = groupsByProvider[provider] || []
                        const group = row.group_id || groups[0]?.id
                        if (!provider || !group) {
                            setPendingTenant(null)
                            message.error(t('routing.noActiveTeam'))
                            return
                        }
                        setRouting.mutate({
                            tenantId: row.tenant_id,
                            providerTenantId: provider, groupId: group,
                        })
                    }}
                />
            ),
        },
        {
            title: t('routing.provider'), width: 220,
            render: (_, row) => (
                <Select
                    style={{ width: '100%' }}
                    disabled={!row.enabled || providerList.length < 2}
                    value={row.provider_tenant_id
                        || defaultProvider?.tenant_id}
                    options={providerList.map((p) => ({
                        value: p.tenant_id,
                        label: p.display_name || p.slug,
                    }))}
                    onChange={(providerTenantId) => {
                        const groups = groupsByProvider[providerTenantId] || []
                        if (!groups.length) {
                            message.error(t('routing.providerNoTeam'))
                            return
                        }
                        setPendingTenant(row.tenant_id)
                        setRouting.mutate({
                            tenantId: row.tenant_id, providerTenantId,
                            groupId: groups[0].id,
                        })
                    }}
                />
            ),
        },
        {
            title: t('routing.team'), width: 240,
            render: (_, row) => {
                const provider = row.provider_tenant_id
                    || defaultProvider?.tenant_id
                const groups = groupsByProvider[provider] || []
                return (
                    <Select
                        style={{ width: '100%' }}
                        disabled={!row.enabled}
                        placeholder={t('routing.notRouted')}
                        value={row.group_id}
                        options={groups.map((g) => ({
                            value: g.id,
                            label: `${g.name} (${g.member_count})`,
                        }))}
                        onChange={(groupId) => {
                            setPendingTenant(row.tenant_id)
                            setRouting.mutate({
                                tenantId: row.tenant_id,
                                providerTenantId: provider, groupId,
                            })
                        }}
                    />
                )
            },
        },
        {
            title: t('routing.route'), dataIndex: 'route_version', width: 90,
            render: (v, row) => (row.enabled ? `v${v ?? 1}` : '—'),
        },
    ]

    return (
        <div>
            <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message={t('routing.routingDecidesWhere')}
                description={'Turning this on routes a tenant’s '
                    + 'tickets to the selected team. Which people inside '
                    + 'that tenant may raise tickets is still decided by '
                    + 'the tenant’s own roles (tickets.access / '
                    + 'tickets.create). Changing a route affects new '
                    + 'tickets only; existing tickets are never moved.'}
            />
            {providerList.length === 1 && (
                <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message={t('routing.oneProvider')}
                    description={
                        'Today every tenant routes to '
                        + (defaultProvider?.display_name
                            || 'the support workspace')
                        + '. The selector is ready for more providers '
                        + 'when they exist.'
                    }
                />
            )}
            <Table
                rowKey="tenant_id"
                size="small"
                loading={routing.isLoading || providers.isLoading}
                dataSource={routing.data ?? []}
                columns={columns}
                pagination={false}
            />
        </div>
    )
}
