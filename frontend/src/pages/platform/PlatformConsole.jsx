/**
 * =============================================================================
 * HERMES - Platform Admin Console (WS9)
 * =============================================================================
 * Operator konsolunun kabugu: genel bakis, tenant listesi/detayi,
 * yasam dongusu aksiyonlari, destek erisimi ve denetim kaydi.
 *
 * TASARIM: mevcut Hermes tasarim dilini kullanir (ayni antd tokenlari,
 * ayni tipografi/aralik, light/dark). "Platform" rozeti duzlemi ayirt
 * ettirir ama urun Hermes'e AITTIR.
 *
 * GUVENLIK SINIRI: bu ekranlarin HICBIRI tenant is verisi gostermez —
 * yalnizca metadata (durum, plan, uye SAYISI). Is verisine bakmak icin
 * sureli/gerekceli bir destek izni alinir ve o erisim AYRI, bannerli
 * bir baglamda acilir.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Badge, Button, Card, Col, Descriptions, Empty, Form, Input,
    InputNumber, Modal, Row, Select, Space, Statistic, Table,
    Tag, Typography, message,
} from 'antd'
import {
    CustomerServiceOutlined,
    ApartmentOutlined,
    PlusOutlined,
    DashboardOutlined,
    FileSearchOutlined,
    LogoutOutlined,
    SafetyCertificateOutlined,
} from '@ant-design/icons'

import AppShell from '../../components/layout/AppShell'
import { platformService } from '../../api/platformApi'
import SupportRoutingTab from './SupportRoutingTab'
import { usePlatformAuthStore } from '../../stores/platformAuthStore'
import SupportSessionBanner from './SupportSessionBanner'

const { Text } = Typography

/** Durum → renk + METIN. Renk TEK BASINA anlam tasimaz (erisilebilirlik). */
const STATUS_TONE = {
    active: 'success',
    provisioning: 'processing',
    grace: 'warning',
    suspended: 'error',
    deprovisioning: 'warning',
    archived: 'default',
    failed: 'error',
}

function TenantStatus({ status }) {
    return <Badge status={STATUS_TONE[status] || 'default'} text={status} />
}

// =============================================================================
// Genel bakis
// =============================================================================

function OverviewTab() {
    const [data, setData] = useState(null)
    const [error, setError] = useState(null)

    useEffect(() => {
        platformService.overview().then(setData).catch(() =>
            setError('Could not load the overview.'))
    }, [])

    if (error) return <Empty description={error} />
    if (!data) return <Card loading />

    const byStatus = data.tenants?.by_status || {}
    return (
        <Row gutter={[16, 16]}>
            <Col xs={12} md={6}>
                <Card><Statistic title="Tenants" value={data.tenants?.total ?? 0} /></Card>
            </Col>
            <Col xs={12} md={6}>
                <Card><Statistic title="Active" value={byStatus.active ?? 0} /></Card>
            </Col>
            <Col xs={12} md={6}>
                <Card><Statistic title="Suspended" value={byStatus.suspended ?? 0} /></Card>
            </Col>
            <Col xs={12} md={6}>
                <Card>
                    <Statistic
                        title="Active support sessions"
                        value={data.support_sessions_active ?? 0}
                    />
                </Card>
            </Col>
        </Row>
    )
}

// =============================================================================
// Tenant listesi + yasam dongusu
// =============================================================================

