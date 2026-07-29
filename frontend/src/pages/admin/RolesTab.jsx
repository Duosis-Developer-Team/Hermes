/**
 * =============================================================================
 * HERMES - RBAC Rol Yonetimi sekmesi (R3)
 * =============================================================================
 * LogiSlot'un rol editoru deseninden uyarlandi (gruplu izin
 * checkbox'lari) — iki bilinçli fark:
 *   - System rol kilidi UI'da da gorunur: ad/izin/aktiflik alanlari
 *     disabled (backend zaten 409 doner; UI yaniltmaz).
 *   - Izin katalogu backend'den gelir (tek kaynak); Turkce etiketler
 *     yalnizca burada yasar. Katalogda olup etikette olmayan kod ham
 *     haliyle gosterilir — hicbir izin sessizce gizlenmez.
 * =============================================================================
 */

import { useMemo, useState } from 'react'
import {
    Alert, Button, Card, Checkbox, Form, Input, Modal, Space, Switch,
    Table, Tag, Typography, message,
} from 'antd'
import {
    EditOutlined, LockOutlined, PlusOutlined, StopOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { rbacService } from '../../services/api'
import DeleteModal from '../../components/common/DeleteModal'

const { Text } = Typography

// Izin kodu → Turkce etiket (UI-yerel; katalog backend'de).
const PERMISSION_LABELS = {
    'users.manage': 'Kullanıcı yönetimi',
    'roles.manage': 'Rol yönetimi',
    'groups.manage': 'Grup yönetimi',
    'tasks.admin': 'Task modülü tam yetki',
    'tasks.permissions.manage': 'Task izin/hiyerarşi yönetimi',
    'api.manage': 'API Management (Developer Platform)',
    'reports.view': 'Şirket geneli raporlar',
    'plans.manage': 'Plan/süre yönetimi',
    'worklogs.admin': 'Başkası adına work log',
    'meetings.admin': 'Tüm toplantılar + sync',
    'customers.manage': 'Müşteri yönetimi',
    'projects.manage': 'Proje yönetimi',
    'reference.manage': 'Referans verisi (work types vb.)',
}

// Kod onekine gore grup basligi.
const GROUP_LABELS = {
    users: 'Yönetim',
    roles: 'Yönetim',
    groups: 'Yönetim',
    api: 'Yönetim',
    tasks: 'Görev Modülü',
    reports: 'Raporlama',
    plans: 'Zaman & Plan',
    worklogs: 'Zaman & Plan',
    meetings: 'Zaman & Plan',
    customers: 'Konfigürasyon',
    projects: 'Konfigürasyon',
    reference: 'Konfigürasyon',
}

function groupCatalog(catalog) {
    const groups = new Map()
    for (const p of catalog) {
        const prefix = p.code.split('.')[0]
        const label = GROUP_LABELS[prefix] || 'Diğer'
        if (!groups.has(label)) groups.set(label, [])
        groups.get(label).push(p)
    }
    return [...groups.entries()]
}

function RolesTab() {
    const [form] = Form.useForm()
    const [modalOpen, setModalOpen] = useState(false)
    const [editing, setEditing] = useState(null) // rol nesnesi | null
    const [deactivating, setDeactivating] = useState(null)
    const queryClient = useQueryClient()

    const { data: rolesData, isLoading } = useQuery({
        queryKey: ['rbac-roles'],
        queryFn: () => rbacService.listRoles(true),
    })
    const { data: catalogData } = useQuery({
        queryKey: ['rbac-catalog'],
        queryFn: () => rbacService.getPermissionCatalog(),
        staleTime: 5 * 60 * 1000,
    })
    const roles = rolesData?.roles || []
    const catalog = catalogData?.permissions || []
    const grouped = useMemo(() => groupCatalog(catalog), [catalog])

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ['rbac-roles'] })
    }

    const createMutation = useMutation({
        mutationFn: rbacService.createRole,
        onSuccess: () => { message.success('Rol oluşturuldu'); close(); invalidate() },
        onError: (e) => message.error(e.response?.data?.detail || 'Hata'),
    })
    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => rbacService.updateRole(id, data),
        onSuccess: () => { message.success('Rol güncellendi'); close(); invalidate() },
        onError: (e) => message.error(e.response?.data?.detail || 'Hata'),
    })
    const deactivateMutation = useMutation({
        mutationFn: rbacService.deactivateRole,
        onSuccess: () => {
            message.success('Rol pasifleştirildi — izinleri artık geçerli değil')
            setDeactivating(null); invalidate()
        },
        onError: (e) => message.error(e.response?.data?.detail || 'Hata'),
    })

    const open = (role = null) => {
        setEditing(role)
        if (role) {
            form.setFieldsValue({
                code: role.code,
                name: role.name,
                description: role.description,
                permissions: role.permissions,
                is_active: role.is_active,
            })
        } else {
            form.resetFields()
            form.setFieldsValue({ permissions: [], is_active: true })
        }
        setModalOpen(true)
    }
    const close = () => { setModalOpen(false); setEditing(null); form.resetFields() }

    const submit = (values) => {
        if (editing) {
            // System rolde yalnizca aciklama gonderilir (kilit).
            const data = editing.is_system
                ? { description: values.description }
                : {
                    name: values.name,
                    description: values.description,
                    permissions: values.permissions,
                    is_active: values.is_active,
                }
            updateMutation.mutate({ id: editing.id, data })
        } else {
            createMutation.mutate({
                code: values.code,
                name: values.name,
                description: values.description,
                permissions: values.permissions || [],
            })
        }
    }

    const columns = [
        {
            title: 'Rol', dataIndex: 'name', key: 'name',
            render: (name, r) => (
                <Space>
                    {r.is_system && <LockOutlined title="Sistem rolü" />}
                    <span>{name}</span>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                        {r.code}
                    </Text>
                </Space>
            ),
        },
        {
            title: 'İzinler', dataIndex: 'permissions', key: 'permissions',
            render: (perms) => (
                <Text type="secondary">{perms.length} izin</Text>
            ),
        },
        {
            title: 'Üye', dataIndex: 'member_count', key: 'member_count',
            width: 80,
        },
        {
            title: 'Durum', dataIndex: 'is_active', key: 'is_active',
            width: 100,
            render: (a) => (
                <Tag color={a ? 'success' : 'default'}>
                    {a ? 'Aktif' : 'Pasif'}
                </Tag>
            ),
        },
        {
            title: 'İşlem', key: 'actions', width: 120,
            render: (_, r) => (
                <Space>
                    <Button type="text" icon={<EditOutlined />}
                            onClick={() => open(r)} />
                    {!r.is_system && r.is_active && (
                        <Button type="text" danger icon={<StopOutlined />}
                                title="Pasifleştir"
                                onClick={() => setDeactivating(r)} />
                    )}
                </Space>
            ),
        },
    ]

    const systemLocked = editing?.is_system

    return (
        <>
            <Card
                title={`🛡️ Roles (${roles.length})`}
                extra={
                    <Button type="primary" icon={<PlusOutlined />}
                            onClick={() => open()}>
                        New Role
                    </Button>
                }
            >
                <Table
                    dataSource={roles} columns={columns} rowKey="id"
                    loading={isLoading} pagination={false}
                    scroll={{ x: 'max-content' }}
                />
            </Card>

            <Modal
                title={editing ? `✏️ ${editing.name}` : '➕ New Role'}
                open={modalOpen} onCancel={close} footer={null} width={640}
            >
                {systemLocked && (
                    <Alert
                        type="info" showIcon style={{ marginBottom: 16 }}
                        message="Sistem rolü kilitlidir"
                        description="Ad, izinler ve aktiflik değiştirilemez; izin seti katalogla otomatik senkron tutulur. Yalnızca açıklama düzenlenebilir."
                    />
                )}
                <Form form={form} layout="vertical" onFinish={submit}>
                    {!editing && (
                        <Form.Item
                            name="code" label="Code (kalıcı, değiştirilemez)"
                            rules={[
                                { required: true, message: 'Code gerekli' },
                                {
                                    pattern: /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/,
                                    message: 'küçük harf/rakam/tire, 3-64',
                                },
                            ]}
                        >
                            <Input placeholder="report-viewer" />
                        </Form.Item>
                    )}
                    <Form.Item
                        name="name" label="Name"
                        rules={[{ required: true, message: 'Ad gerekli' }]}
                    >
                        <Input disabled={systemLocked} />
                    </Form.Item>
                    <Form.Item name="description" label="Description">
                        <Input.TextArea rows={2} />
                    </Form.Item>
                    <Form.Item name="permissions" label="İzinler">
                        <Checkbox.Group
                            style={{ width: '100%' }}
                            disabled={systemLocked}
                        >
                            {grouped.map(([groupLabel, perms]) => (
                                <div key={groupLabel}
                                     style={{ marginBottom: 12 }}>
                                    <Text strong>{groupLabel}</Text>
                                    <div style={{
                                        display: 'grid', gap: 4,
                                        marginTop: 4,
                                    }}>
                                        {perms.map((p) => (
                                            <Checkbox key={p.code}
                                                      value={p.code}>
                                                {PERMISSION_LABELS[p.code]
                                                    || p.code}{' '}
                                                <Text type="secondary"
                                                      style={{ fontSize: 11 }}>
                                                    {p.code}
                                                </Text>
                                            </Checkbox>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </Checkbox.Group>
                    </Form.Item>
                    {editing && !systemLocked && (
                        <Form.Item name="is_active" label="Aktif"
                                   valuePropName="checked">
                            <Switch />
                        </Form.Item>
                    )}
                    <Form.Item>
                        <Space style={{ width: '100%',
                                        justifyContent: 'flex-end' }}>
                            <Button onClick={close}>Cancel</Button>
                            <Button
                                type="primary" htmlType="submit"
                                loading={createMutation.isPending
                                    || updateMutation.isPending}
                            >
                                {editing ? 'Update' : 'Create'}
                            </Button>
                        </Space>
                    </Form.Item>
                </Form>
            </Modal>

            <DeleteModal
                open={!!deactivating}
                isActive
                itemName={deactivating?.name}
                onConfirm={() => deactivateMutation.mutate(deactivating.id)}
                onCancel={() => setDeactivating(null)}
                loading={deactivateMutation.isPending}
            />
        </>
    )
}

export default RolesTab
