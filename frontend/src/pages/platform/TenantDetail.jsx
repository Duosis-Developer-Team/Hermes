/**
 * =============================================================================
 * HERMES - Kiraci detayi (super-admin, Faz 2)
 * =============================================================================
 * Genel · Moduller · Uyeler · Erisim ve kimlik · Denetim. Yalniz kontrol
 * duzlemi verisi (durum, moduller, uyelik metadata'si, denetim); kiracinin
 * is verisi bu ekrana GELMEZ — o, sureli/gerekceli destek erisimiyle acilir.
 *
 * Duzenlemeler iyimser kilitle gider (expected_version): iki operator ayni
 * anda degistirirse sessiz ezme yok, 409 → sayfa tazelenir.
 * =============================================================================
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    Button, Empty, Form, Input, InputNumber, Modal, Select, Spin, Table, Typography, message,
} from 'antd'
import {
    CopyOutlined, PauseCircleOutlined, PlayCircleOutlined,
    RightOutlined, SafetyCertificateOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'

import { platformService } from '../../api/platformApi'
import { BackLink, GlassCard, LiquidSegmented, ModalHead } from '../../components/liquid'
import { usePlatformAuthStore } from '../../stores/platformAuthStore'
import { useT } from '../../i18n'
import ModulePicker from './ModulePicker'
import { TenantMark, TenantStatus } from './TenantList'
import './platform.css'

const { Text } = Typography

const errText = (err, fallback) => {
    const d = err?.response?.data?.detail
    return d?.message || (typeof d === 'string' ? d : null) || fallback
}

export const workspaceUrl = (slug) => `${window.location.origin}/?workspace=${slug}`

// =============================================================================
// Yasam dongusu ve destek erisimi
// =============================================================================

/** Askiya alma: gerekce + slug'in ELLE yazilmasi (yuksek riskli aksiyon). */
function SuspendModal({ tenant, onClose, onDone }) {
    const t = useT()
    const [form] = Form.useForm()
    const [saving, setSaving] = useState(false)
    if (!tenant) return null
    const submit = async (values) => {
        setSaving(true)
        try {
            await platformService.suspendTenant(tenant.id, {
                reason: values.reason, confirmSlug: values.confirm_slug, version: tenant.version,
            })
            message.success(`${tenant.display_name} suspended.`)
            onDone()
        } catch (err) {
            message.error(errText(err, 'Could not suspend this tenant.'))
        } finally {
            setSaving(false)
        }
    }
    return (
        <Modal
            open
            title={<ModalHead icon={<PauseCircleOutlined />} tone="red" title={`${t('platform.suspend')} — ${tenant.display_name}`} />}
            onCancel={onClose} okText={t('platform.suspend')} okButtonProps={{ danger: true }}
            confirmLoading={saving} onOk={() => form.submit()}
        >
            <Text type="secondary">{t('platform.suspendHint')}</Text>
            <Form form={form} layout="vertical" onFinish={submit} style={{ marginTop: 16 }}>
                <Form.Item name="reason" label={t('platform.reason')} rules={[{ required: true, min: 3 }]}>
                    <Input.TextArea rows={2} placeholder={t('platform.reasonSuspendExample')} />
                </Form.Item>
                <Form.Item
                    name="confirm_slug"
                    label={`Type "${tenant.slug}" to confirm`}
                    rules={[{
                        required: true,
                        validator: (_, v) => (v === tenant.slug
                            ? Promise.resolve()
                            : Promise.reject(new Error('Slug does not match'))),
                    }]}
                >
                    <Input autoComplete="off" />
                </Form.Item>
            </Form>
        </Modal>
    )
}

