/**
 * =============================================================================
 * HERMES PLATFORM - Projects Admin Page
 * =============================================================================
 * Admin proje yönetimi sayfası (FR 3.3).
 * =============================================================================
 */

import { useMemo, useState } from 'react'
import {
    Card, Table, Button, Space, Modal, Form, Input, Select,
    message, Switch, Tag, InputNumber, DatePicker
} from 'antd'
import {
    PlusOutlined, EditOutlined, DeleteOutlined, CheckCircleOutlined,
    WarningOutlined, ClockCircleOutlined, SearchOutlined,
} from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectService, customerService, workLogService } from '../../services/api'

const HOURS_PER_DAY = 8
import DeleteModal from '../../components/common/DeleteModal'
import { normalizeApiError } from '../../features/admin/shared/normalizeApiError'
import {
    AdminErrorAlert, AdminRefreshHint,
} from '../../features/admin/shared/AdminListStates'
import { adminEmptyText } from '../../features/admin/shared/adminEmptyText'
import { pickFields, resetAndFill } from '../../features/admin/shared/formLifecycle'
import {
    contractToForm, contractToPayload,
} from '../../features/admin/shared/contractFields'
import { useT } from '../../i18n'

// Formda GERCEKTEN olan alanlar: API kaydindaki id/created_at gibi
// alanlar form store'una sizmaz, eksik alan da bayat deger BIRAKMAZ.
/**
 * Backend sozlesmesi (schemas/project.py): ProjectCreate hem
 * `contract_start_date` hem `contract_duration_days` kabul eder ve
 * ContractStatusPage baslangic tarihini GOSTERIR — ama form bu alani hic
 * sunmuyordu, yani ekranda gorunen tarih arayuzden hic girilemiyordu.
 */
const FORM_SHAPE = {
    name: '', customer_id: undefined, is_active: true,
    contract_start_date: null, contract_duration_days: undefined,
}


