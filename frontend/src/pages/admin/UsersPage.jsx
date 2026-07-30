/**
 * =============================================================================
 * HERMES PLATFORM - Users Admin Page
 * =============================================================================
 * Admin kullanıcı yönetimi sayfası (FR 3.4).
 *
 * RBAC R3:
 *   - "Roles" sekmesi eklendi (dinamik rol CRUD — RolesTab).
 *   - Kullanıcı modalındaki legacy USER/ADMIN enum seçimi kaldırıldı;
 *     yerine RBAC rol ataması geldi (çoklu seçim, subset kuralı ve
 *     son-admin kilidi backend'de).
 *   - Rol sütunundaki "is_admin ? ADMIN : role" legacy fallback'i öldü:
 *     is_admin artık system-admin rolünden TÜRETİLDİĞİ için rozet
 *     güvenilir; ham enum hiç okunmaz.
 * =============================================================================
 */

import { useMemo, useRef, useState } from 'react'
import { Card, Table, Button, Space, Modal, Form, Input, message, Select, Switch, Tag, Tabs } from 'antd'
import {
    PlusOutlined, EditOutlined, DeleteOutlined, UserOutlined, CrownOutlined,
    SearchOutlined,
} from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { authService, rbacService } from '../../services/api'
import DeleteModal from '../../components/common/DeleteModal'
import { normalizeApiError } from '../../features/admin/shared/normalizeApiError'
import {
    AdminErrorAlert, AdminRefreshHint,
} from '../../features/admin/shared/AdminListStates'
import { adminEmptyText } from '../../features/admin/shared/adminEmptyText'
import { pickFields, resetAndFill } from '../../features/admin/shared/formLifecycle'

import UserGroupsTab from './UserGroupsTab'
import RolesTab from './RolesTab'
import './UsersPage.css'
/**
 * Formda GERCEKTEN olan alanlar. `password` bilerek `undefined`: bos
 * string yazilirsa duzenlemede sunucuya BOS PAROLA gonderilebilirdi.
 * `role_ids` ayrica yuklenir (asenkron).
 */
const FORM_SHAPE = {
    email: '', full_name: '', password: undefined, is_active: true,
}