/** Destek erisimi: salt-okunur VARSAYILAN, azami 30 dakika. */
function SupportModal({ tenant, onClose, onStarted }) {
    const t = useT()
    const [form] = Form.useForm()
    const [saving, setSaving] = useState(false)
    if (!tenant) return null
    const submit = async (values) => {
        setSaving(true)
        try {
            const grant = await platformService.createSupportGrant({
                tenantId: tenant.id, mode: values.mode, reason: values.reason,
                durationMinutes: values.duration_minutes,
            })
            onStarted({ ...grant, tenant })
        } catch (err) {
            message.error(errText(err, 'Could not create the support grant.'))
        } finally {
            setSaving(false)
        }
    }
    return (
        <Modal
            open
            title={<ModalHead icon={<SafetyCertificateOutlined />} tone="violet" title={`${t('platform.supportAccess')} — ${tenant.display_name}`} />}
            onCancel={onClose} okText={t('platform.startSession')}
            confirmLoading={saving} onOk={() => form.submit()}
        >
            <Text type="secondary">
                Access is time-limited, audited and shown in a permanent banner.
                Read-only is the default; read-write needs an additional permission.
            </Text>
            <Form form={form} layout="vertical" onFinish={submit}
                  initialValues={{ mode: 'read_only', duration_minutes: 15 }} style={{ marginTop: 16 }}>
                <Form.Item name="mode" label={t('platform.mode')}>
                    <Select options={[
                        { value: 'read_only', label: t('platform.readOnly') },
                        { value: 'read_write', label: t('platform.readWrite') },
                    ]} />
                </Form.Item>
                <Form.Item name="duration_minutes" label={t('platform.durationMinutes')} rules={[{ required: true }]}>
                    <InputNumber min={1} max={30} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item name="reason" label={t('platform.reasonTicket')} rules={[{ required: true, min: 3 }]}>
                    <Input placeholder={t('platform.reasonExample')} />
                </Form.Item>
            </Form>
        </Modal>
    )
}

// =============================================================================
// Sekmeler
// =============================================================================

/** Bu kiracinin talep agi: kime talep acar, kimden talep alir. */
function NetworkSummary({ tenant }) {
    const t = useT()
    const navigate = useNavigate()
    const [links, setLinks] = useState(null)
    useEffect(() => {
        Promise.resolve()
            .then(() => platformService.supportNetwork())
            .then((d) => setLinks(d?.items || []))
            .catch(() => setLinks([]))
    }, [tenant.id])
    if (!links) return null
    const outgoing = links.filter((l) => l.requester_tenant_id === tenant.id)
    const incoming = links.filter((l) => l.provider_tenant_id === tenant.id)
    const line = (name, l) => (
        <li key={`${l.requester_tenant_id}-${l.provider_tenant_id}`} className={l.is_active ? '' : 'pc-muted'}>
            {name}{l.group_name ? ` · ${l.group_name}` : ''}
            {!l.is_active && ` (${t('platform.network.inactive')})`}
        </li>
    )
    return (
        <GlassCard
            title={t('platform.ticketNetwork')}
            link={(
                <Button type="link" size="small" onClick={() => navigate('/platform-admin/network')}>
                    {t('platform.network.openNetwork')} <RightOutlined />
                </Button>
            )}
        >
            <div className="pc-net-summary">
                <div>
                    <h4>{t('platform.network.outgoing')}</h4>
                    {outgoing.length
                        ? <ul>{outgoing.map((l) => line(l.provider_display_name, l))}</ul>
                        : <span className="pc-muted">{t('platform.network.none')}</span>}
                </div>
                <div>
                    <h4>{t('platform.network.incoming')}</h4>
                    {incoming.length
                        ? <ul>{incoming.map((l) => line(l.requester_display_name, l))}</ul>
                        : <span className="pc-muted">{t('platform.network.none')}</span>}
                </div>
            </div>
        </GlassCard>
    )
}

