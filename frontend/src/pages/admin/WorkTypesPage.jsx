/**
 * =============================================================================
 * HERMES PLATFORM - Work Types Admin Page
 * =============================================================================
 * Admin iş tipi yönetimi sayfası (FR 3.2).
 * =============================================================================
 */

import { useState } from 'react'
import { Card, Table, Button, Space, Modal, Form, Input, message, Popconfirm, Typography, Switch, Tag } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, AppstoreOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { workTypeService } from '../../services/api'
import DeleteModal from '../../components/common/DeleteModal'

const { Title, Text } = Typography

function WorkTypesPage() {
    const [form] = Form.useForm()
    const [modalOpen, setModalOpen] = useState(false)
    const [editingId, setEditingId] = useState(null)
    const queryClient = useQueryClient()

    const { data: workTypes = [], isLoading } = useQuery({
        queryKey: ['workTypes', { include_inactive: true }],
        queryFn: () => workTypeService.getAll({ include_inactive: true }),
    })

    const createMutation = useMutation({
        mutationFn: workTypeService.create,
        onSuccess: () => { message.success('Work type created'); handleCloseModal(); queryClient.invalidateQueries(['workTypes']) },
        onError: (err) => message.error(err.response?.data?.detail || 'Error'),
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => workTypeService.update(id, data),
        onSuccess: () => { message.success('Work type updated'); handleCloseModal(); queryClient.invalidateQueries(['workTypes']) },
        onError: (err) => message.error(err.response?.data?.detail || 'Error'),
    })

    const archiveMutation = useMutation({
        mutationFn: ({ id }) => workTypeService.update(id, { is_active: false }),
        onSuccess: () => {
            message.success('Work type archived (soft deleted)')
            handleDeleteCancel()
            queryClient.invalidateQueries(['workTypes'])
        },
        onError: (err) => message.error(err.response?.data?.detail || 'Error archiving work type'),
    })

    const deleteMutation = useMutation({
        mutationFn: workTypeService.delete,
        onSuccess: () => {
            message.success({ content: 'Work type permanently deleted', style: { marginTop: '10vh' } })
            handleDeleteCancel()
            queryClient.invalidateQueries(['workTypes'])
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
        { title: 'Work Type Name', dataIndex: 'name', key: 'name', sorter: (a, b) => a.name.localeCompare(b.name) },
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
        <div className="work-types-page fade-in">
            <div className="page-header">
                <h1>Work Types</h1>
                <p>Manage work types</p>
            </div>
            <Card title={`📋 Work Type List (${workTypes.length})`} extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => handleOpenModal()}>New Work Type</Button>}>
                <Table dataSource={workTypes} columns={columns} rowKey="id" loading={isLoading} pagination={{ pageSize: 10 }} />
            </Card>
            <Modal title={editingId ? '✏️ Edit Work Type' : '➕ New Work Type'} open={modalOpen} onCancel={handleCloseModal} footer={null}>
                <Form form={form} layout="vertical" onFinish={handleSubmit}>
                    <Form.Item name="name" label="Work Type Name" rules={[{ required: true, message: 'Work type name is required' }]}>
                        <Input placeholder="Work Type Name" />
                    </Form.Item>
                    {editingId && <Form.Item name="is_active" label="Status" valuePropName="checked"><Switch checkedChildren="Active" unCheckedChildren="Inactive" /></Form.Item>}
                    <Form.Item><Space style={{ width: '100%', justifyContent: 'flex-end' }}><Button onClick={handleCloseModal}>Cancel</Button><Button type="primary" htmlType="submit" loading={createMutation.isPending || updateMutation.isPending}>{editingId ? 'Update' : 'Create'}</Button></Space></Form.Item>
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

export default WorkTypesPage
