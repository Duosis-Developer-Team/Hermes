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
import {
    applyErrorToForm, normalizeApiError,
} from '../../features/admin/shared/normalizeApiError'
import { resetAndFill } from '../../features/admin/shared/formLifecycle'

// Formda GERCEKTEN olan alanlar. Alanlar MODA GORE kosullu cizildigi
// icin (code yalniz olusturmada, is_active yalniz edit-ve-system-degil)
// her acilista tam sekil yazilir — aksi halde bir rolun degeri
// digerinin formunda kalir.
const FORM_FIELDS = ['code', 'name', 'description', 'permissions', 'is_active']

const { Text } = Typography

// Izin kodu → Turkce etiket (UI-yerel; katalog backend'de).
const PERMISSION_LABELS = {
    'users.manage': 'User management',
    'roles.manage': 'Role management',
    'groups.manage': 'Group management',
    'tasks.access': 'Task module access',
    'tasks.assign': 'Assign tasks',
    'issues.access': 'Issues & suggestions access',
    'issues.assign': 'Assign issues & suggestions',
    'tasks.admin': 'Full task module authority',
    'tasks.permissions.manage': 'PM configuration management',
    'api.manage': 'API Management (Developer Platform)',
    'reports.view': 'Company-wide reports',
    'plans.manage': 'Plan & schedule management',
    'worklogs.admin': 'Work logs on behalf of others',
    'meetings.admin': 'All meetings + sync',
    'customers.manage': 'Customer management',
    'projects.manage': 'Project management',
    'reference.manage': 'Reference data (work types etc.)',
}

/*
 * Bagimlilik kurallari — backend shared/permissions.PERMISSION_REQUIRES
 * aynasi. Asil zorlayici auth-service'tir (422); burasi yalnizca
 * checkbox davranisini kullaniciya dogru yasatir:
 *   - assign isaretlenince ayni scope'un access'i otomatik eklenir,
 *   - access kaldirilinca ayni scope'un assign'i da kalkar.
 */
const PERMISSION_REQUIRES = {
    'tasks.assign': 'tasks.access',
    'issues.assign': 'issues.access',
}

const applyPermissionDependencies = (next = [], prev = []) => {
    const set = new Set(next)
    for (const [dep, req] of Object.entries(PERMISSION_REQUIRES)) {
        if (set.has(dep) && !set.has(req)) {
            if (!prev.includes(dep)) set.add(req)
            else set.delete(dep)
        }
    }
    return [...set]
}

// Kod onekine gore grup basligi.
const GROUP_LABELS = {
    users: 'Administration',
    roles: 'Administration',
    groups: 'Administration',
    api: 'Administration',
    tasks: 'Task Module',
    issues: 'Task Module',
    reports: 'Reporting',
    plans: 'Time & Planning',
    worklogs: 'Time & Planning',
    meetings: 'Time & Planning',
    customers: 'Configuration',
    projects: 'Configuration',
    reference: 'Configuration',
}