export function UsersTab() {
    const [form] = Form.useForm()
    const [modalOpen, setModalOpen] = useState(false)
    const [editingId, setEditingId] = useState(null)
    // Acilis jetonu: geciken rol yanitinin YANLIS forma yazilmasini onler.
    const openTokenRef = useRef(0)
    const queryClient = useQueryClient()

    const [search, setSearch] = useState('')
    const {
        data: usersData, isLoading, isFetching, isError, error, refetch,
    } = useQuery({
        queryKey: ['users'],
        queryFn: () => authService.getUsers(),
    })
    // `usersData?.data || []` her render'da YENI bir dizi uretir; bu
    // durumda asagidaki useMemo hic ise yaramaz. Referans stabil tutulur.
    const users = useMemo(() => usersData?.data || [], [usersData])

    /** Arama: e-posta ve tam adda. */
    const query = search.trim().toLowerCase()
    const filteredUsers = useMemo(() => {
        if (!query) return users
        return users.filter((u) =>
            [u.email, u.full_name]
                .filter(Boolean)
                .some((val) => String(val).toLowerCase().includes(query))
        )
    }, [users, query])

    // Atanabilir roller (aktif) — kullanıcı modalındaki çoklu seçim için.
    const { data: rolesData } = useQuery({
        queryKey: ['rbac-roles-active'],
        queryFn: () => rbacService.listRoles(false),
    })
    const assignableRoles = rolesData?.roles || []

    const invalidateUsers = () => {
        queryClient.invalidateQueries({ queryKey: ['users'] })
        queryClient.invalidateQueries({ queryKey: ['rbac-roles'] })
        queryClient.invalidateQueries({ queryKey: ['rbac-roles-active'] })
    }

    // Kullanıcı kaydet + rol kümesini uygula (iki adım; rol hatası ayrı
    // ve açıkça raporlanır — kısmi başarı sessizce yutulmaz).
    const saveMutation = useMutation({
        mutationFn: async ({ id, data, roleIds }) => {
            let userId = id
            if (id) {
                await authService.updateUser(id, data)
            } else {
                const created = await authService.createUser(data)
                userId = created?.id || created?.data?.id
            }
            if (userId && roleIds !== undefined) {
                try {
                    await rbacService.setUserRoles(userId, roleIds)
                } catch (e) {
                    const detail = e.response?.data?.detail
                    throw new Error(
                        `Kullanıcı kaydedildi ama roller uygulanamadı: ${detail || e.message}`
                    )
                }
            }
        },
        onSuccess: () => {
            message.success(editingId ? 'User updated' : 'User created')
            handleCloseModal()
            invalidateUsers()
        },
        onError: (err) => {
            // Rol uygulama KISMI basarisizligi yerel olarak firlatilir:
            // HTTP yaniti yoktur ama mesaji kritiktir ("kullanici
            // kaydedildi ama roller uygulanamadi"). normalizeApiError
            // bunu "sunucuya ulasilamiyor" sanip EZERDI.
            const isLocal = !err?.response && !err?.isAxiosError
            message.error(
                isLocal && err?.message ? err.message : normalizeApiError(err).message
            )
        },
    })

    const archiveMutation = useMutation({
        mutationFn: ({ id }) => authService.updateUser(id, { is_active: false }),
        onSuccess: () => {
            message.success('User archived (soft deleted)')
            handleDeleteCancel()
            invalidateUsers()
        },
        onError: (err) => message.error(normalizeApiError(err).message),
    })

    const deleteMutation = useMutation({
        mutationFn: authService.deleteUser,
        onSuccess: () => {
            message.success({ content: 'User permanently deleted', style: { marginTop: '10vh' } })
            handleDeleteCancel()
            invalidateUsers()
        },
        onError: (err) => {
            // Kullanimda olan kayit silinemez; ARSIVLEME yolu gosterilir.
            const n = normalizeApiError(err)
            message.error(
                n.kind === 'conflict' || n.status === 400
                    ? `${n.message} Try archiving it instead.`
                    : n.message
            )
        },
    })

    const [deleteModalOpen, setDeleteModalOpen] = useState(false)
    const [deletingRecord, setDeletingRecord] = useState(null)

    const handleDeleteClick = (record) => {
        setDeletingRecord(record)
        setDeleteModalOpen(true)
    }

    const handleDeleteConfirm = () => {
        if (isDestroying) return
        if (deletingRecord) {
            if (deletingRecord.is_active) {
                archiveMutation.mutate({ id: deletingRecord.id })
            } else {
                deleteMutation.mutate(deletingRecord.id)
            }
        }
    }

    const handleDeleteCancel = () => {
        setDeleteModalOpen(false)
        setDeletingRecord(null)
    }

    const handleOpenModal = async (record = null) => {
        // Her acilis kendi jetonunu alir: Edit A acilip HEMEN Edit B
        // acilirsa, A'nin geciken rol yaniti B'nin formuna YAZILMAZ.
        const token = ++openTokenRef.current
        if (record) {
            setEditingId(record.id)
            // Edit A → Edit B gecisinde A'nin degeri (parola dahil)
            // TASINMAZ; `setFieldsValue` tek basina SIG birlestirir.
            resetAndFill(form, pickFields(record, FORM_SHAPE))
            setModalOpen(true)
            try {
                const r = await rbacService.getUserRoles(record.id)
                if (token !== openTokenRef.current) return
                form.setFieldsValue({
                    role_ids: (r.roles || []).map((x) => x.id),
                })
            } catch {
                if (token !== openTokenRef.current) return
                form.setFieldsValue({ role_ids: [] })
            }
            return
        }
        setEditingId(null)
        resetAndFill(form, null)
        setModalOpen(true)
    }

    const handleCloseModal = () => { setModalOpen(false); setEditingId(null); form.resetFields() }

    const isSaving = saveMutation.isPending
    const isDestroying = archiveMutation.isPending || deleteMutation.isPending

    const handleSubmit = async (values) => {
        // Cift gonderim kilidi KAYNAKTA: buton `loading`i bir render GEC
        // gelir, arada iki kayit istegi acilabiliyordu.
        if (isSaving) return
        const { role_ids, ...data } = values
        saveMutation.mutate({ id: editingId, data, roleIds: role_ids ?? [] })
    }

    const columns = [
        { title: 'Email', dataIndex: 'email', key: 'email', sorter: (a, b) => a.email.localeCompare(b.email) },
        { title: 'Full Name', dataIndex: 'full_name', key: 'full_name' },
        {
            title: 'Role',
            dataIndex: 'is_admin',
            key: 'is_admin',
            width: 120,
            render: (isAdmin) =>
                // is_admin artık system-admin ROLÜNDEN türetiliyor —
                // rozet güvenilir; detaylı roller düzenleme modalında.
                isAdmin
                    ? <Tag icon={<CrownOutlined />} color="gold">Admin</Tag>
                    : <Tag icon={<UserOutlined />} color="blue">User</Tag>,
        },
        { title: 'Status', dataIndex: 'is_active', key: 'is_active', width: 100, render: (active) => <Tag color={active ? 'success' : 'default'}>{active ? 'Active' : 'Inactive'}</Tag> },
        {
            title: 'Actions', key: 'actions', width: 120, render: (_, record) => (
                <Space>
                    <Button
                        type="text"
                        icon={<EditOutlined />}
                        aria-label={`Edit ${record.email}`}
                        onClick={() => handleOpenModal(record)}
                    />
                    <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label={
                            record.is_active
                                ? `Archive ${record.email}`
                                : `Delete ${record.email} permanently`
                        }
                        onClick={() => handleDeleteClick(record)}
                    />
                </Space>
            )
        },
    ]

    return (
        <>
            <AdminErrorAlert error={isError ? error : null} onRetry={refetch} />

            <Card
                title={`📋 User List (${filteredUsers.length})`}
                extra={
                    <Space wrap>
                        <Input
                            allowClear
                            prefix={<SearchOutlined aria-hidden="true" />}
                            placeholder="Search users"
                            aria-label="Search Users"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={{ width: 220 }}
                        />
                        <Button type="primary" icon={<PlusOutlined />} onClick={() => handleOpenModal()}>
                            New User
                        </Button>
                    </Space>
                }
            >
                <Table
                    dataSource={filteredUsers}
                    columns={columns}
                    rowKey="id"
                    /* Ilk yukleme ile arkaplan yenilemesi AYRI. */
                    loading={isLoading && users.length === 0}
                    pagination={{ pageSize: 10 }}
                    scroll={{ x: 'max-content' }}
                    locale={{
                        emptyText: adminEmptyText({
                            filtered: !!query,
                            entityPlural: 'users',
                            createLabel: 'New User',
                            term: search.trim(),
                        }),
                    }}
                />
                <AdminRefreshHint isFetching={isFetching} hasData={users.length > 0} />
            </Card>
            <Modal title={editingId ? '✏️ Edit User' : '➕ New User'} open={modalOpen} onCancel={handleCloseModal} footer={null}>
                <Form form={form} layout="vertical" onFinish={handleSubmit}>
                    <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email', message: 'Enter a valid email' }]}>
                        <Input placeholder="example@company.com" disabled={!!editingId} />
                    </Form.Item>
                    <Form.Item name="full_name" label="Full Name">
                        <Input placeholder="Full Name" />
                    </Form.Item>
                    {!editingId && (
                        <Form.Item name="password" label="Password" rules={[{ required: true, min: 6, message: 'Password must be at least 6 characters' }]}>
                            <Input.Password placeholder="Password" />
                        </Form.Item>
                    )}
                    {editingId && <Form.Item name="is_active" label="Status" valuePropName="checked"><Switch checkedChildren="Active" unCheckedChildren="Inactive" /></Form.Item>}

                    <Form.Item
                        name="role_ids"
                        label="Roles"
                        extra="Yetkiler rollerden gelir. Sahip olmadığınız izinleri içeren bir rolü atayamazsınız (subset kuralı); son aktif yönetici düşürülemez."
                    >
                        <Select
                            mode="multiple"
                            placeholder="Rol seçin"
                            optionFilterProp="label"
                            options={assignableRoles.map((r) => ({
                                value: r.id,
                                label: r.name,
                            }))}
                        />
                    </Form.Item>

                    <Form.Item><Space style={{ width: '100%', justifyContent: 'flex-end' }}><Button onClick={handleCloseModal}>Cancel</Button><Button type="primary" htmlType="submit" loading={isSaving}>{editingId ? 'Update' : 'Create'}</Button></Space></Form.Item>
                </Form>
            </Modal>

            <DeleteModal
                open={deleteModalOpen}
                isActive={deletingRecord?.is_active}
                itemName={deletingRecord?.full_name || deletingRecord?.email}
                onConfirm={handleDeleteConfirm}
                onCancel={handleDeleteCancel}
                loading={isDestroying}
            />
        </>
    )
}

function UsersPage() {
    return (
        <div className="users-page fade-in">
            <div className="page-header">
                <h1>Users</h1>
                <p>Manage users, roles and groups</p>
            </div>
            <Tabs
                className="users-page-tabs"
                items={[
                    { key: 'users', label: 'Users', children: <UsersTab /> },
                    { key: 'roles', label: 'Roles', children: <RolesTab /> },
                    { key: 'groups', label: 'Groups', children: <UserGroupsTab /> },
                ]}
            />
        </div>
    )
}

export default UsersPage
