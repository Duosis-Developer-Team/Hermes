/**
 * =============================================================================
 * HERMES PLATFORM - Users Admin Page
 * =============================================================================
 * Admin kullanıcı yönetimi sayfası (FR 3.4).
 * =============================================================================
 */

import { useState } from 'react'
import { Card, Table, Button, Space, Modal, Form, Input, message, Popconfirm, Typography, Switch, Tag, Checkbox, Select, Tabs } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, UserOutlined, CrownOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { authService } from '../../services/api'
import DeleteModal from '../../components/common/DeleteModal'
import UserGroupsTab from './UserGroupsTab'
import './UsersPage.css'

const { Title, Text } = Typography

function UsersTab() {
    const [form] = Form.useForm()
    const [modalOpen, setModalOpen] = useState(false)
    const [editingId, setEditingId] = useState(null)
    const queryClient = useQueryClient()

    const { data: usersData, isLoading } = useQuery({
        queryKey: ['users'],
        queryFn: () => authService.getUsers(),
    })
    const users = usersData?.data || []

    const createMutation = useMutation({
        mutationFn: authService.createUser,
        onSuccess: () => { message.success('User created'); handleCloseModal(); queryClient.invalidateQueries(['users']) },
        onError: (err) => message.error(err.response?.data?.detail || 'Error'),
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => authService.updateUser(id, data),
        onSuccess: () => { message.success('User updated'); handleCloseModal(); queryClient.invalidateQueries(['users']) },
        onError: (err) => message.error(err.response?.data?.detail || 'Error'),
    })

    const archiveMutation = useMutation({
        mutationFn: ({ id }) => authService.updateUser(id, { is_active: false }),
        onSuccess: () => {
            message.success('User archived (soft deleted)')
            handleDeleteCancel()
            queryClient.invalidateQueries(['users'])
        },
        onError: (err) => message.error(err.response?.data?.detail || 'Error archiving user'),
    })

    const deleteMutation = useMutation({
        mutationFn: authService.deleteUser,
        onSuccess: () => {
            message.success({ content: 'User permanently deleted', style: { marginTop: '10vh' } })
            handleDeleteCancel()
            queryClient.invalidateQueries(['users'])
        },
        onError: (err) => message.error(err.response?.data?.detail || 'Unable to delete (Constraint Error). Try archiving instead.'),
    })

    const [deleteModalOpen, setDeleteModalOpen] = useState(false)
    const [deletingRecord, setDeletingRecord] = useState(null)

    const handleDeleteClick = (record) => {
        setDeletingRecord(record)
        setDeleteModalOpen(true)
    }

    const handleDeleteConfirm = () => {
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

    const handleOpenModal = (record = null) => {
        if (record) { setEditingId(record.id); form.setFieldsValue(record) }
        else { setEditingId(null); form.resetFields() }
        setModalOpen(true)
    }

    const handleCloseModal = () => { setModalOpen(false); setEditingId(null); form.resetFields() }

    const handleSubmit = async (values) => {
        if (editingId) updateMutation.mutate({ id: editingId, data: values })
        else createMutation.mutate(values)
    }

    const columns = [
        { title: 'Email', dataIndex: 'email', key: 'email', sorter: (a, b) => a.email.localeCompare(b.email) },
        { title: 'Full Name', dataIndex: 'full_name', key: 'full_name' },
        {
            title: 'Role',
            dataIndex: 'role',
            key: 'role',
            width: 120,
            render: (role, record) => {
                // If legacy is_admin is true but role is USER, assume ADMIN for display until migrated
                const effectiveRole = record.is_admin ? 'ADMIN' : (role || 'USER')

                let color = 'default'
                let icon = <UserOutlined />

                if (effectiveRole === 'ADMIN') { color = 'gold'; icon = <CrownOutlined /> }
                else { color = 'blue' }

                return <Tag icon={icon} color={color}>{effectiveRole}</Tag>
            }
        },
        { title: 'Status', dataIndex: 'is_active', key: 'is_active', width: 100, render: (active) => <Tag color={active ? 'success' : 'default'}>{active ? 'Active' : 'Inactive'}</Tag> },
        {
            title: 'Actions', key: 'actions', width: 120, render: (_, record) => (
                <Space>
                    <Button type="text" icon={<EditOutlined />} onClick={() => handleOpenModal(record)} />
                    <Button type="text" danger icon={<DeleteOutlined />} onClick={() => handleDeleteClick(record)} />
                </Space>
            )
        },
    ]

    return (
        <>
            <Card title={`📋 User List (${users.length})`} extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => handleOpenModal()}>New User</Button>}>
                <Table dataSource={users} columns={columns} rowKey="id" loading={isLoading} pagination={{ pageSize: 10 }} scroll={{ x: 'max-content' }} />
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

                    <Form.Item name="role" label="Role" initialValue="USER">
                        <Select>
                            <Select.Option value="USER">User</Select.Option>
                            <Select.Option value="ADMIN">Admin</Select.Option>
                        </Select>
                    </Form.Item>

                    <Form.Item><Space style={{ width: '100%', justifyContent: 'flex-end' }}><Button onClick={handleCloseModal}>Cancel</Button><Button type="primary" htmlType="submit" loading={createMutation.isPending || updateMutation.isPending}>{editingId ? 'Update' : 'Create'}</Button></Space></Form.Item>
                </Form>
            </Modal>

            <DeleteModal
                open={deleteModalOpen}
                isActive={deletingRecord?.is_active}
                itemName={deletingRecord?.full_name || deletingRecord?.email}
                onConfirm={handleDeleteConfirm}
                onCancel={handleDeleteCancel}
                loading={deleteMutation.isPending || archiveMutation.isPending}
            />
        </>
    )
}

function UsersPage() {
    return (
        <div className="users-page fade-in">
            <div className="page-header">
                <h1>Users</h1>
                <p>Manage users and groups</p>
            </div>
            <Tabs
                className="users-page-tabs"
                items={[
                    { key: 'users', label: 'Users', children: <UsersTab /> },
                    { key: 'groups', label: 'Groups', children: <UserGroupsTab /> },
                ]}
            />
        </div>
    )
}

export default UsersPage
