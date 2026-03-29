/**
 * =============================================================================
 * HERMES - Work Lines Admin Page
 * =============================================================================
 * Admin sayfası - Work Lines CRUD işlemleri
 * =============================================================================
 */

import { useState } from 'react'
import {
    Table, Button, Modal, Form, Input, Switch, Space,
    Popconfirm, message, Card, Tag
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { workLineService } from '../services/api'
import DeleteModal from '../components/common/DeleteModal'
import { generateCode } from '../utils/codeGenerator'
import './AdminPages.css'

function WorkLinesPage() {
    const queryClient = useQueryClient()
    const [form] = Form.useForm()
    const [modalOpen, setModalOpen] = useState(false)
    const [editingItem, setEditingItem] = useState(null)

    // Fetch data
    const { data: items = [], isLoading } = useQuery({
        queryKey: ['workLines'],
        queryFn: () => workLineService.getAll(),
    })

    // Mutations
    const createMutation = useMutation({
        mutationFn: workLineService.create,
        onSuccess: () => {
            message.success('Work line created')
            queryClient.invalidateQueries(['workLines'])
            handleCloseModal()
        },
        onError: (err) => message.error(err.response?.data?.detail || 'Error'),
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => workLineService.update(id, data),
        onSuccess: () => {
            message.success('Work line updated')
            queryClient.invalidateQueries(['workLines'])
            handleCloseModal()
        },
        onError: (err) => message.error(err.response?.data?.detail || 'Error'),
    })

    const archiveMutation = useMutation({
        mutationFn: ({ id }) => workLineService.update(id, { is_active: false }),
        onSuccess: () => {
            message.success('Work line archived (soft deleted)')
            handleDeleteCancel()
            queryClient.invalidateQueries(['workLines'])
        },
        onError: (err) => message.error(err.response?.data?.detail || 'Error archiving work line'),
    })

    const deleteMutation = useMutation({
        mutationFn: workLineService.delete,
        onSuccess: () => {
            message.success({ content: 'Work line permanently deleted', style: { marginTop: '10vh' } })
            handleDeleteCancel()
            queryClient.invalidateQueries(['workLines'])
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
            sorter: (a, b) => a.name.localeCompare(b.name, 'en'),
        },
        {
            title: 'Code',
            dataIndex: 'code',
            key: 'code',
            render: (code) => <Tag color="cyan">{code}</Tag>,
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
                <h1>Work Lines</h1>
                <p>Manage work lines</p>
            </div>
            <Card
                title="Work Lines"
                extra={
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={() => setModalOpen(true)}
                    >
                        Add Work Line
                    </Button>
                }
            >
                <Table
                    dataSource={items}
                    columns={columns}
                    rowKey="id"
                    loading={isLoading}
                    pagination={false}
                    showSorterTooltip={false}
                />
            </Card>

            <Modal
                title={editingItem ? 'Edit Work Line' : 'Add Work Line'}
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
                        <Input
                            placeholder="Work Line Name"
                            onChange={(e) => {
                                if (!editingItem) {
                                    form.setFieldValue('code', generateCode(e.target.value))
                                }
                            }}
                        />
                    </Form.Item>
                    <Form.Item
                        name="code"
                        label="Code"
                        rules={[{ required: true }]}
                    >
                        <Input placeholder="Work Line Code" />
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
                isActive={deletingRecord?.is_active}
                itemName={deletingRecord?.name}
                onConfirm={handleDeleteConfirm}
                onCancel={handleDeleteCancel}
                loading={deleteMutation.isPending || archiveMutation.isPending}
            />
        </div >
    )
}

export default WorkLinesPage
