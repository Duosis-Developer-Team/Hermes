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
 * Tasarim: modul basina bir cam kart (GlassCard), iki sutunlu izgara
 * (alti modul = 2x3). Kart basligi pencerelerdeki ikonlu baslikla ayni
 * (ModalHead); erisim `lq-tag` cipleri.
 * =============================================================================
 */
import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Select, Skeleton, Switch, message } from 'antd'
import {
    BankOutlined, BarChartOutlined, CalendarOutlined, CheckSquareOutlined, ClockCircleOutlined,
    CloseOutlined, CodeOutlined, CustomerServiceOutlined, TeamOutlined, UserOutlined,
} from '@ant-design/icons'

import { companyService, moduleAccessService } from '../../api/companyApi'
import { authService, userGroupService } from '../../services/api'
import { AdminErrorAlert } from '../../features/admin/shared/AdminListStates'
import { normalizeApiError } from '../../features/admin/shared/normalizeApiError'
import { MODULES } from '../../features/modules/catalog'
import { GlassCard, ModalHead } from '../../components/liquid'
import { queryKeys } from '../../query/queryKeys'
import { useT } from '../../i18n'

const KEY = ['admin-module-access']
const TYPE_ICON = { company: <BankOutlined />, group: <TeamOutlined />, user: <UserOutlined /> }
const TYPE_TONE = { company: 'lq-tag--violet', group: 'lq-tag--info', user: 'lq-tag--ok' }
// Modul basina ikon + ton (dock'taki uygulama renkleriyle ayni aile).
const MODULE_LOOK = {
    time_entry: { icon: <ClockCircleOutlined />, tone: 'green' },
    work: { icon: <CheckSquareOutlined />, tone: 'blue' },
    meetings: { icon: <CalendarOutlined />, tone: 'violet' },
    tickets: { icon: <CustomerServiceOutlined />, tone: 'red' },
    reports: { icon: <BarChartOutlined />, tone: 'amber' },
    developer: { icon: <CodeOutlined />, tone: 'ink' },
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

    const chosenOf = (row) => row.grants.map((g) => principals.byKey[`${g.type}:${g.id}`]
        ?? { key: `${g.type}:${g.id}`, kind: g.type, type: g.type, id: g.id, label: t('moduleAccess.unknown') })
    const toGrants = (items) => items.map((c) => ({ type: c.type, id: c.id }))
    const moduleName = (code) => t(MODULES[code]?.labelKey ?? code)

    const summaryOf = (row) => (row.everyone
        ? (row.grants.length ? t('moduleAccess.everyonePlus') : t('moduleAccess.everyoneOnly'))
        : (row.grants.length ? t('moduleAccess.selectedOnly') : t('moduleAccess.nobody')))

    const card = (row) => {
        const chosen = chosenOf(row)
        const chosenKeys = new Set(chosen.map((c) => c.key))
        const options = [
            { label: t('moduleAccess.companies'), options: principals.companies },
            { label: t('moduleAccess.groups'), options: principals.groups },
            { label: t('moduleAccess.users'), options: principals.users },
        ].map((grp) => ({ ...grp, options: grp.options.filter((o) => !chosenKeys.has(o.key)).map((o) => ({ value: o.key, label: o.label })) }))
            .filter((grp) => grp.options.length)
        const look = MODULE_LOOK[row.module] ?? { icon: null, tone: 'blue' }
        const busy = save.isPending && save.variables?.module === row.module
        return (
            <GlassCard key={row.module} className="ma-card">
                <div className="ma-card__head">
                    <ModalHead icon={look.icon} tone={look.tone} title={moduleName(row.module)} subtitle={summaryOf(row)} />
                    <label className="ma-everyone">
                        <span>{t('moduleAccess.everyone')}</span>
                        <Switch
                            checked={row.everyone}
                            loading={busy}
                            aria-label={t('moduleAccess.everyoneFor', { module: moduleName(row.module) })}
                            onChange={(next) => save.mutate({ module: row.module, body: { everyone: next, grants: toGrants(chosen) } })}
                        />
                    </label>
                </div>
                <div className="ma-chips">
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
                        disabled={busy}
                        onChange={(key) => {
                            const p = principals.byKey[key]
                            if (p) save.mutate({ module: row.module, body: { everyone: row.everyone, grants: [...toGrants(chosen), { type: p.type, id: p.id }] } })
                        }}
                    />
                </div>
            </GlassCard>
        )
    }

    return (
        <div className="ma-tab">
            <AdminErrorAlert error={policies.isError ? policies.error : null} onRetry={policies.refetch} />
            <p className="companies-hint">{t('moduleAccess.hint')}</p>
            {policies.isLoading
                ? <Skeleton active paragraph={{ rows: 6 }} />
                : <div className="ma-grid">{(policies.data ?? []).map(card)}</div>}
        </div>
    )
}
