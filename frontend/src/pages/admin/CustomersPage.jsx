/**
 * =============================================================================
 * HERMES PLATFORM - Customers Admin Page
 * =============================================================================
 * Admin müşteri yönetimi sayfası (FR 3.1).
 * =============================================================================
 */

import { useState } from 'react'
import {
    Card, Table, Button, Space, Modal, Form, Input,
    message, Popconfirm, Typography, Switch, Tag
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, TeamOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { customerService } from '../../services/api'
import DeleteModal from '../../components/common/DeleteModal'

const { Title, Text } = Typography

function CustomersPage() {
    const [form] = Form.useForm()
    const [modalOpen, setModalOpen] = useState(false)
    const [editingId, setEditingId] = useState(null)
    const queryClient = useQueryClient()

    // Data fetching
    const { data: customers = [], isLoading } = useQuery({
        queryKey: ['customers', { include_inactive: true }],
        queryFn: () => customerService.getAll({ include_inactive: true }),
    })

    // Mutations
    const createMutation = useMutation({
        mutationFn: customerService.create,
        onSuccess: () => {
            message.success('Customer created')
            handleCloseModal()
            queryClient.invalidateQueries(['customers'])
        },
        onError: (err) => message.error(err.response?.data?.detail || 'Hata'),
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => customerService.update(id, data),
        onSuccess: () => {
            message.success('Customer updated')
            handleCloseModal()
            queryClient.invalidateQueries(['customers'])
        },
        onError: (err) => message.error(err.response?.data?.detail || 'Hata'),
    })

    const deleteMutation = useMutation({
        mutationFn: customerService.delete,
        onSuccess: () => {
            message.success({ content: 'Customer permanently deleted', style: { marginTop: '10vh' } })
            handleDeleteCancel()
            queryClient.invalidateQueries(['customers'])
        },
        onError: (err) => message.error(err.response?.data?.detail || 'Hata'),
    })

    // Handlers
    const handleOpenModal = (record = null) => {
        if (record) {
            setEditingId(record.id)
            form.setFieldsValue(record)
        } else {
            setEditingId(null)
            form.resetFields()
        }
        setModalOpen(true)
    }

    const handleCloseModal = () => {
        setModalOpen(false)
        setEditingId(null)
        form.resetFields()
    }

    const handleSubmit = async (values) => {
        if (editingId) {
            updateMutation.mutate({ id: editingId, data: values })
        } else {
            createMutation.mutate(values)
        }
    }

    // Delete Modal State
    const [deleteModalOpen, setDeleteModalOpen] = useState(false)
    const [deletingRecord, setDeletingRecord] = useState(null)

    const handleDeleteClick = (record) => {
        setDeletingRecord(record)
        setDeleteModalOpen(true)
    }

    const handleDeleteConfirm = () => {
        if (deletingRecord) {
            deleteMutation.mutate(deletingRecord.id)
        }
    }

    const handleDeleteCancel = () => {
        setDeleteModalOpen(false)
        setDeletingRecord(null)
    }

    // Table columns
    const columns = [
        {
            title: 'Customers',
            subTitle: 'Manage customer accounts',
            dataIndex: 'name',
            key: 'name',
            sorter: (a, b) => a.name.localeCompare(b.name),
        },
        {
            title: 'Status',
            dataIndex: 'is_active',
            key: 'is_active',
            width: 100,
            render: (active) => (
                <Tag color={active ? 'success' : 'default'}>
                    {active ? 'Active' : 'Inactive'}
                </Tag>
            ),
        },
        {
            title: 'Created At',
            dataIndex: 'created_at',
            key: 'created_at',
            width: 150,
            render: (date) => new Date(date).toLocaleDateString('en-GB'),
        },
        {
            title: 'Actions',
            key: 'actions',
            width: 120,
            render: (_, record) => (
                <Space>
                    <Button type="text" icon={<EditOutlined />} onClick={() => handleOpenModal(record)} />
                    <Button type="text" danger icon={<DeleteOutlined />} onClick={() => handleDeleteClick(record)} />
                </Space>
            ),
        },
    ]

    return (
        <div className="customers-page fade-in">
            <div className="page-header">
                <h1>Customers</h1>
                <p>Manage user accounts and organization details</p>
            </div>

            <Card
                title={`📋 Customer List (${customers.length})`}
                extra={
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => handleOpenModal()}>
                        New Customer
                    </Button>
                }
            >
                <Table
                    dataSource={customers}
                    columns={columns}
                    rowKey="id"
                    loading={isLoading}
                    pagination={{ pageSize: 10 }}
                />
            </Card>

            {/* Edit/Create Modal */}
            <Modal
                title={editingId ? '✏️ Edit Customer' : '➕ New Customer'}
                open={modalOpen}
                onCancel={handleCloseModal}
                footer={null}
            >
                <Form form={form} layout="vertical" onFinish={handleSubmit}>
                    <Form.Item
                        name="name"
                        label="Customer Name"
                        rules={[{ required: true, message: 'Customer name is required' }]}
                    >
                        <Input placeholder="e.g. ABC Tech Inc." />
                    </Form.Item>

                    {editingId && (
                        <Form.Item name="is_active" label="Status" valuePropName="checked">
                            <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
                        </Form.Item>
                    )}

                    <Form.Item>
                        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
                            <Button onClick={handleCloseModal}>Cancel</Button>
                            <Button
                                type="primary"
                                htmlType="submit"
                                loading={createMutation.isPending || updateMutation.isPending}
                            >
                                {editingId ? 'Update' : 'Create'}
                            </Button>
                        </Space>
                    </Form.Item>
                </Form>
            </Modal>

            {/* Custom Delete Modal */}
            <DeleteModal
                open={deleteModalOpen}
                title="Delete Customer"
                description="Are you sure you want to delete this customer? This will permanently remove it from the system."
                itemName={deletingRecord?.name}
                onConfirm={handleDeleteConfirm}
                onCancel={handleDeleteCancel}
                loading={deleteMutation.isPending}
            />
        </div>
    )
}

export default CustomersPage
