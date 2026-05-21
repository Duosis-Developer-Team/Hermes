/**
 * =============================================================================
 * HERMES PLATFORM - Projects Admin Page
 * =============================================================================
 * Admin proje yönetimi sayfası (FR 3.3).
 * =============================================================================
 */

import { useState } from 'react'
import {
    Card, Table, Button, Space, Modal, Form, Input, Select,
    message, Typography, Switch, Tag, InputNumber
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, CheckCircleOutlined, WarningOutlined, ClockCircleOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectService, customerService, workLogService } from '../../services/api'

const HOURS_PER_DAY = 8
import DeleteModal from '../../components/common/DeleteModal'

const { Title, Text } = Typography

function ProjectsPage() {
    const [form] = Form.useForm()
    const [modalOpen, setModalOpen] = useState(false)
    const [editingId, setEditingId] = useState(null)
    const queryClient = useQueryClient()

    // Data fetching
    const { data: projects = [], isLoading } = useQuery({
        queryKey: ['projects', { include_inactive: true }],
        queryFn: () => projectService.getAll({ include_inactive: true }),
    })

    const { data: customers = [] } = useQuery({
        queryKey: ['customers'],
        queryFn: () => customerService.getAll(),
    })

    const { data: billableSummaryResponse } = useQuery({
        queryKey: ['billable-summary'],
        queryFn: () => workLogService.getBillableSummary(),
    })
    const billableSummary = billableSummaryResponse?.data || {}

    // Mutations
    const createMutation = useMutation({
        mutationFn: projectService.create,
        onSuccess: () => {
            message.success('Project created')
            handleCloseModal()
            queryClient.invalidateQueries(['projects'])
        },
        onError: (err) => message.error(err.response?.data?.detail || 'An error occurred'),
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => projectService.update(id, data),
        onSuccess: () => {
            message.success('Project updated')
            handleCloseModal()
            queryClient.invalidateQueries(['projects'])
        },
        onError: (err) => message.error(err.response?.data?.detail || 'An error occurred'),
    })

    const archiveMutation = useMutation({
        mutationFn: ({ id }) => projectService.update(id, { is_active: false }),
        onSuccess: () => {
            message.success('Project archived (soft deleted)')
            handleDeleteCancel()
            queryClient.invalidateQueries(['projects'])
        },
        onError: (err) => message.error(err.response?.data?.detail || 'Error archiving project'),
    })

    const deleteMutation = useMutation({
        mutationFn: projectService.delete,
        onSuccess: () => {
            message.success({ content: 'Project permanently deleted', style: { marginTop: '10vh' } })
            handleDeleteCancel()
            queryClient.invalidateQueries(['projects'])
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

    const columns = [
        {
            title: 'Projects',
            subTitle: 'Manage projects',
            dataIndex: 'name',
            key: 'name',
            sorter: (a, b) => a.name.localeCompare(b.name),
        },
        {
            title: 'Customer',
            dataIndex: 'customer_name',
            key: 'customer_name',
            render: (name) => name || <p>Internal Project</p>,
            sorter: (a, b) => (a.customer_name || 'Internal').localeCompare(b.customer_name || 'Internal'),
        },
        {
            title: 'Status',
            dataIndex: 'is_active',
            key: 'is_active',
            width: 100,
            render: (active) => <Tag color={active ? 'success' : 'default'}>{active ? 'Active' : 'Inactive'}</Tag>,
        },
        {
            title: 'Contract',
            key: 'contract',
            width: 220,
            sorter: (a, b) => (a.contract_duration_days || 0) - (b.contract_duration_days || 0),
            render: (_, record) => {
                if (!record.contract_duration_days) return <span style={{ color: 'rgba(var(--overlay-rgb), 0.3)' }}>-</span>

                const totalBillableHours = billableSummary[record.id] || 0
                const usedDays = Math.floor(totalBillableHours / HOURS_PER_DAY)
                const remainingDays = Math.max(0, record.contract_duration_days - usedDays)
                const pct = Math.min(100, (usedDays / record.contract_duration_days) * 100)
                const color = pct >= 100 ? '#ff4d4f' : pct >= 80 ? '#ff4d4f' : pct >= 50 ? '#faad14' : 'rgba(var(--overlay-rgb), 0.45)'

                return (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ color: 'rgba(var(--overlay-rgb), 0.85)', fontSize: '14px' }}>
                            {record.contract_duration_days} Days Total
                        </span>
                        <span style={{ color, fontSize: '12px' }}>
                            ({usedDays} used / {remainingDays} left)
                        </span>
                    </div>
                )
            }
        },
        {
            title: 'Contract Status',
            key: 'contract_status',
            width: 160,
            render: (_, record) => {
                if (!record.contract_duration_days) return <span style={{ color: 'rgba(var(--overlay-rgb), 0.3)' }}>-</span>

                const totalBillableHours = billableSummary[record.id] || 0
                const usedDays = Math.floor(totalBillableHours / HOURS_PER_DAY)
                const pct = Math.min(100, (usedDays / record.contract_duration_days) * 100)
                const tagStyle = { fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', width: 'fit-content', gap: 6 }

                if (pct >= 100) {
                    return <Tag color="error" style={tagStyle} icon={<WarningOutlined />}>EXPIRED</Tag>
                }
                if (pct >= 80) {
                    return <Tag color="error" style={tagStyle} icon={<WarningOutlined />}>CRITICAL</Tag>
                }
                if (pct >= 50) {
                    return <Tag color="warning" style={tagStyle} icon={<ClockCircleOutlined />}>WARNING</Tag>
                }
                return <Tag color="success" style={tagStyle} icon={<CheckCircleOutlined />}>ACTIVE</Tag>
            }
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
        <div className="projects-page fade-in">
            <div className="page-header">
                <h1>Projects</h1>
                <p>Manage projects</p>
            </div>

            <Card
                title={`📋 Project List (${projects.length})`}
                extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => handleOpenModal()}>New Project</Button>}
            >
                <Table
                    dataSource={projects}
                    columns={columns}
                    rowKey="id"
                    loading={isLoading}
                    pagination={{ pageSize: 10 }}
                    showSorterTooltip={false}
                />
            </Card>

            <Modal title={editingId ? '✏️ Edit Project' : '➕ New Project'} open={modalOpen} onCancel={handleCloseModal} footer={null}>
                <Form form={form} layout="vertical" onFinish={handleSubmit}>
                    <Form.Item name="name" label="Project Name" rules={[{ required: true, message: 'Project name is required' }]}>
                        <Input placeholder="e.g. E-Commerce Platform" />
                    </Form.Item>
                    <Form.Item name="customer_id" label="Customer (Optional)">
                        <Select
                            placeholder="Select customer (leave empty for internal projects)"
                            allowClear
                            showSearch
                            filterOption={(input, option) =>
                                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                            }
                            options={customers.map(c => ({ value: c.id, label: c.name }))}
                        />
                    </Form.Item>
                    {editingId && (
                        <Form.Item name="is_active" label="Status" valuePropName="checked">
                            <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
                        </Form.Item>
                    )}
                    <Form.Item name="contract_duration_days" label="Contract Duration (Days) — Optional">
                        <InputNumber
                            min={1}
                            placeholder="e.g. 365"
                            style={{ width: '100%' }}
                            className="contrast-placeholder"
                        />
                    </Form.Item>

                    <style>{`
                        .contrast-placeholder input::placeholder {
                            color: rgba(var(--overlay-rgb), 0.35) !important;
                        }
                    `}</style>
                    <Form.Item>
                        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
                            <Button onClick={handleCloseModal}>Cancel</Button>
                            <Button type="primary" htmlType="submit" loading={createMutation.isPending || updateMutation.isPending}>
                                {editingId ? 'Update' : 'Create'}
                            </Button>
                        </Space>
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
        </div>
    )
}

export default ProjectsPage