function TenantsTab({ onSupportStarted }) {
    const [rows, setRows] = useState([])
    const [loading, setLoading] = useState(true)
    const [target, setTarget] = useState(null)     // suspend hedefi
    const [supportFor, setSupportFor] = useState(null)
    const [creating, setCreating] = useState(false)
    const [editing, setEditing] = useState(null)
    const can = usePlatformAuthStore((s) => s.can)

    const reload = useCallback(() => {
        setLoading(true)
        platformService.listTenants()
            .then((d) => setRows(d.tenants || []))
            .catch(() => message.error('Could not load tenants.'))
            .finally(() => setLoading(false))
    }, [])

    useEffect(reload, [reload])

    const columns = [
        { title: 'Organization', dataIndex: 'display_name' },
        { title: 'Slug', dataIndex: 'slug', responsive: ['md'] },
        {
            title: 'Status', dataIndex: 'status',
            render: (s) => <TenantStatus status={s} />,
        },
        {
            title: 'Plan', dataIndex: 'plan_code', responsive: ['lg'],
            render: (p) => (p ? <Tag>{p}</Tag> : <Text type="secondary">—</Text>),
        },
        {
            title: 'Members', dataIndex: 'active_members', responsive: ['lg'],
        },
        {
            title: 'Actions',
            render: (_, row) => (
                <Space wrap>
                    {can('platform.tenants.manage') && row.status === 'active' && (
                        <Button size="small" danger
                                onClick={() => setTarget(row)}>
                            Suspend
                        </Button>
                    )}
                    {can('platform.tenants.manage') && row.status === 'suspended' && (
                        <Button size="small" onClick={() => reactivate(row)}>
                            Reactivate
                        </Button>
                    )}
                    {can('platform.tenants.manage') && (
                        <Button size="small" onClick={() => setEditing(row)}>
                            Edit
                        </Button>
                    )}
                    {can('platform.support_access.create') && (
                        <Button size="small" onClick={() => setSupportFor(row)}>
                            Support access
                        </Button>
                    )}
                </Space>
            ),
        },
    ]

    const reactivate = async (row) => {
        try {
            await platformService.reactivateTenant(row.id, {
                reason: 'Reactivated from Platform Console',
                version: row.version,
            })
            message.success(`${row.display_name} reactivated.`)
            reload()
        } catch (err) {
            message.error(
                err?.response?.data?.detail?.message
                || 'Could not reactivate this tenant.',
            )
        }
    }

    return (
        <>
            <Space style={{ marginBottom: 16 }}>
                {can('platform.tenants.manage') && (
                    <Button type="primary" icon={<PlusOutlined />}
                            onClick={() => setCreating(true)}>
                        New tenant
                    </Button>
                )}
            </Space>
            <Table
                rowKey="id" columns={columns} dataSource={rows}
                loading={loading} size="middle"
                // Genis tablo mobilde SAYFAYI degil KENDINI kaydirir.
                scroll={{ x: 'max-content' }}
                locale={{ emptyText: <Empty description="No tenants yet" /> }}
            />
            <SuspendModal
                tenant={target} onClose={() => setTarget(null)}
                onDone={() => { setTarget(null); reload() }}
            />
            <SupportModal
                tenant={supportFor} onClose={() => setSupportFor(null)}
                onStarted={(grant) => {
                    setSupportFor(null)
                    onSupportStarted(grant)
                }}
            />
            <CreateTenantModal
                open={creating} onClose={() => setCreating(false)}
                onDone={() => { setCreating(false); reload() }}
            />
            <EditTenantModal
                tenant={editing} onClose={() => setEditing(null)}
                onDone={() => { setEditing(null); reload() }}
            />
        </>
    )
}

/** Askiya alma: gerekce + slug'in ELLE yazilmasi (yuksek riskli aksiyon). */
// =============================================================================
// Yeni tenant — SEMA YARATILMAZ
// =============================================================================
// Mimari karar geregi tenant basina veritabani/sema YOKTUR; izolasyonu
// FORCE ROW LEVEL SECURITY sagliyor. Bu yuzden yeni tenant saniyeler
// icinde hazir olur ve DDL beklemesi gerekmez.

function usePlans() {
    const [plans, setPlans] = useState([])
    useEffect(() => {
        platformService.listPlans()
            .then(setPlans)
            .catch(() => setPlans([]))   // plan katalogu yoksa alan bos kalir
    }, [])
    return plans
}

