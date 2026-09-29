/**
 * =============================================================================
 * HERMES PLATFORM - Customers Admin Page
 * =============================================================================
 * Admin müşteri yönetimi sayfası (FR 3.1).
 * =============================================================================
 */

import { useMemo, useState } from 'react'
import {
    Card, Table, Button, Space, Modal, Form, Input, InputNumber, DatePicker,
    message, Switch
} from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined, ShopOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { customerService } from '../../services/api'
import DeleteModal from '../../components/common/DeleteModal'
import { normalizeApiError } from '../../features/admin/shared/normalizeApiError'
import {
    AdminErrorAlert, AdminRefreshHint,
    AdminEmptyState,
} from '../../features/admin/shared/AdminListStates'
import { pickFields, resetAndFill } from '../../features/admin/shared/formLifecycle'
import {
    contractToForm, contractToPayload,
} from '../../features/admin/shared/contractFields'

// Formda GERCEKTEN olan alanlar: API kaydindaki id/created_at gibi
// alanlar form store'una sizmaz, eksik alan da bayat deger BIRAKMAZ.
/**
 * Backend sozlesmesi (schemas/customer.py): CustomerCreate ve
 * CustomerUpdate ikisi de `contract_start_date` + `contract_duration_days`
 * KABUL EDIYOR ve CustomerResponse bunlari DONDURUYOR — ama form bu iki
 * alani hic sunmuyordu, yani musteri sozlesmesi arayuzden hic
 * yonetilemiyordu. Alanlar uydurulmadi; var olan sozlesme aciga cikarildi.
 */
const FORM_SHAPE = {
    name: '', is_active: true,
    contract_start_date: null, contract_duration_days: undefined,
}
import { Page, PageHeader } from '../../components/ui'
import { useT } from '../../i18n'
import { CustomerLogo, ModalHead } from '../../components/liquid'
import { queryKeys } from '../../query/queryKeys'
import { useCustomerLogoStore } from '../../stores/customerLogoStore'
import CustomerLogoField, { EMPTY_LOGO_DRAFT } from './CustomerLogoField'
import dayjs from 'dayjs'