function OverviewSection({ tenant, canManage, onSuspend, onReactivate, onSupport, canSupport }) {
    const t = useT()
    return (
        <div className="pc-section">
            <GlassCard title={t('platform.details')}>
                <dl className="pc-dl">
                    <dt>{t('platform.organizationName')}</dt><dd>{tenant.display_name}</dd>
                    <dt>{t('platform.workspaceAddress')}</dt><dd><code>{tenant.slug}</code></dd>
                    <dt>{t('common.status')}</dt><dd><TenantStatus status={tenant.status} /></dd>
                    <dt>{t('platform.members')}</dt><dd>{tenant.active_members ?? 0}</dd>
                    <dt>{t('platform.emailDomains')}</dt>
                    <dd>{(tenant.email_domains || []).length ? tenant.email_domains.join(', ') : '—'}</dd>
                    <dt>{t('platform.createdAt')}</dt><dd>{tenant.created_at ? dayjs(tenant.created_at).format('D MMM YYYY HH:mm') : '—'}</dd>
                    <dt>{t('platform.activatedAt')}</dt><dd>{tenant.activated_at ? dayjs(tenant.activated_at).format('D MMM YYYY HH:mm') : '—'}</dd>
                </dl>
            </GlassCard>
            <NetworkSummary tenant={tenant} />
            {(canManage || canSupport) && (
                <GlassCard title={t('platform.dangerZone')} className="pc-danger">
                    <div className="pc-section">
                        {canSupport && (
                            <div className="pc-danger__row">
                                <p>{t('platform.supportAccess')}</p>
                                <Button icon={<SafetyCertificateOutlined />} onClick={onSupport}>{t('platform.startSession')}</Button>
                            </div>
                        )}
                        {canManage && tenant.status === 'active' && (
                            <div className="pc-danger__row">
                                <p>{t('platform.suspendHint')}</p>
                                <Button danger icon={<PauseCircleOutlined />} onClick={onSuspend}>{t('platform.suspend')}</Button>
                            </div>
                        )}
                        {canManage && tenant.status === 'suspended' && (
                            <div className="pc-danger__row">
                                <p>{t('platform.reactivateHint')}</p>
                                <Button icon={<PlayCircleOutlined />} onClick={onReactivate}>{t('platform.reactivate')}</Button>
                            </div>
                        )}
                    </div>
                </GlassCard>
            )}
        </div>
    )
}

function ModulesSection({ tenant, canManage, onSaved }) {
    const t = useT()
    const [draft, setDraft] = useState(tenant.modules || [])
    const [saving, setSaving] = useState(false)
    useEffect(() => { setDraft(tenant.modules || []) }, [tenant.modules])
    const dirty = draft.join(',') !== (tenant.modules || []).join(',')

    const save = async () => {
        setSaving(true)
        try {
            await platformService.updateTenant(tenant.id, { modules: draft, expected_version: tenant.version })
            message.success(t('platform.modulesSaved'))
            onSaved()
        } catch (err) {
            if (err?.response?.status === 409) {
                message.warning(t('platform.versionConflict'))
                onSaved()
            } else {
                message.error(errText(err, 'Could not save modules.'))
            }
        } finally {
            setSaving(false)
        }
    }

    return (
        <GlassCard title={t('platform.modulesTitle')}>
            <p className="pc-muted" style={{ marginTop: 0 }}>{t('platform.modulesHint')}</p>
            <ModulePicker value={draft} onChange={setDraft} disabled={!canManage} />
            {dirty && (
                <div className="pc-savebar" role="region" aria-label={t('platform.unsavedChanges')}>
                    <span>{t('platform.unsavedChanges')}</span>
                    <div className="pc-savebar__actions">
                        <Button onClick={() => setDraft(tenant.modules || [])}>{t('platform.discard')}</Button>
                        <Button type="primary" loading={saving} onClick={save}>{t('platform.saveModules')}</Button>
                    </div>
                </div>
            )}
        </GlassCard>
    )
}

function MembersSection({ tenant }) {
    const t = useT()
    const [rows, setRows] = useState(null)
    useEffect(() => {
        platformService.listTenantMembers(tenant.id)
            .then(setRows)
            .catch(() => { setRows([]); message.error(t('platform.loadMembersFailed')) })
    }, [tenant.id, t])
    return (
        <GlassCard className="lq-card--flush">
            <Table
                rowKey="user_id"
                loading={rows === null}
                dataSource={rows || []}
                size="middle"
                pagination={{ pageSize: 20, hideOnSinglePage: true }}
                scroll={{ x: 'max-content' }}
                columns={[
                    {
                        title: t('platform.members'), dataIndex: 'full_name', key: 'name',
                        render: (name, r) => (
                            <span className="pc-tenant">
                                <TenantMark name={name || r.email} />
                                <span className="pc-tenant__text"><b>{name || r.email}</b><small>{r.email}</small></span>
                            </span>
                        ),
                    },
                    {
                        title: '', dataIndex: 'is_admin', key: 'role',
                        render: (a) => <span className={`lq-tag ${a ? 'lq-tag--info' : ''}`}>{a ? t('platform.admin') : t('platform.member')}</span>,
                    },
                    { title: t('common.status'), dataIndex: 'status', key: 'status' },
                    {
                        title: t('platform.createdAt'), dataIndex: 'joined_at', key: 'joined', responsive: ['md'],
                        render: (v) => (v ? dayjs(v).format('D MMM YYYY') : '—'),
                    },
                ]}
                locale={{ emptyText: <Empty description={t('platform.noMembers')} /> }}
            />
        </GlassCard>
    )
}