function CreateTenantModal({ open, onClose, onDone }) {
    const [form] = Form.useForm()
    const [busy, setBusy] = useState(false)
    const [created, setCreated] = useState(null)
    const plans = usePlans()

    const submit = async () => {
        const values = await form.validateFields()
        setBusy(true)
        try {
            const result = await platformService.createTenant(values)
            if (result.one_time_password) {
                // Parola YALNIZCA burada, BIR KEZ gosterilir; hicbir yere
                // kaydedilmez. Modal kapanmadan once operator kopyalamali.
                setCreated(result)
            } else {
                message.success(`${values.display_name} created.`)
                onDone()
            }
        } catch (err) {
            const d = err?.response?.data?.detail
            message.error(d?.message || d || 'Could not create tenant.')
        } finally {
            setBusy(false)
        }
    }

    // Basarili + tek seferlik parola ekrani
    if (created) {
        return (
            <Modal
                open title="Tenant created" onCancel={() => { setCreated(null); onDone() }}
                onOk={() => { setCreated(null); onDone() }}
                okText="I saved the password" cancelButtonProps={{ style: { display: 'none' } }}
                closable={false} maskClosable={false}
            >
                <Space direction="vertical" style={{ width: '100%' }}>
                    <Text>
                        <strong>{created.tenant.display_name}</strong> is ready.
                        Users reach it at{' '}
                        <Text code>{created.workspace_hint}</Text>
                    </Text>
                    <Descriptions column={1} size="small" bordered>
                        <Descriptions.Item label="Owner">
                            {created.owner.email}
                        </Descriptions.Item>
                        <Descriptions.Item label="One-time password">
                            <Text code copyable>{created.one_time_password}</Text>
                        </Descriptions.Item>
                    </Descriptions>
                    <Text type="warning">
                        This password is shown once and is not stored anywhere.
                        Share it securely; the owner should change it at first
                        sign-in.
                    </Text>
                </Space>
            </Modal>
        )
    }

    return (
        <Modal
            open={open} title="New tenant" onCancel={onClose} onOk={submit}
            confirmLoading={busy} okText="Create" destroyOnClose
        >
            <Form form={form} layout="vertical" preserve={false}>
                <Form.Item
                    name="display_name" label="Organization name"
                    rules={[{ required: true, message: 'Required' }]}
                >
                    <Input placeholder="Acme Industries" />
                </Form.Item>
                <Form.Item
                    name="slug" label="Workspace address"
                    extra="Users reach this tenant at /?workspace=<slug>"
                    rules={[
                        { required: true, message: 'Required' },
                        {
                            pattern: /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
                            message: 'Lowercase letters, digits and dashes only',
                        },
                    ]}
                >
                    <Input placeholder="acme" />
                </Form.Item>
                <Form.Item
                    name="owner_email" label="Owner e-mail"
                    extra="This person becomes the tenant's administrator."
                    rules={[
                        { required: true, message: 'Required' },
                        { type: 'email', message: 'Enter a valid e-mail' },
                    ]}
                >
                    <Input placeholder="admin@acme.com" />
                </Form.Item>
                <Form.Item name="owner_full_name" label="Owner name (optional)">
                    <Input placeholder="Ada Lovelace" />
                </Form.Item>
                <Form.Item
                    name="email_domains" label="E-mail domains (optional)"
                    extra={
                        'Anyone with an e-mail at these domains joins this '
                        + 'tenant on first sign-in. Comma separated.'
                    }
                >
                    <Input placeholder="acme.com, acme.co.uk" />
                </Form.Item>
                <Form.Item name="plan_code" label="Plan">
                    <Select
                        allowClear placeholder="Select a plan"
                        options={plans.map((p) => ({
                            value: p.code, label: p.display_name || p.code,
                        }))}
                    />
                </Form.Item>
            </Form>
        </Modal>
    )
}

function EditTenantModal({ tenant, onClose, onDone }) {
    const [form] = Form.useForm()
    const [busy, setBusy] = useState(false)
    const plans = usePlans()

    useEffect(() => {
        if (tenant) {
            form.setFieldsValue({
                display_name: tenant.display_name,
                plan_code: tenant.plan_code || undefined,
                email_domains: (tenant.email_domains || []).join(', '),
                status: tenant.status,
            })
        }
    }, [tenant, form])

    const submit = async () => {
        const values = await form.validateFields()
        setBusy(true)
        try {
            await platformService.updateTenant(tenant.id, values)
            message.success('Tenant updated.')
            onDone()
        } catch (err) {
            const d = err?.response?.data?.detail
            message.error(d?.message || d || 'Could not update tenant.')
        } finally {
            setBusy(false)
        }
    }

    return (
        <Modal
            open={!!tenant} title={`Edit ${tenant?.display_name || ''}`}
            onCancel={onClose} onOk={submit} confirmLoading={busy}
            okText="Save" destroyOnClose
        >
            <Form form={form} layout="vertical" preserve={false}>
                <Form.Item
                    name="display_name" label="Organization name"
                    rules={[{ required: true, message: 'Required' }]}
                >
                    <Input />
                </Form.Item>

                {/* Workspace adresi DEGISTIRILEMEZ: mevcut baglantilar,
                    kayitli oturumlar ve e-posta linkleri ona bagli. Yine de
                    GOSTERILIR — duzenleme ekrani, olusturma ekranindaki her
                    alani icermeli; degistirilemeyen alan gizlenmez, neden
                    kilitli oldugu SOYLENIR. */}
                <Form.Item label="Workspace address">
                    <Input value={tenant?.slug} disabled />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                        Cannot be changed — existing links and sessions
                        depend on it.
                    </Text>
                </Form.Item>

                <Form.Item
                    name="email_domains" label="E-mail domains"
                    extra={
                        'Anyone with an e-mail at these domains joins this '
                        + 'tenant on first sign-in. Comma separated; empty '
                        + 'disables domain auto-join.'
                    }
                >
                    <Input placeholder="acme.com, acme.co.uk" />
                </Form.Item>

                <Form.Item name="plan_code" label="Plan">
                    <Select
                        allowClear placeholder="Select a plan"
                        options={plans.map((p) => ({
                            value: p.code, label: p.display_name || p.code,
                        }))}
                    />
                </Form.Item>

                {/* Yasam dongusu: askiya alma/geri acma buradan da
                    yapilabilir. Askiya alma YIKICI bir islemdir — ayri
                    onay akisi (SuspendModal) korunur, burada yalnizca
                    geri acma dogrudan sunulur. */}
                <Form.Item label="Status">
                    <Space>
                        <TenantStatus status={tenant?.status} />
                        <Text type="secondary" style={{ fontSize: 12 }}>
                            Use Suspend / Reactivate on the tenant row —
                            suspending requires typed confirmation.
                        </Text>
                    </Space>
                </Form.Item>

                <Form.Item
                    name="owner_email" label="Add another administrator"
                    extra={
                        'Optional. Grants this person tenant-admin rights. '
                        + 'If they do not have an account yet, one is created '
                        + 'and a one-time password is shown once.'
                    }
                    rules={[{ type: 'email', message: 'Enter a valid e-mail' }]}
                >
                    <Input placeholder="admin@acme.com" allowClear />
                </Form.Item>
            </Form>
        </Modal>
    )
}

