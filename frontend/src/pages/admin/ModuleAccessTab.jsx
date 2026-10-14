/**
 * =============================================================================
 * HERMES - Modul erisimi (Ayarlar → Kullanicilar → Modul erisimi)
 * =============================================================================
 * docs/tenant-platform/01 — RBAC'in modul karsiligi. Her ACIK modul icin:
 *   "Herkes" (tum calisanlar; varsayilan) ve/veya secili sirketler, gruplar,
 *   kullanicilar. Sirketler "Herkes"e DAHIL DEGILDIR. Yoneticiler (system-
 *   admin) her modulu gorur. Her degisiklik aninda kaydedilir; etkisi
 *   onbellekler nedeniyle en gec ~1-2 dk icinde gorulur.
 *
 * Tasarim Kullanicilar/Gruplar sekmeleriyle AYNI: kart basligi, tablo,
 * `lq-tag` rozetleri; modul basina bir satir.
 * =============================================================================
 */
import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, Select, Space, Switch, Table, message } from 'antd'
import { BankOutlined, CloseOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons'

import { companyService, moduleAccessService } from '../../api/companyApi'
import { authService, userGroupService } from '../../services/api'
import { AdminErrorAlert } from '../../features/admin/shared/AdminListStates'
import { normalizeApiError } from '../../features/admin/shared/normalizeApiError'
import { MODULES } from '../../features/modules/catalog'
import { queryKeys } from '../../query/queryKeys'
import { useT } from '../../i18n'

const KEY = ['admin-module-access']
const TYPE_ICON = { company: <BankOutlined />, group: <TeamOutlined />, user: <UserOutlined /> }
const TYPE_TONE = { company: 'lq-tag--violet', group: 'lq-tag--info', user: 'lq-tag--ok' }

export default function ModuleAccessTab() {
    const t = useT()
    const queryClient = useQueryClient()
    const policies = useQuery({ queryKey: KEY, queryFn: moduleAccessService.list })
    const companies = useQuery({ queryKey: ['admin-companies'], queryFn: companyService.list, retry: false })
    const groups = useQuery({ queryKey: ['admin-user-groups'], queryFn: () => userGroupService.list(), retry: false })
    const users = useQuery({ queryKey: queryKeys.users.lookup, queryFn: () => authService.lookupUsers() })
    const principals = useMemo(() => {
        const comps = (companies.data ?? []).map((c) => ({ key: `user:${c.id}`, kind: 'company', type: 'user', id: c.id, label: c.name }))
        const companyIds = new Set(comps.map((c) => c.id))
        const grps = (Array.isArray(groups.data) ? groups.data : []).filter((g) => g.is_active !== false)
            .map((g) => ({ key: `group:${g.id}`, kind: 'group', type: 'group', id: g.id, label: g.name }))
        const ppl = (Array.isArray(users.data) ? users.data : []).filter((u) => !companyIds.has(u.id))
            .map((u) => ({ key: `user:${u.id}`, kind: 'user', type: 'user', id: u.id, label: u.full_name || u.email }))
        const all = [...comps, ...grps, ...ppl]
        return { companies: comps, groups: grps, users: ppl, byKey: Object.fromEntries(all.map((p) => [p.key, p])) }
    }, [companies.data, groups.data, users.data])
    const save = useMutation({
        mutationFn: ({ module, body }) => moduleAccessService.set(module, body),
        onSuccess: (data) => { queryClient.setQueryData(KEY, data); message.success(t('moduleAccess.saved')) },
        onError: (err) => message.error(normalizeApiError(err).message),
    })

    const chosenOf = (row) => row.grants.map((g) => principals.byKey[`${g.type}:${g.id}`]
        ?? { key: `${g.type}:${g.id}`, kind: g.type, type: g.type, id: g.id, label: t('moduleAccess.unknown') })
    const toGrants = (items) => items.map((c) => ({ type: c.type, id: c.id }))
    const moduleName = (code) => t(MODULES[code]?.labelKey ?? code)

    const columns = [
        {
            title: t('moduleAccess.module'), dataIndex: 'module', key: 'module', width: 220,
            render: (code, row) => (
                <span className="users-person__text">
                    <b>{moduleName(code)}</b>
                    <small>{row.everyone
                        ? (row.grants.length ? t('moduleAccess.everyonePlus') : t('moduleAccess.everyoneOnly'))
                        : (row.grants.length ? t('moduleAccess.selectedOnly') : t('moduleAccess.nobody'))}</small>
                </span>
            ),
        },
        {
            title: t('moduleAccess.everyone'), dataIndex: 'everyone', key: 'everyone', width: 110,
            render: (on, row) => (
                <Switch
                    checked={on}
                    loading={save.isPending && save.variables?.module === row.module}
                    aria-label={t('moduleAccess.everyoneFor', { module: moduleName(row.module) })}
                    onChange={(next) => save.mutate({ module: row.module, body: { everyone: next, grants: toGrants(chosenOf(row)) } })}
                />
            ),
        },
        {
            title: t('moduleAccess.access'), key: 'grants',
            render: (_, row) => {
                const chosen = chosenOf(row)
                const chosenKeys = new Set(chosen.map((c) => c.key))
                const options = [
                    { label: t('moduleAccess.companies'), options: principals.companies },
                    { label: t('moduleAccess.groups'), options: principals.groups },
                    { label: t('moduleAccess.users'), options: principals.users },
                ].map((grp) => ({ ...grp, options: grp.options.filter((o) => !chosenKeys.has(o.key)).map((o) => ({ value: o.key, label: o.label })) }))
                    .filter((grp) => grp.options.length)
                return (
                    <Space size={6} wrap>
                        {chosen.map((c) => (
                            <span key={c.key} className={`lq-tag ${TYPE_TONE[c.kind] ?? ''} ma-chip`}>
                                {TYPE_ICON[c.kind]}{c.label}
                                <button
                                    type="button" className="ma-chip__remove"
                                    aria-label={t('moduleAccess.removeFrom', { name: c.label, module: moduleName(row.module) })}
                                    onClick={() => save.mutate({ module: row.module, body: { everyone: row.everyone, grants: toGrants(chosen.filter((x) => x.key !== c.key)) } })}
                                ><CloseOutlined /></button>
                            </span>
                        ))}
                        <Select
                            size="small" showSearch value={null} placeholder={t('moduleAccess.add')}
                            aria-label={t('moduleAccess.addFor', { module: moduleName(row.module) })}
                            className="ma-add" options={options} optionFilterProp="label" popupMatchSelectWidth={260}
                            onChange={(key) => {
                                const p = principals.byKey[key]
                                if (p) save.mutate({ module: row.module, body: { everyone: row.everyone, grants: [...toGrants(chosen), { type: p.type, id: p.id }] } })
                            }}
                        />
                    </Space>
                )
            },
        },
    ]

    return (
        <>
            <AdminErrorAlert error={policies.isError ? policies.error : null} onRetry={policies.refetch} />
            <Card variant="borderless" title={t('moduleAccess.title')}>
                <p className="companies-hint">{t('moduleAccess.hint')}</p>
                <Table
                    dataSource={policies.data ?? []}
                    columns={columns}
                    rowKey="module"
                    loading={policies.isLoading}
                    pagination={false}
                    scroll={{ x: 'max-content' }}
                />
            </Card>
        </>
    )
}
