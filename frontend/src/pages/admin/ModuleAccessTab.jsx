/**
 * =============================================================================
 * HERMES - Modul erisimi (Ayarlar → Kullanicilar → Modul erisimi)
 * =============================================================================
 * docs/tenant-platform/01 — RBAC'in modul karsiligi. Her ACIK modul icin:
 *   "Herkes" (tum calisanlar; varsayilan) ve/veya secili sirketler, gruplar,
 *   kullanicilar. Sirketler "Herkes"e DAHIL DEGILDIR. Yoneticiler (system-
 *   admin) her modulu gorur. Her degisiklik aninda kaydedilir; etkisi
 *   onbellekler nedeniyle en gec ~1-2 dk icinde gorulur.
 * =============================================================================
 */
import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Select, Skeleton, Switch, Tag, message } from 'antd'
import { AppstoreOutlined, BankOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons'

import { companyService, moduleAccessService } from '../../api/companyApi'
import { authService, userGroupService } from '../../services/api'
import { normalizeApiError } from '../../features/admin/shared/normalizeApiError'
import { queryKeys } from '../../query/queryKeys'
import { MODULES } from '../../features/modules/catalog'
import { useT } from '../../i18n'

const KEY = ['admin-module-access']
const TYPE_ICON = { company: <BankOutlined />, group: <TeamOutlined />, user: <UserOutlined /> }

function ModuleCard({ row, principals, onChange, saving }) {
    const t = useT()
    const chosen = row.grants.map((g) => principals.byKey[`${g.type}:${g.id}`]
        ?? { key: `${g.type}:${g.id}`, kind: g.type, type: g.type, id: g.id, label: t('moduleAccess.unknown') })
    const chosenKeys = new Set(chosen.map((c) => c.key))
    const options = [
        { label: t('moduleAccess.companies'), options: principals.companies },
        { label: t('moduleAccess.groups'), options: principals.groups },
        { label: t('moduleAccess.users'), options: principals.users },
    ].map((grp) => ({ ...grp, options: grp.options.filter((o) => !chosenKeys.has(o.key)).map((o) => ({ value: o.key, label: o.label })) }))
        .filter((grp) => grp.options.length)
    const toGrants = (items) => items.map((c) => ({ type: c.type, id: c.id }))
    return (
        <section className="ma-card">
            <header>
                <b>{t(MODULES[row.module]?.labelKey ?? row.module)}</b>
                <label className="ma-everyone">
                    <Switch size="small" checked={row.everyone} loading={saving}
                            aria-label={t('moduleAccess.everyoneFor', { module: t(MODULES[row.module]?.labelKey ?? row.module) })}
                            onChange={(on) => onChange({ everyone: on, grants: toGrants(chosen) })} />
                    <span>{t('moduleAccess.everyone')}</span>
                </label>
            </header>
            <p className="ma-summary">
                {row.everyone
                    ? (chosen.length ? t('moduleAccess.everyonePlus') : t('moduleAccess.everyoneOnly'))
                    : (chosen.length ? t('moduleAccess.selectedOnly') : t('moduleAccess.nobody'))}
            </p>
            <div className="ma-chips">
                {chosen.map((c) => (
                    <Tag key={c.key} icon={TYPE_ICON[c.kind]} closable
                         onClose={(e) => { e.preventDefault(); onChange({ everyone: row.everyone, grants: toGrants(chosen.filter((x) => x.key !== c.key)) }) }}>
                        {c.label}
                    </Tag>
                ))}
                <Select
                    size="small" showSearch value={null} placeholder={t('moduleAccess.add')}
                    aria-label={t('moduleAccess.addFor', { module: t(MODULES[row.module]?.labelKey ?? row.module) })}
                    className="ma-add" options={options} optionFilterProp="label" disabled={saving}
                    onChange={(key) => {
                        const p = principals.byKey[key]
                        if (p) onChange({ everyone: row.everyone, grants: [...toGrants(chosen), { type: p.type, id: p.id }] })
                    }}
                />
            </div>
        </section>
    )
}

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

    if (policies.isLoading) return <Skeleton active paragraph={{ rows: 6 }} />
    if (policies.isError) return <Alert type="error" showIcon message={normalizeApiError(policies.error).message} />
    return (
        <div className="ma-tab">
            <Alert type="info" showIcon icon={<AppstoreOutlined />} message={t('moduleAccess.hint')} />
            <div className="ma-grid">
                {(policies.data ?? []).map((row) => (
                    <ModuleCard
                        key={row.module} row={row} principals={principals}
                        saving={save.isPending && save.variables?.module === row.module}
                        onChange={(body) => save.mutate({ module: row.module, body })}
                    />
                ))}
            </div>
        </div>
    )
}