function groupCatalog(catalog) {
    const groups = new Map()
    for (const p of catalog) {
        const prefix = p.code.split('.')[0]
        const label = GROUP_LABELS[prefix] || 'Other'
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
    const [formError, setFormError] = useState(null)
    const queryClient = useQueryClient()

    const {
        data: rolesData, isLoading, isError, error, refetch,
    } = useQuery({
        queryKey: ['rbac-roles'],
        queryFn: () => rbacService.listRoles(true),
    })
    const { data: catalogData } = useQuery({
        queryKey: ['rbac-catalog'],
        queryFn: () => rbacService.getPermissionCatalog(),
        staleTime: 5 * 60 * 1000,
    })
    const roles = rolesData?.roles || []
    // `catalogData?.permissions || []` her render'da YENI dizi uretir;
    // memo bagimliligi surekli degisirdi. Referans stabil tutulur.
    const catalog = useMemo(() => catalogData?.permissions || [], [catalogData])
    const grouped = useMemo(() => groupCatalog(catalog), [catalog])

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ['rbac-roles'] })
    }

    /**
     * Hata alanlara baglanir; baglanamayan mesaj FORM ustunde durur.
     * Onceki davranis `|| 'Hata'` idi: alan hatalari hic baglanmiyor,
     * teknik govdeler (stack trace, sqlalchemy) dogrudan gosterilebiliyor
     * ve sunucu aciklama gondermediginde kullaniciya "Hata" deniyordu.
     */
    const showFormError = (e) => {
        const leftover = applyErrorToForm(e, form, FORM_FIELDS)
        if (leftover) setFormError(leftover)
    }

    const createMutation = useMutation({
        mutationFn: rbacService.createRole,
        onSuccess: () => { message.success('Role created.'); close(); invalidate() },
        onError: showFormError,
    })
    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => rbacService.updateRole(id, data),
        onSuccess: () => { message.success('Role updated.'); close(); invalidate() },
        onError: showFormError,
    })
    const deactivateMutation = useMutation({
        mutationFn: rbacService.deactivateRole,
        onSuccess: () => {
            message.success('Role deactivated — its permissions no longer apply.')
            setDeactivating(null); invalidate()
        },
        onError: (e) => {
            // Kullanimda olan rol ya da son-admin kilidi: sunucunun
            // aciklamasi KRITIK, generic metnin altinda kaybolmaz.
            message.error(normalizeApiError(e).message)
            setDeactivating(null)
        },
    })

    const isSaving = createMutation.isPending || updateMutation.isPending
    const isDeactivating = deactivateMutation.isPending

    const open = (role = null) => {
        setEditing(role)
        setFormError(null)
        // resetAndFill: TAM sekil yazilir. Onceden resetFields YOKTU ve
        // `setFieldsValue` sig birlestirdigi icin Edit A → Edit B
        // geciste A'nin (orn. eksik olan) aciklamasi B'de kaliyordu.
        resetAndFill(form, role
            ? {
                code: role.code ?? '',
                name: role.name ?? '',
                description: role.description ?? '',
                permissions: role.permissions ?? [],
                is_active: role.is_active ?? true,
            }
            : { code: '', name: '', description: '', permissions: [], is_active: true })
        setModalOpen(true)
    }
    const close = () => {
        setModalOpen(false); setEditing(null); setFormError(null); form.resetFields()
    }

    const submit = (values) => {
        // Cift gonderim kilidi KAYNAKTA: buton `loading`i bir render GEC
        // gelir, arada ikinci istek acilabiliyordu.
        if (isSaving) return
        setFormError(null)
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
            title: 'Role', dataIndex: 'name', key: 'name',
            render: (name, r) => (
                <Space>
                    {r.is_system && <LockOutlined title="System role" />}
                    <span>{name}</span>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                        {r.code}
                    </Text>
                </Space>
            ),
        },
        {
            title: 'Permissions', dataIndex: 'permissions', key: 'permissions',
            render: (perms) => (
                <Text type="secondary">{perms.length} izin</Text>
            ),
        },
        {
            title: 'Members', dataIndex: 'member_count', key: 'member_count',
            width: 80,
        },
        {
            title: 'Status', dataIndex: 'is_active', key: 'is_active',
            width: 100,
            render: (a) => (
                <Tag color={a ? 'success' : 'default'}>
                    {a ? 'Active' : 'Inactive'}
                </Tag>
            ),
        },
        {
            title: 'Actions', key: 'actions', width: 120,
            render: (_, r) => (
                <Space>
                    {/* Ikon-only aksiyonlar HANGI rolu hedefledigini soyler. */}
                    <Button type="text" icon={<EditOutlined />}
                            aria-label={`Edit ${r.name}`}
                            disabled={isDeactivating}
                            onClick={() => open(r)} />
                    {!r.is_system && r.is_active && (
                        <Button type="text" danger icon={<StopOutlined />}
                                aria-label={`Deactivate ${r.name}`}
                                disabled={isDeactivating}
                                onClick={() => setDeactivating(r)} />
                    )}
                </Space>
            ),
        },
    ]

    const systemLocked = editing?.is_system

    return (
        <>
            {isError && (
                <Alert
                    type="error"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message={normalizeApiError(error).message}
                    action={
                        <Button size="small" onClick={() => refetch()}>
                            Retry
                        </Button>
                    }
                />
            )}
            <Card variant="borderless"
                title={`Roles (${roles.length})`}
                extra={
                    <Button type="primary" icon={<PlusOutlined />}
                            onClick={() => open()}>
                        New Role
                    </Button>
                }
            >
                <Table
                    dataSource={roles} columns={columns} rowKey="id"
                    loading={isLoading && roles.length === 0} pagination={false}
                    scroll={{ x: 'max-content' }}
                    locale={{ emptyText: 'No roles defined yet. Use “New Role”.' }}
                />
            </Card>

            <Modal
                title={editing ? `Edit Role — ${editing.name}` : 'New Role'}
                open={modalOpen} onCancel={close} footer={null} width={640}
                closable={!isSaving}
                maskClosable={!isSaving}
                keyboard={!isSaving}
            >
                {formError && (
                    <Alert
                        type="error" showIcon style={{ marginBottom: 12 }}
                        message={formError}
                    />
                )}
                {systemLocked && (
                    <Alert
                        type="info" showIcon style={{ marginBottom: 16 }}
                        message="System role is locked"
                        description="Name, permissions and active state cannot be changed; the permission set stays in sync with the catalog automatically. Only the description is editable."
                    />
                )}
                <Form form={form} layout="vertical" onFinish={submit}>
                    {!editing && (
                        <Form.Item
                            name="code" label="Code (permanent, cannot be changed)"
                            rules={[
                                { required: true, message: 'Code gerekli' },
                                {
                                    pattern: /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/,
                                    message: 'lowercase letters/digits/hyphens, 3-64 chars',
                                },
                            ]}
                        >
                            <Input placeholder="report-viewer" />
                        </Form.Item>
                    )}
                    <Form.Item
                        name="name" label="Name"
                        rules={[{ required: true, message: 'Name is required' }]}
                    >
                        <Input disabled={systemLocked} />
                    </Form.Item>
                    <Form.Item name="description" label="Description">
                        <Input.TextArea rows={2} />
                    </Form.Item>
                    <Form.Item
                        name="permissions"
                        label="Permissions"
                        normalize={applyPermissionDependencies}
                    >
                        <Checkbox.Group
                            style={{ width: '100%' }}
                            disabled={systemLocked}
                        >
                            {/* Premium redesign: kesintisiz checkbox dokumu
                                yerine ACIK grup basliklari + secili satirda
                                soft accent wash. Davranis/degerler AYNI. */}
                            {grouped.map(([groupLabel, perms]) => (
                                <div key={groupLabel} className="role-perm-group">
                                    <div className="role-perm-group__title">{groupLabel}</div>
                                    <div className="role-perm-group__items">
                                        {perms.map((p) => (
                                            <Checkbox key={p.code}
                                                      value={p.code}
                                                      className="role-perm-item">
                                                <span className="role-perm-item__label">
                                                    {PERMISSION_LABELS[p.code] || p.code}
                                                </span>
                                                <span className="role-perm-item__code">{p.code}</span>
                                            </Checkbox>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </Checkbox.Group>
                    </Form.Item>
                    {editing && !systemLocked && (
                        <Form.Item name="is_active" label="Active"
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
                                loading={isSaving}
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
                onConfirm={() => {
                    if (isDeactivating || !deactivating) return
                    deactivateMutation.mutate(deactivating.id)
                }}
                onCancel={() => setDeactivating(null)}
                loading={isDeactivating}
            />
        </>
    )
}

export default RolesTab
