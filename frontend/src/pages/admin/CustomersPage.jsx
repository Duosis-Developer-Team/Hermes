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
    message, Switch, Tag
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { customerService } from '../../services/api'
import DeleteModal from '../../components/common/DeleteModal'
import { normalizeApiError } from '../../features/admin/shared/normalizeApiError'
import { pickFields, resetAndFill } from '../../features/admin/shared/formLifecycle'

// Formda GERCEKTEN olan alanlar: API kaydindaki id/created_at gibi
// alanlar form store'una sizmaz, eksik alan da bayat deger BIRAKMAZ.
const FORM_SHAPE = { name: '', is_active: true }
import { Page, PageHeader } from '../../components/ui'

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
            queryClient.invalidateQueries({ queryKey: ['customers'] })
        },
        onError: (err) => message.error(normalizeApiError(err).message),
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => customerService.update(id, data),
        onSuccess: () => {
            message.success('Customer updated')
            handleCloseModal()
            queryClient.invalidateQueries({ queryKey: ['customers'] })
        },
        onError: (err) => message.error(normalizeApiError(err).message),
    })

    const archiveMutation = useMutation({
        mutationFn: ({ id }) => customerService.update(id, { is_active: false }),
        onSuccess: () => {
            message.success('Customer archived (soft deleted)')
            handleDeleteCancel()
            queryClient.invalidateQueries({ queryKey: ['customers'] })
        },
        onError: (err) => message.error(normalizeApiError(err).message),
    })

    const deleteMutation = useMutation({
        mutationFn: customerService.delete,
        onSuccess: () => {
            message.success({ content: 'Customer permanently deleted', style: { marginTop: '10vh' } })
            handleDeleteCancel()
            queryClient.invalidateQueries({ queryKey: ['customers'] })
        },
        onError: (err) => (() => {
            // Kullanimda olan kayit silinemez; ARSIVLEME yolu gosterilir.
            const n = normalizeApiError(err)
            message.error(
                n.kind === 'conflict' || n.status === 400
                    ? `${n.message} Try archiving it instead.`
                    : n.message
            )
        })(),
    })

    // Handlers
    const handleOpenModal = (record = null) => {
        if (record) {
            setEditingId(record.id)
            // resetAndFill: Edit A → Edit B gecisinde A'nin degeri TASINMAZ
            // (`setFieldsValue` tek basina SIG birlestirir).
            resetAndFill(form, pickFields(record, FORM_SHAPE))
        } else {
            setEditingId(null)
            resetAndFill(form, null)
        }
        setModalOpen(true)
    }

    const handleCloseModal = () => {
        setModalOpen(false)
        setEditingId(null)
        form.resetFields()
    }

    const isSaving = createMutation.isPending || updateMutation.isPending
    const isDestroying = archiveMutation.isPending || deleteMutation.isPending

    const handleSubmit = async (values) => {
        // Cift gonderim kilidi KAYNAKTA: buton `loading`i bir render GEC
        // gelir, arada iki mutation acilabiliyordu.
        if (isSaving) return
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
        // Ayni cift-tetikleme kilidi yikici islemler icin de gecerli.
        if (isDestroying) return
        if (deletingRecord) {
            if (deletingRecord.is_active) {
                // Soft Delete
                archiveMutation.mutate({ id: deletingRecord.id })
            } else {
                // Hard Delete
                deleteMutation.mutate(deletingRecord.id)
            }
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
                    <Button
                        type="text"
                        icon={<EditOutlined />}
                        aria-label={`Edit ${record.name}`}
                        onClick={() => handleOpenModal(record)}
                    />
                    <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label={
                            record.is_active
                                ? `Archive ${record.name}`
                                : `Delete ${record.name} permanently`
                        }
                        onClick={() => handleDeleteClick(record)}
                    />
                </Space>
            ),
        },
    ]

    // Sprint 2 PILOT 3 (admin tablo yuzeyi): sayfa iskeleti DS V2
    // primitifleriyle — davranis/kolonlar/moduller AYNEN korundu.
    return (
        <Page className="customers-page fade-in">
            <PageHeader
                title="Customers"
                subtitle="Manage user accounts and organization details"
                extra={
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => handleOpenModal()}>
                        New Customer
                    </Button>
                }
            />
            <Card
                title={`📋 Customer List (${customers.length})`}
            >
                <Table
                    dataSource={customers}
                    columns={columns}
                    rowKey="id"
                    loading={isLoading}
                    pagination={{ pageSize: 10 }}
                    showSorterTooltip={false}
                    scroll={{ x: 'max-content' }}
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
                                loading={isSaving}
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
                isActive={deletingRecord?.is_active}
                itemName={deletingRecord?.name}
                onConfirm={handleDeleteConfirm}
                onCancel={handleDeleteCancel}
                loading={isDestroying}
            />


        </Page>
    )
}

export default CustomersPage