function SuspendModal({ tenant, onClose, onDone }) {
    const [form] = Form.useForm()
    const [saving, setSaving] = useState(false)
    if (!tenant) return null

    const submit = async (values) => {
        setSaving(true)
        try {
            await platformService.suspendTenant(tenant.id, {
                reason: values.reason,
                confirmSlug: values.confirm_slug,
                version: tenant.version,
            })
            message.success(`${tenant.display_name} suspended.`)
            onDone()
        } catch (err) {
            message.error(
                err?.response?.data?.detail?.message
                || 'Could not suspend this tenant.',
            )
        } finally {
            setSaving(false)
        }
    }

    return (
        <Modal
            open title={`Suspend ${tenant.display_name}`}
            onCancel={onClose} okText="Suspend" okButtonProps={{ danger: true }}
            confirmLoading={saving} onOk={() => form.submit()}
        >
            <Text type="secondary">
                Browser, API and MCP access stop within the documented
                revocation window. Jobs skip this tenant. No data is deleted.
            </Text>
            <Form form={form} layout="vertical" onFinish={submit}
                  style={{ marginTop: 16 }}>
                <Form.Item
                    name="reason" label="Reason"
                    rules={[{ required: true, min: 3 }]}
                >
                    <Input.TextArea rows={2}
                                    placeholder="e.g. SUP-1234: non-payment" />
                </Form.Item>
                <Form.Item
                    name="confirm_slug"
                    label={`Type "${tenant.slug}" to confirm`}
                    rules={[{
                        required: true,
                        validator: (_, v) => v === tenant.slug
                            ? Promise.resolve()
                            : Promise.reject(new Error('Slug does not match')),
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
    const [form] = Form.useForm()
    const [saving, setSaving] = useState(false)
    if (!tenant) return null

    const submit = async (values) => {
        setSaving(true)
        try {
            const grant = await platformService.createSupportGrant({
                tenantId: tenant.id,
                mode: values.mode,
                reason: values.reason,
                durationMinutes: values.duration_minutes,
            })
            onStarted({ ...grant, tenant })
        } catch (err) {
            message.error(
                err?.response?.data?.detail?.message
                || 'Could not create the support grant.',
            )
        } finally {
            setSaving(false)
        }
    }

    return (
        <Modal
            open title={`Support access — ${tenant.display_name}`}
            onCancel={onClose} okText="Start session"
            confirmLoading={saving} onOk={() => form.submit()}
        >
            <Text type="secondary">
                Access is time-limited, audited and shown in a permanent
                banner. Read-only is the default; read-write needs an
                additional permission.
            </Text>
            <Form
                form={form} layout="vertical" onFinish={submit}
                initialValues={{ mode: 'read_only', duration_minutes: 15 }}
                style={{ marginTop: 16 }}
            >
                <Form.Item name="mode" label="Mode">
                    <Select options={[
                        { value: 'read_only', label: 'Read-only (default)' },
                        { value: 'read_write', label: 'Read-write' },
                    ]} />
                </Form.Item>
                <Form.Item
                    name="duration_minutes" label="Duration (minutes, max 30)"
                    rules={[{ required: true }]}
                >
                    <InputNumber min={1} max={30} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item
                    name="reason" label="Reason / ticket"
                    rules={[{ required: true, min: 3 }]}
                >
                    <Input placeholder="e.g. SUP-1234: investigate report" />
                </Form.Item>
            </Form>
        </Modal>
    )
}

// =============================================================================
// Denetim
// =============================================================================

function AuditTab() {
    const [rows, setRows] = useState([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        platformService.listAuditEvents()
            .then(setRows)
            .catch(() => message.error('Could not load audit events.'))
            .finally(() => setLoading(false))
    }, [])

    return (
        <Table
            rowKey="id" loading={loading} dataSource={rows} size="small"
            scroll={{ x: 'max-content' }}
            columns={[
                { title: 'When', dataIndex: 'occurred_at' },
                { title: 'Action', dataIndex: 'action' },
                { title: 'Result', dataIndex: 'result' },
                { title: 'Reason', dataIndex: 'reason', responsive: ['md'] },
            ]}
            locale={{ emptyText: <Empty description="No audit events" /> }}
        />
    )
}

// =============================================================================
// Kabuk — Hermes'in KENDI kabugu (AppShell), tenant tarafiyla AYNI bilesen
// =============================================================================
// Onceden burada kendi `Layout` + `Tabs` yapisi vardi ve Hermes'e
// benzemiyordu. "Benzer" yetmez: ayni bilesen ve ayni CSS kullanilmadikca
// iki kabuk zamanla ayrisir. Artik tenant menusunun yerinde platform
// bolumleri duruyor; sidebar, header, tema, collapse ve mobil drawer
// davranisi BIREBIR ayni.
//
// Izolasyon korunur: bu dosya hicbir tenant store'una dokunmaz, kimlik
// `usePlatformAuthStore`dan gelir ve istekler yalnizca /api/platform'a
// gider.

const SECTIONS = [
    { key: 'overview', icon: <DashboardOutlined />, label: 'Overview' },
    { key: 'tenants', icon: <ApartmentOutlined />, label: 'Tenants' },
    { key: 'support', icon: <CustomerServiceOutlined />, label: 'Support routing' },
    { key: 'audit', icon: <FileSearchOutlined />, label: 'Audit log' },
]

export default function PlatformConsole() {
    const admin = usePlatformAuthStore((s) => s.admin)
    const logout = usePlatformAuthStore((s) => s.logout)
    const [supportSession, setSupportSession] = useState(null)
    const [section, setSection] = useState('overview')
    const navigate = useNavigate()

    const endSupport = async () => {
        if (supportSession?.id) {
            try {
                await platformService.revokeSupportGrant(supportSession.id)
            } catch {
                // Iptal edilemese bile banner kalkar; sunucu tarafinda
                // izin zaten SURELIDIR.
            }
        }
        setSupportSession(null)
    }

    const handleLogout = async () => {
        try {
            await platformService.logout()
        } finally {
            logout()
            // Ayri platform giris ekrani YOK: cikista ANA giris ekranina
            // donulur. `replace` ile gecmise yazilmaz, geri tusu kapali
            // konsola dondurmez.
            navigate('/login', { replace: true })
        }
    }

    const accountMenuItems = [
        {
            key: 'logout',
            icon: <LogoutOutlined />,
            label: 'Sign out',
            danger: true,
            onClick: handleLogout,
        },
    ]

    const body = section === 'tenants'
        ? <TenantsTab onSupportStarted={setSupportSession} />
        : section === 'support'
            ? <SupportRoutingTab />
            : section === 'audit'
                ? <AuditTab />
                : <OverviewTab />

    return (
        <>
            {/* Destek oturumu banner'i EN USTTE ve kapatilamaz — kabugun
                disinda durur ki hicbir sayfa onu ortemesin. */}
            <SupportSessionBanner
                session={supportSession}
                onEnd={endSupport}
                onExpire={() => { /* sure doldu — banner kendi durumunu gosterir */ }}
            />
            <AppShell
                menuItems={SECTIONS}
                selectedKey={section}
                onMenuClick={({ key }) => setSection(key)}
                onLogoClick={() => setSection('overview')}
                accountName={admin?.full_name || admin?.email}
                accountRole="Platform Admin"
                accountMenuItems={accountMenuItems}
                /* Duzlem rozeti: bu konsolun tenant arayuzu OLMADIGI her
                   ekranda gorunur kalir. */
                headerExtra={(
                    <Tag icon={<SafetyCertificateOutlined />} color="purple">
                        PLATFORM
                    </Tag>
                )}
                contentKey={section}
            >
                {body}
            </AppShell>
        </>
    )
}
