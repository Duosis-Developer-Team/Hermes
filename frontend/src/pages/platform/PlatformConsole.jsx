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
import {
    Badge, Button, Card, Col, Descriptions, Empty, Form, Input,
    InputNumber, Modal, Row, Select, Space, Statistic, Table,
    Tag, Typography, message,
} from 'antd'
import {
    ApartmentOutlined,
    DashboardOutlined,
    FileSearchOutlined,
    LogoutOutlined,
    SafetyCertificateOutlined,
} from '@ant-design/icons'

import AppShell from '../../components/layout/AppShell'
import { platformService } from '../../api/platformApi'
import { usePlatformAuthStore } from '../../stores/platformAuthStore'
import SupportSessionBanner from './SupportSessionBanner'

const { Title, Text } = Typography

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
        </>
    )
}

/** Askiya alma: gerekce + slug'in ELLE yazilmasi (yuksek riskli aksiyon). */
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
    { key: 'audit', icon: <FileSearchOutlined />, label: 'Audit log' },
]

export default function PlatformConsole() {
    const admin = usePlatformAuthStore((s) => s.admin)
    const logout = usePlatformAuthStore((s) => s.logout)
    const [supportSession, setSupportSession] = useState(null)
    const [section, setSection] = useState('overview')

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