function CustomersPage() {
    const [form] = Form.useForm()
    const [modalOpen, setModalOpen] = useState(false)
    const [editingId, setEditingId] = useState(null)
    const [editingRecord, setEditingRecord] = useState(null)
    // Logo taslagi: formla birlikte kaydedilir (CustomerLogoField).
    const [logoDraft, setLogoDraft] = useState(EMPTY_LOGO_DRAFT)
    const setLogoEtag = useCustomerLogoStore((s) => s.setOne)
    const queryClient = useQueryClient()

    // Data fetching
    const [search, setSearch] = useState('')
    const t = useT()
    const {
        data: customers = [], isLoading, isFetching, isError, error, refetch,
    } = useQuery({
        queryKey: ['customers', { include_inactive: true }],
        queryFn: () => customerService.getAll({ include_inactive: true }),
    })

    // Mutations
    /**
     * Musteri kaydindan SONRA logo taslagini uygular. Logo hatasi musteri
     * kaydini geri almaz: kayit durur, uyari gosterilir.
     */
    const applyLogo = async (customerId) => {
        try {
            if (logoDraft.file) {
                const res = await customerService.uploadLogo(customerId, logoDraft.file)
                setLogoEtag(customerId, res?.logo_etag || null)
            } else if (logoDraft.remove) {
                await customerService.deleteLogo(customerId)
                setLogoEtag(customerId, null)
            }
        } catch (err) {
            message.warning(t('admin.logoFailed', { msg: normalizeApiError(err).message }))
        }
    }
    const refreshCustomers = () => {
        queryClient.invalidateQueries({ queryKey: ['customers'] })
        // Kabuk + seciciler tenant kapsamli anahtardan okur.
        queryClient.invalidateQueries({ queryKey: queryKeys.customers.all })
    }

    const createMutation = useMutation({
        mutationFn: async (data) => {
            const created = await customerService.create(data)
            if (created?.id) await applyLogo(created.id)
            return created
        },
        onSuccess: () => {
            message.success(t('admin.entityCreated', { entity: t('entity.customer') }))
            handleCloseModal()
            refreshCustomers()
        },
        onError: (err) => message.error(normalizeApiError(err).message),
    })

    const updateMutation = useMutation({
        mutationFn: async ({ id, data }) => {
            const updated = await customerService.update(id, data)
            await applyLogo(id)
            return updated
        },
        onSuccess: () => {
            message.success(t('admin.entityUpdated', { entity: t('entity.customer') }))
            handleCloseModal()
            refreshCustomers()
        },
        onError: (err) => message.error(normalizeApiError(err).message),
    })

    const archiveMutation = useMutation({
        mutationFn: ({ id }) => customerService.update(id, { is_active: false }),
        onSuccess: () => {
            message.success(t('admin.entityArchived', { entity: t('entity.customer') }))
            handleDeleteCancel()
            queryClient.invalidateQueries({ queryKey: ['customers'] })
        },
        onError: (err) => message.error(normalizeApiError(err).message),
    })

    const deleteMutation = useMutation({
        mutationFn: customerService.delete,
        onSuccess: () => {
            message.success({ content: t('admin.entityDeleted', { entity: t('entity.customer') }), style: { marginTop: '10vh' } })
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
        setLogoDraft(EMPTY_LOGO_DRAFT)
        setEditingRecord(record)
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
        setEditingRecord(null)
        setLogoDraft(EMPTY_LOGO_DRAFT)
        form.resetFields()
    }

    /** Arama: ad, kod ve iletisim alanlarinda. */
    const query = search.trim().toLowerCase()
    const filteredCustomers = useMemo(() => {
        if (!query) return customers
        return customers.filter((c) =>
            [c.name, c.code, c.contact_person, c.email]
                .filter(Boolean)
                .some((val) => String(val).toLowerCase().includes(query))
        )
    }, [customers, query])

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
            title: t('entity.customers'),
            dataIndex: 'name',
            key: 'name',
            sorter: (a, b) => (a.name || '').localeCompare(b.name || ''),
            // Liquid: renkli bas harf kutusu + sozlesme ozeti.
            render: (name, record) => (
                <span className="admin-name">
                    <CustomerLogo id={record.id} name={name} size={36} etag={record.has_logo ? record.logo_etag : null} className="admin-name__logo" />
                    <span className="admin-name__text">
                        <b>{name || '—'}</b>
                        <small>
                            {record.contract_start_date
                                ? t('admin.contractSummary', {
                                    start: dayjs(record.contract_start_date).format('D MMM YYYY'),
                                    days: record.contract_duration_days ?? '—',
                                })
                                : t('admin.noContract')}
                        </small>
                    </span>
                </span>
            ),
        },
        {
            title: t('common.status'),
            dataIndex: 'is_active',
            key: 'is_active',
            width: 110,
            render: (active) => (
                <span className={`lq-tag ${active ? 'lq-tag--ok' : ''}`}>
                    {active ? t('common.active') : t('common.inactive')}
                </span>
            ),
        },

        {
            title: t('admin.createdAt'),
            dataIndex: 'created_at',
            key: 'created_at',
            width: 150,
            // Gecersiz/bos tarih "Invalid Date" basmaz.
            render: (date) => (date && dayjs(date).isValid() ? dayjs(date).format('D MMM YYYY') : '—'),
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

    // Sprint 2 PILOT 3 (admin tablo yuzeyi): sayfa iskeleti DS V2
    // primitifleriyle — davranis/kolonlar/moduller AYNEN korundu.
    return (
        <Page className="customers-page fade-in">
            <PageHeader
                title={t('entity.customers')}
                subtitle={t('admin.manageCustomers')}
                extra={
                    <Space wrap>
                        <Input
                            allowClear
                            prefix={<SearchOutlined aria-hidden="true" />}
                            placeholder={t('admin.searchEntity', { entity: t('entity.customers') })}
                            aria-label={t('admin.searchEntity', { entity: t('entity.customers') })}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={{ width: 220 }}
                        />
                        <Button type="primary" icon={<PlusOutlined />} onClick={() => handleOpenModal()}>{t('admin.newEntity', { entity: t('entity.customer') })}</Button>
                    </Space>
                }
            />

            <AdminErrorAlert error={isError ? error : null} onRetry={refetch} />

            <Card variant="borderless"
                title={t('admin.entityCount', {
                    entity: t('entity.customers'),
                    n: filteredCustomers.length,
                })}
            >
                <Table
                    dataSource={filteredCustomers}
                    columns={columns}
                    rowKey="id"
                    /* Ilk yukleme ile arkaplan yenilemesi AYRI: mevcut
                       veri refetch sirasinda kaybolmaz. */
                    loading={isLoading && customers.length === 0}
                    pagination={{ pageSize: 10 }}
                    showSorterTooltip={false}
                    scroll={{ x: 'max-content' }}
                    locale={{
                        emptyText: (
                            <AdminEmptyState
                                filtered={!!query}
                                term={search.trim()}
                                entityKey="entity.customers"
                                createLabel={t('admin.newEntity', { entity: t('entity.customer') })}
                                onCreate={() => handleOpenModal()}
                            />
                        ),
                    }}
                />
                <AdminRefreshHint
                    isFetching={isFetching}
                    hasData={customers.length > 0}
                />
            </Card>

            {/* Edit/Create Modal */}
            <Modal
                title={<ModalHead icon={<ShopOutlined />} tone="green" title={editingId ? t('modalTitles.editCustomer') : t('modalTitles.newCustomer')} />}
                open={modalOpen}
                onCancel={handleCloseModal}
                footer={null}
            >
                <Form form={form} layout="vertical" onFinish={handleSubmit}>
                    <Form.Item
                        name="name"
                        label={t('admin.customerNameLabel')}
                        rules={[
                            {
                                required: true, whitespace: true,
                                message: t('admin.nameRequired', { entity: t('entity.customer') }),
                            },
                        ]}
                    >
                        <Input placeholder={t('admin.customerNameExample')} maxLength={255} />
                    </Form.Item>

                    <Form.Item noStyle shouldUpdate={(a, b) => a.name !== b.name}>
                        {({ getFieldValue }) => (
                            <CustomerLogoField
                                record={editingRecord}
                                name={getFieldValue('name')}
                                draft={logoDraft}
                                onChange={setLogoDraft}
                            />
                        )}
                    </Form.Item>

                    {/* Sozlesme alanlari: backend ikisini de opsiyonel kabul
                        eder, bu yuzden zorunlu yapilmadi. */}
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

                    <Form.Item
                        name="contract_duration_days"
                        label={t('admin.contractDurationOptional')}
                    >
                        <InputNumber
                            min={1}
                            placeholder={t('admin.durationExample')}
                            style={{ width: '100%' }}
                        />
                    </Form.Item>



                    {editingId && (
                        <Form.Item name="is_active" label={t('common.status')} valuePropName="checked">
                            <Switch checkedChildren={t('common.active')} unCheckedChildren={t('common.inactive')} />
                        </Form.Item>
                    )}

                    <div className="lq-mf">
                        <Button onClick={handleCloseModal}>{t('common.cancel')}</Button>
                        <Button type="primary" htmlType="submit" loading={isSaving}>
                            {editingId ? t('admin.update') : t('common.create')}
                        </Button>
                    </div>
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
