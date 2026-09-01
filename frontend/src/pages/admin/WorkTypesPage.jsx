/**
 * =============================================================================
 * HERMES PLATFORM - Work Types Admin Page
 * =============================================================================
 * Admin iş tipi yönetimi sayfası (FR 3.2).
 * =============================================================================
 */

import { useMemo, useState } from 'react'
import { Card, Table, Button, Space, Modal, Form, Input, message, Switch, Tag } from 'antd'
import {
    PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined,
} from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { workTypeService } from '../../services/api'
import DeleteModal from '../../components/common/DeleteModal'
import { normalizeApiError } from '../../features/admin/shared/normalizeApiError'
import {
    AdminErrorAlert, AdminRefreshHint,
} from '../../features/admin/shared/AdminListStates'
import { adminEmptyText } from '../../features/admin/shared/adminEmptyText'
import { pickFields, resetAndFill } from '../../features/admin/shared/formLifecycle'
import { useT } from '../../i18n'

// Formda GERCEKTEN olan alanlar. API kaydindaki id/created_at gibi
// alanlar form store'una sizmaz.
const FORM_SHAPE = { name: '', is_active: true }


function WorkTypesPage() {
    const t = useT()
    const [form] = Form.useForm()
    const [modalOpen, setModalOpen] = useState(false)
    const [editingId, setEditingId] = useState(null)
    const queryClient = useQueryClient()

    const [search, setSearch] = useState('')
    const {
        data: workTypes = [], isLoading, isFetching, isError, error, refetch,
    } = useQuery({
        queryKey: ['workTypes', { include_inactive: true }],
        queryFn: () => workTypeService.getAll({ include_inactive: true }),
    })

    const createMutation = useMutation({
        mutationFn: workTypeService.create,
        onSuccess: () => { message.success(t('admin.entityCreated', { entity: t('entity.workType') })); handleCloseModal(); queryClient.invalidateQueries({ queryKey: ['workTypes'] }) },
        onError: (err) => message.error(normalizeApiError(err).message),
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => workTypeService.update(id, data),
        onSuccess: () => { message.success(t('admin.entityUpdated', { entity: t('entity.workType') })); handleCloseModal(); queryClient.invalidateQueries({ queryKey: ['workTypes'] }) },
        onError: (err) => message.error(normalizeApiError(err).message),
    })

    const archiveMutation = useMutation({
        mutationFn: ({ id }) => workTypeService.update(id, { is_active: false }),
        onSuccess: () => {
            message.success(t('admin.entityArchived', { entity: t('entity.workType') }))
            handleDeleteCancel()
            queryClient.invalidateQueries({ queryKey: ['workTypes'] })
        },
        onError: (err) => message.error(normalizeApiError(err).message),
    })

    const deleteMutation = useMutation({
        mutationFn: workTypeService.delete,
        onSuccess: () => {
            message.success({ content: t('admin.entityDeleted', { entity: t('entity.workType') }), style: { marginTop: '10vh' } })
            handleDeleteCancel()
            queryClient.invalidateQueries({ queryKey: ['workTypes'] })
        },
        onError: (err) => {
            // Kullanimda olan kayit silinemez; kullaniciya ARSIVLEME yolu
            // gosterilir (backend constraint'ini boyle anlatiyoruz).
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
        // Ayni kilit yikici islemler icin de gecerli.
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

    const handleOpenModal = (record = null) => {
        // resetAndFill: Edit A → Edit B gecisinde A'nin degeri TASINMAZ.
        if (record) { setEditingId(record.id); resetAndFill(form, pickFields(record, FORM_SHAPE)) }
        else { setEditingId(null); resetAndFill(form, null) }
        setModalOpen(true)
    }

    const handleCloseModal = () => { setModalOpen(false); setEditingId(null); form.resetFields() }

    /** Arama: ad ve kodda. */
    const query = search.trim().toLowerCase()
    const filteredWorkTypes = useMemo(() => {
        if (!query) return workTypes
        return workTypes.filter((w) =>
            [w.name, w.code]
                .filter(Boolean)
                .some((val) => String(val).toLowerCase().includes(query))
        )
    }, [workTypes, query])

    const isSaving = createMutation.isPending || updateMutation.isPending
    const isDestroying = archiveMutation.isPending || deleteMutation.isPending

    const handleSubmit = async (values) => {
        // Cift gonderim kilidi: buton `loading`i bir render GEC gelir,
        // arada iki mutation acilabiliyordu.
        if (isSaving) return
        if (editingId) updateMutation.mutate({ id: editingId, data: values })
        else createMutation.mutate(values)
    }

    const columns = [
        { title: t('admin.workTypeNameLabel'), dataIndex: 'name', key: 'name', sorter: (a, b) => a.name.localeCompare(b.name) },
        { title: t('common.status'), dataIndex: 'is_active', key: 'is_active', width: 100, render: (active) => <Tag color={active ? 'success' : 'default'}>{active ? 'Active' : 'Inactive'}</Tag> },
        {
            title: t('common.actions'), key: 'actions', width: 120, render: (_, record) => (
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
            )
        },
    ]

    return (
        <div className="work-types-page fade-in">
            <div className="page-header">
                <h1>{t('entity.workTypes')}</h1>
                <p>{t('admin.manageWorkTypes')}</p>
            </div>
            <AdminErrorAlert error={isError ? error : null} onRetry={refetch} />

            <Card variant="borderless"
                title={t('admin.entityCount', { entity: t('entity.workTypes'), n: filteredWorkTypes.length })}
                extra={
                    <Space wrap>
                        <Input
                            allowClear
                            prefix={<SearchOutlined aria-hidden="true" />}
                            placeholder={t('admin.searchEntity', { entity: t('entity.workTypes') })}
                            aria-label={t('admin.searchEntity', { entity: t('entity.workTypes') })}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={{ width: 200 }}
                        />
                        <Button type="primary" icon={<PlusOutlined />} onClick={() => handleOpenModal()}>{t('admin.newEntity', { entity: t('entity.workType') })}</Button>
                    </Space>
                }
            >
                <Table
                    dataSource={filteredWorkTypes}
                    columns={columns}
                    rowKey="id"
                    /* Ilk yukleme ile arkaplan yenilemesi AYRI. */
                    loading={isLoading && workTypes.length === 0}
                    pagination={{ pageSize: 10 }}
                    scroll={{ x: 'max-content' }}
                    locale={{
                        emptyText: adminEmptyText({
                            filtered: !!query,
                            entityPlural: 'work types',
                            createLabel: t('admin.newEntity', { entity: t('entity.workType') }),
                            term: search.trim(),
                        }),
                    }}
                />
                <AdminRefreshHint
                    isFetching={isFetching}
                    hasData={workTypes.length > 0}
                />
            </Card>
            <Modal
                title={editingId ? 'Edit Work Type' : 'New Work Type'}
                open={modalOpen}
                onCancel={handleCloseModal}
                footer={null}
                closable={!isSaving}
                maskClosable={!isSaving}
                keyboard={!isSaving}
            >
                <Form form={form} layout="vertical" onFinish={handleSubmit}>
                    <Form.Item name="name" label={t('admin.workTypeNameLabel')} rules={[{ required: true, whitespace: true, message: t('admin.nameRequired', { entity: t('entity.workType') }) }]}>
                        <Input placeholder={t('admin.workTypeNameLabel')} />
                    </Form.Item>
                    {editingId && <Form.Item name="is_active" label={t('common.status')} valuePropName="checked"><Switch checkedChildren="Active" unCheckedChildren="Inactive" /></Form.Item>}
                    <Form.Item><Space style={{ width: '100%', justifyContent: 'flex-end' }}><Button onClick={handleCloseModal}>{t('common.cancel')}</Button><Button type="primary" htmlType="submit" loading={isSaving}>{editingId ? 'Update' : 'Create'}</Button></Space></Form.Item>
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
        </div >
    )
}

export default WorkTypesPage
