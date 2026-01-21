/**
 * =============================================================================
 * HERMES - Activity Types Admin Page
 * =============================================================================
 * Admin sayfası - Activity Types CRUD işlemleri
 * =============================================================================
 */

import { useState } from 'react'
import {
    Table, Button, Modal, Form, Input, Switch, Space,
    Popconfirm, message, Card, Tag
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { activityTypeService } from '../services/api'
import DeleteModal from '../components/common/DeleteModal'
import './AdminPages.css'

function ActivityTypesPage() {
    const queryClient = useQueryClient()
    const [form] = Form.useForm()
    const [modalOpen, setModalOpen] = useState(false)
    const [editingItem, setEditingItem] = useState(null)

    // Fetch data
    const { data: items = [], isLoading } = useQuery({
        queryKey: ['activityTypes'],
        queryFn: () => activityTypeService.getAll(),
    })

    // Mutations
    const createMutation = useMutation({
        mutationFn: activityTypeService.create,
        onSuccess: () => {
            message.success('Activity type created')
            queryClient.invalidateQueries(['activityTypes'])
            handleCloseModal()
        },
        onError: (err) => message.error(err.response?.data?.detail || 'Error'),
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => activityTypeService.update(id, data),
        onSuccess: () => {
            message.success('Activity type updated')
            queryClient.invalidateQueries(['activityTypes'])
            handleCloseModal()
        },
        onError: (err) => message.error(err.response?.data?.detail || 'Error'),
    })

    const deleteMutation = useMutation({
        mutationFn: activityTypeService.delete,
        onSuccess: () => {
            message.success({ content: 'Activity type permanently deleted', style: { marginTop: '10vh' } })
            handleDeleteCancel()
            queryClient.invalidateQueries(['activityTypes'])
        },
        onError: (err) => message.error(err.response?.data?.detail || 'Error'),
    })

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

    // Handlers
    const handleCloseModal = () => {
        setModalOpen(false)
        setEditingItem(null)
        form.resetFields()
    }

    const handleEdit = (item) => {
        setEditingItem(item)
        form.setFieldsValue(item)
        setModalOpen(true)
    }

    const handleSubmit = async () => {
        try {
            const values = await form.validateFields()
            if (editingItem) {
                updateMutation.mutate({ id: editingItem.id, data: values })
            } else {
                createMutation.mutate(values)
            }
        } catch (error) {
            console.error('Validation failed:', error)
        }
    }

    const columns = [
        {
            title: 'Name',
            dataIndex: 'name',
            key: 'name',
        },
        {
            title: 'Code',
            dataIndex: 'code',
            key: 'code',
            render: (code) => <Tag color="blue">{code}</Tag>,
        },
        {
            title: 'Description',
            dataIndex: 'description',
            key: 'description',
        },
        {
            title: 'Active',
            dataIndex: 'is_active',
            key: 'is_active',
            render: (active) => (
                <Tag color={active ? 'green' : 'red'}>
                    {active ? 'Active' : 'Inactive'}
                </Tag>
            ),
        },
        {
            title: 'Actions',
            key: 'actions',
            render: (_, record) => (
                <Space>
                    <Button
                        type="text"
                        icon={<EditOutlined />}
                        onClick={() => handleEdit(record)}
                    />
                    <Button type="text" danger icon={<DeleteOutlined />} onClick={() => handleDeleteClick(record)} />
                </Space>
            ),
        },
    ]

    return (
        <div className="admin-page fade-in">
            <div className="page-header">
                <h1>Activity Types</h1>
                <p>Manage activity types</p>
            </div>
            <Card
                title="Activity Types"
                extra={
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={() => setModalOpen(true)}
                    >
                        Add Activity Type
                    </Button>
                }
            >
                <Table
                    dataSource={items}
                    columns={columns}
                    rowKey="id"
                    loading={isLoading}
                    pagination={false}
                />
            </Card>

            <Modal
                title={editingItem ? 'Edit Activity Type' : 'Add Activity Type'}
                open={modalOpen}
                onCancel={handleCloseModal}
                onOk={handleSubmit}
                confirmLoading={createMutation.isPending || updateMutation.isPending}
            >
                <Form form={form} layout="vertical">
                    <Form.Item
                        name="name"
                        label="Name"
                        rules={[{ required: true }]}
                    >
                        <Input placeholder="Activity Type Name" />
                    </Form.Item>
                    <Form.Item
                        name="code"
                        label="Code"
                        rules={[{ required: true }]}
                    >
                        <Input placeholder="Activity Code" />
                    </Form.Item>
                    <Form.Item name="description" label="Description">
                        <Input.TextArea rows={2} />
                    </Form.Item>
                    <Form.Item
                        name="is_active"
                        label="Active"
                        valuePropName="checked"
                        initialValue={true}
                    >
                        <Switch />
                    </Form.Item>
                </Form>
            </Modal>

            <DeleteModal
                open={deleteModalOpen}
                onConfirm={handleDeleteConfirm}
                onCancel={handleDeleteCancel}
                title="Delete Activity Type"
                description="Are you sure you want to delete this activity type? This action cannot be undone."
                itemName={deletingRecord?.name}
                loading={deleteMutation.isPending}
            />
        </div >
    )
}

export default ActivityTypesPage