function AccessSection({ tenant, canManage, onSaved }) {
    const t = useT()
    const [form] = Form.useForm()
    const [saving, setSaving] = useState(false)
    const [password, setPassword] = useState(null)
    useEffect(() => {
        form.setFieldsValue({
            display_name: tenant.display_name,
            email_domains: (tenant.email_domains || []).join(', '),
            owner_email: undefined,
        })
    }, [tenant, form])

    const submit = async (values) => {
        setSaving(true)
        try {
            const result = await platformService.updateTenant(tenant.id, {
                display_name: values.display_name,
                email_domains: values.email_domains ?? '',
                owner_email: values.owner_email || undefined,
                expected_version: tenant.version,
            })
            message.success(t('platform.tenantUpdated'))
            if (result?.one_time_password) setPassword(result.one_time_password)
            form.setFieldValue('owner_email', undefined)
            onSaved()
        } catch (err) {
            if (err?.response?.status === 409) {
                message.warning(t('platform.versionConflict'))
                onSaved()
            } else {
                message.error(errText(err, 'Could not update tenant.'))
            }
        } finally {
            setSaving(false)
        }
    }

    return (
        <GlassCard title={t('platform.tabAccess')}>
            <Form form={form} layout="vertical" onFinish={submit} disabled={!canManage}>
                <Form.Item name="display_name" label={t('platform.organizationName')}
                           rules={[{ required: true, message: t('logTime.required') }]}>
                    <Input />
                </Form.Item>
                {/* Kisa ad DEGISTIRILEMEZ (baglantilar/oturumlar ona bagli) ama GOSTERILIR. */}
                <Form.Item label={t('platform.workspaceAddress')} extra="Cannot be changed — existing links and sessions depend on it.">
                    <Input value={tenant.slug} disabled />
                </Form.Item>
                <Form.Item name="email_domains" label={t('platform.emailDomains')} extra={t('platform.autoJoinHint')}>
                    <Input placeholder={t('platform.emailDomainsExample')} />
                </Form.Item>
                <Form.Item name="owner_email" label={t('platform.addAnotherAdmin')} extra={t('platform.addAdminHint')}
                           rules={[{ type: 'email', message: t('platform.emailInvalid') }]}>
                    <Input placeholder="admin@acme.com" allowClear />
                </Form.Item>
                {canManage && (
                    <div className="lq-mf">
                        <Button type="primary" htmlType="submit" loading={saving}>{t('common.save')}</Button>
                    </div>
                )}
            </Form>
            <Modal
                open={!!password}
                title={t('platform.oneTimePassword')}
                onOk={() => setPassword(null)}
                onCancel={() => setPassword(null)}
                okText={t('platform.savedPassword')}
                cancelButtonProps={{ style: { display: 'none' } }}
                closable={false}
                maskClosable={false}
            >
                <Text code copyable>{password}</Text>
                <p className="pc-muted">This password is shown once and is not stored anywhere.</p>
            </Modal>
        </GlassCard>
    )
}

function AuditSection({ tenant }) {
    const t = useT()
    const [rows, setRows] = useState(null)
    useEffect(() => {
        platformService.listAuditEvents({ target_tenant_id: tenant.id, limit: 100 })
            .then(setRows)
            .catch(() => { setRows([]); message.error(t('platform.loadAuditFailed')) })
    }, [tenant.id, t])
    return (
        <GlassCard className="lq-card--flush">
            <Table
                rowKey="id"
                loading={rows === null}
                dataSource={rows || []}
                size="small"
                pagination={{ pageSize: 25, hideOnSinglePage: true }}
                scroll={{ x: 'max-content' }}
                columns={[
                    { title: t('platform.when'), dataIndex: 'occurred_at', render: (v) => (v ? dayjs(v).format('D MMM YYYY HH:mm') : '—') },
                    { title: t('platform.action'), dataIndex: 'action' },
                    { title: t('platform.result'), dataIndex: 'result' },
                    { title: t('platform.reason'), dataIndex: 'reason', responsive: ['md'] },
                ]}
                locale={{ emptyText: <Empty description={t('platform.noAuditEvents')} /> }}
            />
        </GlassCard>
    )
}

