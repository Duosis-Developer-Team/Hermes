/**
 * =============================================================================
 * HERMES - Kiraci listesi (super-admin, Faz 2)
 * =============================================================================
 * Arama (ad / kisa ad, TR karakter duyarsiz), durum filtresi, modul
 * rozetleri. Satira tiklayinca kiraci detayi acilir. Yalniz METADATA —
 * hicbir kiraci is verisi bu duzlemde gorunmez.
 * =============================================================================
 */
import { useEffect, useMemo, useState } from 'react'
import { Button, Empty, Input, Select, Table, message } from 'antd'
import { PlusOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

import { platformService } from '../../api/platformApi'
import { GlassCard } from '../../components/liquid'
import { usePlatformAuthStore } from '../../stores/platformAuthStore'
import { matchesAny } from '../../utils/searchText'
import { useT } from '../../i18n'
import { ModuleBadges } from './ModulePicker'
import { CreateTenantModal } from './TenantWizard'
import './platform.css'

/** Durum → ton + METIN (renk tek basina anlam tasimaz). */
export const STATUS_TONE = {
    active: 'ok', provisioning: 'info', grace: 'warn', suspended: 'bad',
    deprovisioning: 'warn', failed: 'bad', archived: 'muted',
}

export function TenantStatus({ status }) {
    const t = useT()
    return (
        <span className={`lq-tag lq-tag--${STATUS_TONE[status] || 'muted'}`}>
            {t(`platform.status.${status}`)}
        </span>
    )
}

export function TenantMark({ name }) {
    return (
        <span className="pc-tenant__mark" aria-hidden="true">
            {(name || '?').trim().charAt(0).toLocaleUpperCase('tr')}
        </span>
    )
}

export function useTenants() {
    const t = useT()
    const [rows, setRows] = useState([])
    const [loading, setLoading] = useState(true)
    const reload = () => {
        setLoading(true)
        return platformService.listTenants({ limit: 100 })
            .then((d) => setRows(d.tenants || []))
            .catch(() => message.error(t('platform.loadTenantsFailed')))
            .finally(() => setLoading(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { reload() }, [])
    return { rows, loading, reload }
}

function TenantList({ onOpen }) {
    const t = useT()
    const can = usePlatformAuthStore((s) => s.can)
    const { rows, loading, reload } = useTenants()
    const [query, setQuery] = useState('')
    const [status, setStatus] = useState(null)
    const [creating, setCreating] = useState(false)

    const visible = useMemo(() => rows.filter((r) =>
        (!status || r.status === status) && matchesAny([r.display_name, r.slug], query)),
    [rows, query, status])

    const columns = [
        {
            title: t('platform.organization'), dataIndex: 'display_name', key: 'name',
            sorter: (a, b) => a.display_name.localeCompare(b.display_name, 'tr'),
            render: (name, row) => (
                <span className="pc-tenant">
                    <TenantMark name={name} />
                    <span className="pc-tenant__text"><b>{name}</b><small>{row.slug}</small></span>
                </span>
            ),
        },
        { title: t('common.status'), dataIndex: 'status', key: 'status', render: (s) => <TenantStatus status={s} /> },
        {
            title: t('platform.modulesTitle'), dataIndex: 'modules', key: 'modules',
            render: (mods) => <ModuleBadges modules={mods || []} />,
        },
        {
            title: t('platform.members'), dataIndex: 'active_members', key: 'members', align: 'right',
            sorter: (a, b) => (a.active_members || 0) - (b.active_members || 0),
        },
        {
            title: t('platform.createdAt'), dataIndex: 'created_at', key: 'created', responsive: ['lg'],
            render: (v) => (v ? dayjs(v).format('D MMM YYYY') : '—'),
            sorter: (a, b) => String(a.created_at).localeCompare(String(b.created_at)),
        },
    ]

    return (
        <>
            <div className="pc-toolbar">
                <Input
                    className="pc-toolbar__search"
                    allowClear
                    prefix={<SearchOutlined aria-hidden="true" />}
                    placeholder={t('platform.searchTenants')}
                    aria-label={t('platform.searchTenants')}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
                <Select
                    allowClear
                    style={{ minWidth: 170 }}
                    placeholder={t('platform.allStatuses')}
                    aria-label={t('common.status')}
                    value={status}
                    onChange={setStatus}
                    options={Object.keys(STATUS_TONE).map((s) => ({ value: s, label: t(`platform.status.${s}`) }))}
                />
                <span className="pc-toolbar__spacer" />
                {can('platform.tenants.manage') && (
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
                        {t('platform.newTenant')}
                    </Button>
                )}
            </div>
            <GlassCard className="lq-card--flush lq-enter">
                <Table
                    rowKey="id"
                    columns={columns}
                    dataSource={visible}
                    loading={loading && rows.length === 0}
                    size="middle"
                    pagination={{ pageSize: 20, hideOnSinglePage: true }}
                    scroll={{ x: 'max-content' }}
                    onRow={(row) => ({ onClick: () => onOpen(row.id), className: 'pc-row' })}
                    locale={{ emptyText: <Empty description={t('platform.noTenants')} /> }}
                />
            </GlassCard>
            <CreateTenantModal
                open={creating}
                onClose={() => setCreating(false)}
                onDone={() => { setCreating(false); reload() }}
            />
        </>
    )
}

export default TenantList