function ProjectsPage() {
    const t = useT()
    const [form] = Form.useForm()
    const [modalOpen, setModalOpen] = useState(false)
    const [editingId, setEditingId] = useState(null)
    const queryClient = useQueryClient()

    // Data fetching
    const [search, setSearch] = useState('')
    const {
        data: projects = [], isLoading, isFetching, isError, error, refetch,
    } = useQuery({
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
            message.success(t('admin.entityCreated', { entity: t('entity.project') }))
            handleCloseModal()
            queryClient.invalidateQueries({ queryKey: ['projects'] })
        },
        onError: (err) => message.error(normalizeApiError(err).message),
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => projectService.update(id, data),
        onSuccess: () => {
            message.success(t('admin.entityUpdated', { entity: t('entity.project') }))
            handleCloseModal()
            queryClient.invalidateQueries({ queryKey: ['projects'] })
        },
        onError: (err) => message.error(normalizeApiError(err).message),
    })

    const archiveMutation = useMutation({
        mutationFn: ({ id }) => projectService.update(id, { is_active: false }),
        onSuccess: () => {
            message.success(t('admin.entityArchived', { entity: t('entity.project') }))
            handleDeleteCancel()
            queryClient.invalidateQueries({ queryKey: ['projects'] })
        },
        onError: (err) => message.error(normalizeApiError(err).message),
    })

    const deleteMutation = useMutation({
        mutationFn: projectService.delete,
        onSuccess: () => {
            message.success({ content: t('admin.entityDeleted', { entity: t('entity.project') }), style: { marginTop: '10vh' } })
            handleDeleteCancel()
            queryClient.invalidateQueries({ queryKey: ['projects'] })
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

    const handleOpenModal = (record = null) => {
        if (record) {
            setEditingId(record.id)
            // resetAndFill: Edit A → Edit B gecisinde A'nin degeri TASINMAZ
            // (`setFieldsValue` tek basina SIG birlestirir).
            resetAndFill(form, {
                ...pickFields(record, FORM_SHAPE),
                // Tarih alani DatePicker icin dayjs'e cevrilir.
                ...contractToForm(record),
            })
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

    /** Arama: proje adi, kodu ve MUSTERI adinda. */
    const query = search.trim().toLowerCase()
    const filteredProjects = useMemo(() => {
        if (!query) return projects
        return projects.filter((p) =>
            [p.name, p.code, p.customer_name]
                .filter(Boolean)
                .some((val) => String(val).toLowerCase().includes(query))
        )
    }, [projects, query])

    const isSaving = createMutation.isPending || updateMutation.isPending
    const isDestroying = archiveMutation.isPending || deleteMutation.isPending

    const handleSubmit = async (values) => {
        // Cift gonderim kilidi KAYNAKTA: buton `loading`i bir render GEC
        // gelir, arada iki mutation acilabiliyordu.
        if (isSaving) return
        const data = { ...values, ...contractToPayload(values) }
        if (editingId) {
            updateMutation.mutate({ id: editingId, data })
        } else {
            createMutation.mutate(data)
        }
    }

    const columns = [
        {
            title: t('entity.projects'),
            subTitle: t('admin.manageProjects'),
            dataIndex: 'name',
            key: 'name',
            sorter: (a, b) => a.name.localeCompare(b.name),
        },
        {
            title: t('entity.customer'),
            dataIndex: 'customer_name',
            key: 'customer_name',
            render: (name) => name || <p>{t('admin.internalProject')}</p>,
            sorter: (a, b) => (a.customer_name || 'Internal').localeCompare(b.customer_name || 'Internal'),
        },
        {
            title: t('common.status'),
            dataIndex: 'is_active',
            key: 'is_active',
            width: 100,
            render: (active) => <Tag color={active ? 'success' : 'default'}>{active ? 'Active' : 'Inactive'}</Tag>,
        },
        {
            title: t('admin.contract'),
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
            title: t('admin.contractStatus'),
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
            title: t('common.actions'),
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

    return (
        <div className="projects-page fade-in">
            <div className="page-header">
                <h1>{t('entity.projects')}</h1>
                <p>{t('admin.manageProjects')}</p>
            </div>

            <AdminErrorAlert error={isError ? error : null} onRetry={refetch} />

            <Card variant="borderless"
                title={t('admin.entityCount', { entity: t('entity.projects'), n: filteredProjects.length })}
                extra={
                    <Space wrap>
                        <Input
                            allowClear
                            prefix={<SearchOutlined aria-hidden="true" />}
                            placeholder={t('admin.searchEntity', { entity: t('entity.projects') })}
                            aria-label={t('admin.searchEntity', { entity: t('entity.projects') })}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={{ width: 220 }}
                        />
                        <Button type="primary" icon={<PlusOutlined />} onClick={() => handleOpenModal()}>{t('admin.newEntity', { entity: t('entity.project') })}</Button>
                    </Space>
                }
            >
                <Table
                    dataSource={filteredProjects}
                    columns={columns}
                    rowKey="id"
                    /* Ilk yukleme ile arkaplan yenilemesi AYRI. */
                    loading={isLoading && projects.length === 0}
                    pagination={{ pageSize: 10 }}
                    showSorterTooltip={false}
                    scroll={{ x: 'max-content' }}
                    locale={{
                        emptyText: adminEmptyText({
                            filtered: !!query,
                            entityPlural: 'projects',
                            createLabel: t('admin.newEntity', { entity: t('entity.project') }),
                            term: search.trim(),
                        }),
                    }}
                />
                <AdminRefreshHint
                    isFetching={isFetching}
                    hasData={projects.length > 0}
                />
            </Card>

            <Modal title={editingId ? 'Edit Project' : 'New Project'} open={modalOpen} onCancel={handleCloseModal} footer={null}>
                <Form form={form} layout="vertical" onFinish={handleSubmit}>
                    <Form.Item name="name" label={t('admin.projectNameLabel')} rules={[{ required: true, message: t('admin.nameRequired', { entity: t('entity.project') }) }]}>
                        <Input placeholder={t('admin.projectNameExample')} />
                    </Form.Item>
                    <Form.Item name="customer_id" label={t('admin.customerOptional')}>
                        <Select
                            placeholder={t('admin.selectCustomerHint')}
                            allowClear
                            showSearch
                            filterOption={(input, option) =>
                                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                            }
                            options={customers.map(c => ({ value: c.id, label: c.name }))}
                        />
                    </Form.Item>
                    {editingId && (
                        <Form.Item name="is_active" label={t('common.status')} valuePropName="checked">
                            <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
                        </Form.Item>
                    )}
                    <Form.Item
                        name="contract_start_date"
                        label={t('admin.contractStartOptional')}
                    >
                        <DatePicker
                            style={{ width: '100%' }}
                            format="YYYY-MM-DD"
                            placeholder={t('admin.selectStartDate')}
                        />
                    </Form.Item>

                    <Form.Item name="contract_duration_days" label={t('admin.contractDurationOptional')}>
                        <InputNumber
                            min={1}
                            placeholder={t('admin.durationExample')}
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
                            <Button onClick={handleCloseModal}>{t('common.cancel')}</Button>
                            <Button type="primary" htmlType="submit" loading={isSaving}>
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
                loading={isDestroying}
            />
        </div>
    )
}

export default ProjectsPage