// =============================================================================
// Sayfa
// =============================================================================

const TABS = ['overview', 'modules', 'members', 'access', 'audit']
const TAB_LABEL = {
    overview: 'platform.tabOverview', modules: 'platform.tabModules', members: 'platform.tabMembers',
    access: 'platform.tabAccess', audit: 'platform.tabAudit',
}

function TenantDetail({ tenantId, onBack, onSupportStarted }) {
    const t = useT()
    const can = usePlatformAuthStore((s) => s.can)
    const canManage = can('platform.tenants.manage')
    const canSupport = can('platform.support_access.create')
    const canAudit = can('platform.audit.view')
    const [tenant, setTenant] = useState(null)
    const [tab, setTab] = useState('overview')
    const [suspending, setSuspending] = useState(false)
    const [supporting, setSupporting] = useState(false)

    const load = useCallback(() => platformService.getTenant(tenantId)
        .then(setTenant)
        .catch(() => message.error(t('platform.loadTenantsFailed'))), [tenantId, t])
    useEffect(() => { load() }, [load])

    const tabs = useMemo(() => TABS.filter((k) => k !== 'audit' || canAudit), [canAudit])

    const reactivate = async () => {
        try {
            await platformService.reactivateTenant(tenant.id, {
                reason: 'Reactivated from Platform Console', version: tenant.version,
            })
            message.success(`${tenant.display_name} reactivated.`)
            load()
        } catch (err) {
            message.error(errText(err, 'Could not reactivate this tenant.'))
        }
    }

    const copyLink = async () => {
        try {
            await navigator.clipboard.writeText(workspaceUrl(tenant.slug))
            message.success(t('platform.linkCopied'))
        } catch { /* panoya yazilamadi: baglanti zaten gorunur */ }
    }

    return (
        <div className="lq-enter">
            <BackLink onClick={onBack}>{t('platform.backToTenants')}</BackLink>
            {!tenant ? (
                <GlassCard><div style={{ display: 'grid', placeItems: 'center', padding: 40 }}><Spin /></div></GlassCard>
            ) : (
                <>
                    <header className="pc-dhero">
                        <TenantMark name={tenant.display_name} />
                        <div className="pc-dhero__text">
                            <h2>{tenant.display_name}</h2>
                            <div className="pc-dhero__meta">
                                <TenantStatus status={tenant.status} />
                                <span className="pc-link">
                                    <code>{workspaceUrl(tenant.slug)}</code>
                                    <Button size="small" type="text" icon={<CopyOutlined />} onClick={copyLink}
                                            aria-label={t('platform.copyLink')} />
                                </span>
                            </div>
                        </div>
                    </header>
                    <LiquidSegmented
                        className="pc-tabs"
                        ariaLabel={t('platform.details')}
                        value={tab}
                        onChange={setTab}
                        options={tabs.map((k) => ({ value: k, label: t(TAB_LABEL[k]) }))}
                    />
                    {tab === 'overview' && (
                        <OverviewSection
                            tenant={tenant} canManage={canManage} canSupport={canSupport}
                            onSuspend={() => setSuspending(true)} onReactivate={reactivate}
                            onSupport={() => setSupporting(true)}
                        />
                    )}
                    {tab === 'modules' && <ModulesSection tenant={tenant} canManage={canManage} onSaved={load} />}
                    {tab === 'members' && <MembersSection tenant={tenant} />}
                    {tab === 'access' && <AccessSection tenant={tenant} canManage={canManage} onSaved={load} />}
                    {tab === 'audit' && <AuditSection tenant={tenant} />}
                    {suspending && (
                        <SuspendModal tenant={tenant} onClose={() => setSuspending(false)}
                                      onDone={() => { setSuspending(false); load() }} />
                    )}
                    {supporting && (
                        <SupportModal tenant={tenant} onClose={() => setSupporting(false)}
                                      onStarted={(grant) => { setSupporting(false); onSupportStarted?.(grant) }} />
                    )}
                </>
            )}
        </div>
    )
}

export default TenantDetail
