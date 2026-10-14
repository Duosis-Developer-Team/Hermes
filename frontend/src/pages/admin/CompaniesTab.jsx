/**
 * =============================================================================
 * HERMES - Sirket hesaplari (Ayarlar → Kullanicilar → Sirketler)
 * =============================================================================
 * docs/tenant-platform/01. Sirket hesabi, dis musteriye (ornegin Defacto)
 * verilen TEK giris hesabidir: kullanici listesinde degil burada durur,
 * rol almaz ve yalniz secilen modulleri gorur. Talep acabilmesi icin destek
 * ekibi secilmelidir (musteri kaydi core'da, adiyla birlikte yazilir).
 * Hesap auth'ta (users.manage), destek ekibi core'da — kayit iki adimdir.
 * =============================================================================
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Checkbox, Input, Modal, Select, Switch, Table, Tag, Typography, message } from 'antd'
import { BankOutlined, KeyOutlined, PlusOutlined } from '@ant-design/icons'

import { companyService } from '../../api/companyApi'
import { userGroupService } from '../../services/api'
import { Button, StatusBadge } from '../../components/ui'
import { ModalHead } from '../../components/liquid'
import { normalizeApiError } from '../../features/admin/shared/normalizeApiError'
import { MODULE_CODES, MODULES } from '../../features/modules/catalog'
import { useAuthStore } from '../../stores/authStore'
import { useT } from '../../i18n'

const KEY = ['admin-companies']
const SUPPORT_KEY = ['admin-company-support']
const EMPTY = { name: '', email: '', password: '', modules: ['tickets'], group_id: null, is_active: true }

function CompanyModal({ company, support, groups, provider, tenantModules, onClose, onSaved }) {
    const t = useT()
    const isNew = !company.id
    const [draft, setDraft] = useState(() => (isNew ? EMPTY : {
        name: company.name, email: company.email, password: '', modules: company.modules,
        group_id: support?.group_id ?? null, is_active: company.is_active,
    }))
    const [error, setError] = useState(null)
    const patch = (p) => setDraft((d) => ({ ...d, ...p }))
    const save = useMutation({
        mutationFn: async () => {
            const saved = isNew
                ? await companyService.create({
                    name: draft.name.trim(), email: draft.email.trim(), password: draft.password, modules: draft.modules,
                })
                : await companyService.update(company.id, {
                    name: draft.name.trim(), modules: draft.modules, is_active: draft.is_active,
                })
            const wantsSupport = provider && draft.modules.includes('tickets') && draft.group_id
            if (wantsSupport && (draft.group_id !== support?.group_id || draft.name.trim() !== support?.display_name)) {
                await companyService.setSupport(saved.id, { display_name: draft.name.trim(), group_id: draft.group_id })
            }
            return saved
        },
        onSuccess: () => { message.success(t('companies.saved')); onSaved(); onClose() },
        onError: (err) => setError(normalizeApiError(err).message),
    })
    const valid = draft.name.trim().length >= 2 && (!isNew || (draft.email.includes('@') && draft.password.length >= 8))
    return (
        <Modal
            open
            onCancel={onClose}
            onOk={() => { setError(null); save.mutate() }}
            okText={t('common.save')}
            okButtonProps={{ loading: save.isPending, disabled: !valid }}
            title={<ModalHead icon={<BankOutlined />} tone="blue" title={isNew ? t('companies.new') : t('companies.edit')} />}
            width={600}
            destroyOnHidden
        >
            <div className="pc-form">
                <label className="sla-field"><span>{t('companies.name')}</span>
                    <Input value={draft.name} maxLength={120} placeholder="Defacto" aria-label={t('companies.name')}
                           onChange={(e) => patch({ name: e.target.value })} />
                </label>
                <label className="sla-field"><span>{t('companies.loginEmail')}</span>
                    <Input value={draft.email} disabled={!isNew} placeholder="destek@sirket.com" aria-label={t('companies.loginEmail')}
                           onChange={(e) => patch({ email: e.target.value })} />
                </label>
                {isNew && (
                    <label className="sla-field"><span>{t('companies.password')}</span>
                        <Input.Password value={draft.password} aria-label={t('companies.password')}
                                        onChange={(e) => patch({ password: e.target.value })} />
                        <small className="lq-note">{t('companies.passwordHint')}</small>
                    </label>
                )}
                <div className="sla-field"><span>{t('companies.modules')}</span>
                    <Checkbox.Group
                        value={draft.modules}
                        onChange={(v) => patch({ modules: v })}
                        options={MODULE_CODES.filter((m) => tenantModules.includes(m))
                            .map((m) => ({ value: m, label: t(MODULES[m].labelKey) }))}
                    />
                </div>
                {draft.modules.includes('tickets') && (
                    <label className="sla-field"><span>{t('companies.supportTeam')}</span>
                        {provider ? (
                            <Select allowClear value={draft.group_id} onChange={(v) => patch({ group_id: v || null })}
                                    aria-label={t('companies.supportTeam')} placeholder={t('companies.pickTeam')}
                                    options={groups.map((g) => ({ value: g.id, label: g.name }))} />
                        ) : <Alert type="info" showIcon message={t('companies.notProvider')} />}
                        <small className="lq-note">{t('companies.supportHint')}</small>
                    </label>
                )}
                {!isNew && (
                    <label className="companies-active">
                        <Switch checked={draft.is_active} onChange={(v) => patch({ is_active: v })}
                                aria-label={t('companies.active')} />
                        <span>{t('companies.active')}</span>
                    </label>
                )}
                {error && <Alert type="error" showIcon message={error} />}
            </div>
        </Modal>
    )
}

function PasswordModal({ company, onClose }) {
    const t = useT()
    const [password, setPassword] = useState('')
    const reset = useMutation({
        mutationFn: () => companyService.resetPassword(company.id, password),
        onSuccess: () => { message.success(t('companies.passwordReset')); onClose() },
        onError: (err) => message.error(normalizeApiError(err).message),
    })
    return (
        <Modal open onCancel={onClose} onOk={() => reset.mutate()} okText={t('common.save')}
               okButtonProps={{ loading: reset.isPending, disabled: password.length < 8 }}
               title={<ModalHead icon={<KeyOutlined />} tone="amber" title={t('companies.resetPasswordFor', { name: company.name })} />}
               destroyOnHidden>
            <label className="sla-field"><span>{t('companies.newPassword')}</span>
                <Input.Password value={password} onChange={(e) => setPassword(e.target.value)}
                                aria-label={t('companies.newPassword')} />
                <small className="lq-note">{t('companies.passwordResetHint')}</small>
            </label>
        </Modal>
    )
}

export default function CompaniesTab() {
    const t = useT()
    const queryClient = useQueryClient()
    const tenant = useAuthStore((s) => s.tenant)
    const tenantModules = Array.isArray(tenant?.modules) ? tenant.modules : MODULE_CODES
    const companies = useQuery({ queryKey: KEY, queryFn: companyService.list })
    const ticketsOn = tenantModules.includes('tickets')
    const support = useQuery({ queryKey: SUPPORT_KEY, queryFn: companyService.supportList, enabled: ticketsOn, retry: false })
    const groups = useQuery({ queryKey: ['admin-user-groups', 'company-picker'], queryFn: () => userGroupService.list(), enabled: ticketsOn, retry: false })
    const [editing, setEditing] = useState(null)
    const [resetting, setResetting] = useState(null)
    const supportBy = useMemo(
        () => Object.fromEntries((support.data?.items ?? []).map((s) => [s.account_id, s])),
        [support.data],
    )
    const refresh = () => {
        queryClient.invalidateQueries({ queryKey: KEY })
        queryClient.invalidateQueries({ queryKey: SUPPORT_KEY })
    }
    const provider = Boolean(support.data?.provider)
    const groupRows = (Array.isArray(groups.data) ? groups.data : groups.data?.items ?? []).filter((g) => g.is_active !== false)

    const columns = [
        {
            title: t('companies.name'), dataIndex: 'name',
            render: (name, row) => (
                <span className="companies-name"><b>{name}</b><small>{row.email}</small></span>
            ),
        },
        {
            title: t('companies.modules'), dataIndex: 'modules',
            render: (mods) => (mods.length
                ? mods.map((m) => <Tag key={m}>{t(MODULES[m]?.labelKey ?? m)}</Tag>)
                : <Typography.Text type="secondary">{t('companies.noModules')}</Typography.Text>),
        },
        {
            title: t('companies.supportTeam'), key: 'support',
            render: (_, row) => {
                if (!row.modules.includes('tickets')) return '—'
                const s = supportBy[row.id]
                return s?.configured
                    ? s.group_name
                    : <StatusBadge tone="warning">{t('companies.teamMissing')}</StatusBadge>
            },
        },
        {
            title: t('companies.status'), dataIndex: 'is_active',
            render: (on) => <StatusBadge tone={on ? 'success' : 'neutral'}>{on ? t('companies.activeShort') : t('companies.inactive')}</StatusBadge>,
        },
        {
            title: '', key: 'actions', align: 'right',
            render: (_, row) => (
                <span className="companies-actions">
                    <Button size="small" onClick={() => setEditing(row)}>{t('common.edit')}</Button>
                    <Button size="small" icon={<KeyOutlined />} onClick={() => setResetting(row)}
                            aria-label={t('companies.resetPasswordFor', { name: row.name })} />
                </span>
            ),
        },
    ]

    return (
        <div className="companies-tab">
            <div className="companies-head">
                <p>{t('companies.hint')}</p>
                <Button variant="primary" icon={<PlusOutlined />} onClick={() => setEditing({})}>{t('companies.new')}</Button>
            </div>
            <Table
                rowKey="id"
                loading={companies.isLoading}
                dataSource={companies.data ?? []}
                columns={columns}
                pagination={false}
                locale={{ emptyText: t('companies.empty') }}
                scroll={{ x: 640 }}
            />
            {editing && (
                <CompanyModal
                    company={editing} support={supportBy[editing.id]} groups={groupRows} provider={provider}
                    tenantModules={tenantModules} onClose={() => setEditing(null)} onSaved={refresh}
                />
            )}
            {resetting && <PasswordModal company={resetting} onClose={() => setResetting(null)} />}
        </div>
    )
}
