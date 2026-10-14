/**
 * =============================================================================
 * HERMES - Sirket hesaplari (Ayarlar → Kullanicilar → Sirketler)
 * =============================================================================
 * docs/tenant-platform/01. Sirket hesabi, dis musteriye (ornegin Defacto)
 * verilen TEK giris hesabidir: kullanici listesinde degil burada durur,
 * rol almaz ve yalniz secilen modulleri gorur. Talep acabilmesi icin destek
 * ekibi secilmelidir (musteri kaydi core'da, adiyla birlikte yazilir).
 *
 * Tasarim Kullanicilar sekmesiyle BIREBIR ayni: kart basligi + sayi, arama
 * ve "Yeni" dugmesi; tabloda logo + ad + e-posta hucresi, `lq-tag` rozetleri,
 * yalniz ikonlu islem dugmeleri; ayni modal (ModalHead + dikey form +
 * `lq-mf` alt satiri). Logo alani musteri formundakinin aynisidir.
 * Hesap auth'ta (users.manage); destek ekibi ve logo core'da.
 * =============================================================================
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
    Alert, Button, Card, Checkbox, Form, Input, Modal, Select, Space, Switch, Table, message,
} from 'antd'
import { BankOutlined, EditOutlined, KeyOutlined, LockOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'

import { companyService } from '../../api/companyApi'
import { userGroupService } from '../../services/api'
import { CompanyLogo, ModalHead } from '../../components/liquid'
import { normalizeApiError } from '../../features/admin/shared/normalizeApiError'
import {
    AdminEmptyState, AdminErrorAlert, AdminRefreshHint,
} from '../../features/admin/shared/AdminListStates'
import { MODULE_CODES, MODULES } from '../../features/modules/catalog'
import { useAuthStore } from '../../stores/authStore'
import { useT } from '../../i18n'
import { matchesAny } from '../../utils/searchText'
import CustomerLogoField, { EMPTY_LOGO_DRAFT } from './CustomerLogoField'

const KEY = ['admin-companies']
const SUPPORT_KEY = ['admin-company-support']
const LOGOS_KEY = ['admin-company-logos']

function CompanyModal({ company, support, logoEtag, groups, provider, tenantModules, onClose, onSaved }) {
    const t = useT()
    const [form] = Form.useForm()
    const isNew = !company.id
    const [logoDraft, setLogoDraft] = useState(EMPTY_LOGO_DRAFT)
    const [error, setError] = useState(null)
    const initial = isNew
        ? { name: '', email: '', password: '', modules: ['tickets'], group_id: undefined, is_active: true }
        : { name: company.name, email: company.email, modules: company.modules,
            group_id: support?.group_id ?? undefined, is_active: company.is_active }
    const save = useMutation({
        mutationFn: async (values) => {
            const name = values.name.trim()
            const saved = isNew
                ? await companyService.create({ name, email: values.email.trim(), password: values.password, modules: values.modules })
                : await companyService.update(company.id, { name, modules: values.modules, is_active: values.is_active })
            const wantsSupport = provider && values.modules.includes('tickets') && values.group_id
            if (wantsSupport && (values.group_id !== support?.group_id || name !== support?.display_name)) {
                await companyService.setSupport(saved.id, { display_name: name, group_id: values.group_id })
            }
            // Logo hesap kaydindan SONRA; basarisizsa hesap kalir, uyari verilir.
            try {
                if (logoDraft.file) await companyService.uploadLogo(saved.id, logoDraft.file)
                else if (logoDraft.remove) await companyService.deleteLogo(saved.id)
            } catch (err) {
                message.warning(normalizeApiError(err).message)
            }
            return saved
        },
        onSuccess: () => { message.success(t('companies.saved')); onSaved(); onClose() },
        onError: (err) => setError(normalizeApiError(err).message),
    })
    const modules = Form.useWatch('modules', form) ?? initial.modules
    return (
        <Modal
            title={<ModalHead icon={<BankOutlined />} tone="blue" title={isNew ? t('companies.new') : t('companies.edit')} />}
            open onCancel={onClose} footer={null} destroyOnHidden
        >
            <Form form={form} layout="vertical" initialValues={initial}
                  onFinish={(values) => { setError(null); save.mutate(values) }}>
                <Form.Item noStyle shouldUpdate={(a, b) => a.name !== b.name}>
                    {({ getFieldValue }) => (
                        <CustomerLogoField
                            Logo={CompanyLogo}
                            record={isNew ? null : { id: company.id, name: company.name, has_logo: Boolean(logoEtag), logo_etag: logoEtag }}
                            name={getFieldValue('name')}
                            draft={logoDraft}
                            onChange={setLogoDraft}
                        />
                    )}
                </Form.Item>
                <Form.Item name="name" label={t('companies.name')} rules={[{ required: true, min: 2, message: t('companies.nameRequired') }]}>
                    <Input placeholder="Defacto" maxLength={120} />
                </Form.Item>
                <Form.Item name="email" label={t('companies.loginEmail')} rules={[{ required: true, type: 'email', message: t('users.emailInvalid') }]}>
                    <Input placeholder="destek@sirket.com" disabled={!isNew} />
                </Form.Item>
                {isNew && (
                    <Form.Item name="password" label={t('companies.password')} extra={t('companies.passwordHint')}
                               rules={[{ required: true, min: 8, message: t('companies.passwordHint') }]}>
                        <Input.Password />
                    </Form.Item>
                )}
                {!isNew && (
                    <Form.Item name="is_active" label={t('common.status')} valuePropName="checked">
                        <Switch checkedChildren={t('common.active')} unCheckedChildren={t('common.inactive')} />
                    </Form.Item>
                )}
                <Form.Item name="modules" label={t('companies.modules')}>
                    <Checkbox.Group
                        options={MODULE_CODES.filter((m) => tenantModules.includes(m))
                            .map((m) => ({ value: m, label: t(MODULES[m].labelKey) }))}
                    />
                </Form.Item>
                {modules.includes('tickets') && (
                    <Form.Item name="group_id" label={t('companies.supportTeam')} extra={t('companies.supportHint')}>
                        {provider ? (
                            <Select allowClear placeholder={t('companies.pickTeam')}
                                    options={groups.map((g) => ({ value: g.id, label: g.name }))} />
                        ) : <Alert type="info" showIcon message={t('companies.notProvider')} />}
                    </Form.Item>
                )}
                {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
                <div className="lq-mf">
                    <Button onClick={onClose}>{t('common.cancel')}</Button>
                    <Button type="primary" htmlType="submit" loading={save.isPending}>
                        {isNew ? t('common.create') : t('admin.update')}
                    </Button>
                </div>
            </Form>
        </Modal>
    )
}

function PasswordModal({ company, onClose }) {
    const t = useT()
    const [form] = Form.useForm()
    const reset = useMutation({
        mutationFn: ({ password }) => companyService.resetPassword(company.id, password),
        onSuccess: () => { message.success(t('companies.passwordReset')); onClose() },
        onError: (err) => message.error(normalizeApiError(err).message),
    })
    return (
        <Modal
            title={<ModalHead icon={<KeyOutlined />} tone="amber" title={t('companies.resetPasswordFor', { name: company.name })} />}
            open onCancel={onClose} footer={null} destroyOnHidden
        >
            <Form form={form} layout="vertical" onFinish={(values) => reset.mutate(values)}>
                <Form.Item name="password" label={t('companies.newPassword')} extra={t('companies.passwordResetHint')}
                           rules={[{ required: true, min: 8, message: t('companies.passwordHint') }]}>
                    <Input.Password />
                </Form.Item>
                <div className="lq-mf">
                    <Button onClick={onClose}>{t('common.cancel')}</Button>
                    <Button type="primary" htmlType="submit" loading={reset.isPending}>{t('common.save')}</Button>
                </div>
            </Form>
        </Modal>
    )
}

export default function CompaniesTab() {
    const t = useT()
    const queryClient = useQueryClient()
    const tenant = useAuthStore((s) => s.tenant)
    const tenantModules = Array.isArray(tenant?.modules) ? tenant.modules : MODULE_CODES
    const ticketsOn = tenantModules.includes('tickets')
    const companies = useQuery({ queryKey: KEY, queryFn: companyService.list })
    const support = useQuery({ queryKey: SUPPORT_KEY, queryFn: companyService.supportList, enabled: ticketsOn, retry: false })
    const logos = useQuery({ queryKey: LOGOS_KEY, queryFn: companyService.logos, retry: false })
    const groups = useQuery({ queryKey: ['admin-user-groups'], queryFn: () => userGroupService.list(), enabled: ticketsOn, retry: false })
    const [search, setSearch] = useState('')
    const [editing, setEditing] = useState(null)
    const [resetting, setResetting] = useState(null)

    const supportBy = useMemo(
        () => Object.fromEntries((support.data?.items ?? []).map((s) => [s.account_id, s])),
        [support.data],
    )
    const logoBy = logos.data?.logos ?? {}
    const rows = useMemo(
        () => (companies.data ?? []).filter((c) => matchesAny([c.name, c.email], search)),
        [companies.data, search],
    )
    const refresh = () => {
        queryClient.invalidateQueries({ queryKey: KEY })
        queryClient.invalidateQueries({ queryKey: SUPPORT_KEY })
        queryClient.invalidateQueries({ queryKey: LOGOS_KEY })
    }
    const provider = Boolean(support.data?.provider)
    const groupRows = (Array.isArray(groups.data) ? groups.data : []).filter((g) => g.is_active !== false)

    const columns = [
        {
            title: t('companies.company'),
            dataIndex: 'name',
            key: 'name',
            sorter: (a, b) => a.name.localeCompare(b.name),
            render: (name, record) => (
                <span className="users-person">
                    <CompanyLogo id={record.id} name={name} size={32} etag={logoBy[record.id] ?? null} />
                    <span className="users-person__text">
                        <b>{name}</b>
                        <small>{record.email}</small>
                    </span>
                </span>
            ),
        },
        {
            title: t('companies.modules'),
            dataIndex: 'modules',
            key: 'modules',
            render: (mods) => (mods.length
                ? <Space size={4} wrap>{mods.map((m) => <span key={m} className="lq-tag lq-tag--info">{t(MODULES[m]?.labelKey ?? m)}</span>)}</Space>
                : <span className="lq-tag">{t('companies.noModules')}</span>),
        },
        {
            title: t('companies.supportTeam'),
            key: 'support',
            render: (_, record) => {
                if (!record.modules.includes('tickets')) return '—'
                const s = supportBy[record.id]
                return s?.configured
                    ? s.group_name
                    : <span className="lq-tag lq-tag--warn">{t('companies.teamMissing')}</span>
            },
        },
        {
            title: t('common.status'), dataIndex: 'is_active', key: 'is_active', width: 100, render: (active) => (
                <span className={`lq-tag${active ? ' lq-tag--ok' : ''}`}>
                    <span className="users-dot" aria-hidden="true" />{active ? t('users.statusActive') : t('users.statusInactive')}
                </span>
            ),
        },
        {
            title: t('common.actions'), key: 'actions', width: 120, render: (_, record) => (
                <Space>
                    <Button type="text" icon={<EditOutlined />} aria-label={t('companies.editFor', { name: record.name })}
                            onClick={() => setEditing(record)} />
                    <Button type="text" icon={<LockOutlined />} aria-label={t('companies.resetPasswordFor', { name: record.name })}
                            onClick={() => setResetting(record)} />
                </Space>
            ),
        },
    ]

    return (
        <>
            <AdminErrorAlert error={companies.isError ? companies.error : null} onRetry={companies.refetch} />
            <Card variant="borderless"
                title={t('admin.entityCount', { entity: t('companies.title'), n: rows.length })}
                extra={
                    <Space wrap>
                        <Input
                            allowClear
                            prefix={<SearchOutlined aria-hidden="true" />}
                            placeholder={t('admin.searchEntity', { entity: t('companies.title') })}
                            aria-label={t('admin.searchEntity', { entity: t('companies.title') })}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={{ width: 220 }}
                        />
                        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({})}>{t('companies.new')}</Button>
                    </Space>
                }
            >
                <p className="companies-hint">{t('companies.hint')}</p>
                <Table
                    dataSource={rows}
                    columns={columns}
                    rowKey="id"
                    loading={companies.isLoading && !companies.data}
                    pagination={{ pageSize: 10 }}
                    scroll={{ x: 'max-content' }}
                    locale={{
                        emptyText: (
                            <AdminEmptyState
                                filtered={!!search.trim()}
                                term={search.trim()}
                                entityLabel={t('companies.company')}
                                createLabel={t('companies.new')}
                                onCreate={() => setEditing({})}
                            />
                        ),
                    }}
                />
                <AdminRefreshHint isFetching={companies.isFetching} hasData={(companies.data ?? []).length > 0} />
            </Card>
            {editing && (
                <CompanyModal
                    company={editing} support={supportBy[editing.id]} logoEtag={logoBy[editing.id] ?? null}
                    groups={groupRows} provider={provider} tenantModules={tenantModules}
                    onClose={() => setEditing(null)} onSaved={refresh}
                />
            )}
            {resetting && <PasswordModal company={resetting} onClose={() => setResetting(null)} />}
        </>
    )
}
