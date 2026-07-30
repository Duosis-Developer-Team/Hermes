/**
 * =============================================================================
 * HERMES - Sozluk (dictionary) CRUD ortak yuzeyi (Sprint 6B.2)
 * =============================================================================
 * NEDEN ORTAKLASTIRILDI (olculdu, varsayilmadi): ActivityTypes,
 * Platforms ve WorkLines sayfalari 251 SATIR ve entity adi normalize
 * edildiginde aralarinda YALNIZCA IKI satir fark vardi — bir etiket
 * rengi ve bir placeholder. Uc kopya, tek deseni anlatiyordu.
 *
 * Bu bir "her seyi prop ile yapan mega generic CRUD" DEGILDIR: yalnizca
 * name+code+description+is_active seklindeki SOZLUK entity'leri icin
 * ortak kabuk. Domain farklari kucuk ve ACIK bir config'te durur; farkli
 * sekle sahip yuzeyler (Users, Groups, Customers, Projects) buraya
 * ZORLANMAZ.
 *
 * Ortak kabugun kapattigi GERCEK kusurlar (uc kopyada da vardi):
 *   1. Form dogrulamasi basarisiz olunca `console.error` yaziliyordu.
 *   2. Cift gonderim ENGELLENMIYORDU — OK'a iki kez basmak iki mutation.
 *   3. `setFieldsValue` SIG birlestirme yapar: Edit A → Edit B gecisinde
 *      B'de bulunmayan alanlar A'nin degerini KORUYORDU.
 *   4. Hata mesaji `|| 'Error'` idi; alan hatalari forma hic baglanmiyordu.
 *   5. Ikon-only satir aksiyonlarinin erisilebilir adi YOKTU.
 *
 * ARCHIVE / DELETE TERMINOLOJISI (gercek backend sozlesmesi): aktif kayit
 * ARSIVLENIR (`is_active: false`), zaten pasif kayit KALICI SILINIR.
 * Paylasilan DeleteModal bu iki modu ayri baslik ve metinle sunar; UI
 * arsivlemeye "Delete" DEMEZ.
 * =============================================================================
 */
import { useMemo, useState } from 'react'
import {
    Alert, Button, Card, Form, Input, Modal, Space, Switch, Table, Tag,
    message,
} from 'antd'
import {
    DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import DeleteModal from '../../../components/common/DeleteModal'
import { generateCode } from '../../../utils/codeGenerator'
import { applyErrorToForm, normalizeApiError } from '../shared/normalizeApiError'

const FORM_FIELDS = ['name', 'code', 'description', 'is_active']

/**
 * @param {object} props
 * @param {string} props.title        Sayfa/kart basligi (cogul)
 * @param {string} props.singular     Tekil ad — modal basligi ve mesajlar
 * @param {string} props.description  Sayfa alt metni
 * @param {string} props.codeColor    Kod etiketi rengi (domain gorsel ipucu)
 * @param {object} props.service      { getAll, create, update, delete }
 * @param {Array}  props.queryKey     Merkezi factory'den gelen anahtar
 */
function DictionaryCrudPage({
    title, singular, description, codeColor = 'blue', service, queryKey,
}) {
    const queryClient = useQueryClient()
    const [form] = Form.useForm()
    const [modalOpen, setModalOpen] = useState(false)
    const [editingItem, setEditingItem] = useState(null)
    const [formError, setFormError] = useState(null)
    const [search, setSearch] = useState('')
    const [deletingRecord, setDeletingRecord] = useState(null)

    const { data: items = [], isLoading, isFetching, isError, error, refetch } =
        useQuery({ queryKey, queryFn: () => service.getAll() })

    const invalidate = () => queryClient.invalidateQueries({ queryKey })

    /** Hata: alanlara baglanir, baglanamayan mesaj form/sayfa ustunde. */
    const showError = (err, fallback) => {
        const leftover = applyErrorToForm(err, form, FORM_FIELDS)
        if (leftover) setFormError(leftover || fallback)
    }

    const createMutation = useMutation({
        mutationFn: (data) => service.create(data),
        onSuccess: () => {
            message.success(`${singular} created.`)
            invalidate()
            closeModal()
        },
        onError: (err) => showError(err),
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => service.update(id, data),
        onSuccess: () => {
            message.success(`${singular} updated.`)
            invalidate()
            closeModal()
        },
        onError: (err) => showError(err),
    })

    // Aktif kayit ARSIVLENIR — silinmez.
    const archiveMutation = useMutation({
        mutationFn: ({ id }) => service.update(id, { is_active: false }),
        onSuccess: () => {
            message.success(`${singular} archived.`)
            setDeletingRecord(null)
            invalidate()
        },
        onError: (err) => {
            message.error(normalizeApiError(err).message)
            setDeletingRecord(null)
        },
    })

    // Zaten pasif kayit KALICI silinir.
    const deleteMutation = useMutation({
        mutationFn: (id) => service.delete(id),
        onSuccess: () => {
            message.success(`${singular} permanently deleted.`)
            setDeletingRecord(null)
            invalidate()
        },
        onError: (err) => {
            // Kullanimda olan kayit silinemez; kullaniciya ARSIVLEME yolu
            // gosterilir (backend constraint'i boyle anlatilir).
            const n = normalizeApiError(err)
            message.error(
                n.kind === 'conflict' || n.status === 400
                    ? `${n.message} Try archiving it instead.`
                    : n.message
            )
        },
    })

    const isSaving = createMutation.isPending || updateMutation.isPending
    const isDestroying = archiveMutation.isPending || deleteMutation.isPending

    function closeModal() {
        setModalOpen(false)
        setEditingItem(null)
        setFormError(null)
        form.resetFields()
    }

    const openCreate = () => {
        // Temiz defaultlar: resetFields ONCE, sonra acilis. Edit'ten
        // gelen degerler Create'e TASINMAZ.
        setEditingItem(null)
        setFormError(null)
        form.resetFields()
        setModalOpen(true)
    }

    const openEdit = (item) => {
        setEditingItem(item)
        setFormError(null)
        // resetFields ZORUNLU: `setFieldsValue` SIG birlestirir, yani
        // Edit A → Edit B gecisinde B'de olmayan alan A'nin degerini
        // korurdu. Once temizle, sonra bu entity'nin degerlerini yaz.
        form.resetFields()
        form.setFieldsValue({
            name: item.name ?? '',
            code: item.code ?? '',
            description: item.description ?? '',
            is_active: item.is_active ?? true,
        })
        setModalOpen(true)
    }

    const handleSubmit = async () => {
        // Cift gonderim kilidi KAYNAKTA.
        if (isSaving) return
        setFormError(null)
        let values
        try {
            values = await form.validateFields()
        } catch {
            // Form dogrulama hatasi KULLANICI hatasidir; AntD alanlarda
            // gosterir. console'a YAZILMAZ.
            return
        }
        if (editingItem) updateMutation.mutate({ id: editingItem.id, data: values })
        else createMutation.mutate(values)
    }

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return items
        return items.filter((i) =>
            [i.name, i.code, i.description]
                .filter(Boolean)
                .some((v) => String(v).toLowerCase().includes(q))
        )
    }, [items, search])

    const columns = useMemo(() => [
        {
            title: 'Name', dataIndex: 'name', key: 'name',
            sorter: (a, b) => (a.name || '').localeCompare(b.name || '', 'en'),
        },
        {
            title: 'Code', dataIndex: 'code', key: 'code',
            render: (code) => <Tag color={codeColor}>{code}</Tag>,
        },
        { title: 'Description', dataIndex: 'description', key: 'description' },
        {
            title: 'Active', dataIndex: 'is_active', key: 'is_active',
            // Durum yalniz RENKLE anlatilmaz: etiket metni de tasir.
            render: (active) => (
                <Tag color={active ? 'green' : 'red'}>
                    {active ? 'Active' : 'Archived'}
                </Tag>
            ),
        },
        {
            title: 'Actions', key: 'actions', width: 110,
            render: (_, record) => (
                <Space>
                    {/* Ikon-only butonlar erisilebilir ad tasir (§8). */}
                    <Button
                        type="text"
                        icon={<EditOutlined />}
                        aria-label={`Edit ${record.name}`}
                        disabled={isDestroying}
                        onClick={() => openEdit(record)}
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
                        disabled={isDestroying}
                        onClick={() => setDeletingRecord(record)}
                    />
                </Space>
            ),
        },
        // `isDestroying` disinda bagimlilik yok: kolonlar her render'da
        // yeniden uretilmez (rc-table kolon kimligine gore yeniden cizer).
    ], [isDestroying])

    // Ilk yukleme ile arkaplan yenilemesi AYRI: mevcut veri arkaplan
    // refetch sirasinda kaybolmaz.
    const initialLoading = isLoading && items.length === 0

    return (
        <div className="admin-page fade-in">
            <div className="page-header">
                <h1>{title}</h1>
                <p>{description}</p>
            </div>

            {isError && (
                <Alert
                    type="error"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message={normalizeApiError(error).message}
                    action={
                        <Button size="small" onClick={() => refetch()}>
                            Retry
                        </Button>
                    }
                />
            )}

            <Card
                title={title}
                extra={
                    <Space wrap>
                        {/*
                          * `Input.Search` DEGIL: filtre zaten yazarken
                          * canli uygulaniyor, dolayisiyla arama butonu
                          * hicbir sey yapmiyordu — ustelik ikon-only ve
                          * zayif adlandirilmis fazladan bir dokunma
                          * hedefi ekliyordu. Gercek Chromium QA'sinde
                          * 24 kombinasyonun HEPSINDE bulgu verdi.
                          */}
                        <Input
                            allowClear
                            prefix={<SearchOutlined aria-hidden="true" />}
                            placeholder={`Search ${title.toLowerCase()}`}
                            aria-label={`Search ${title}`}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={{ width: 220 }}
                        />
                        <Button
                            type="primary"
                            icon={<PlusOutlined />}
                            aria-label={`Add ${singular}`}
                            onClick={openCreate}
                        >
                            Add {singular}
                        </Button>
                    </Space>
                }
            >
                <Table
                    dataSource={filtered}
                    columns={columns}
                    rowKey="id"
                    loading={initialLoading}
                    pagination={false}
                    showSorterTooltip={false}
                    scroll={{ x: 'max-content' }}
                    locale={{
                        // Ilk kullanim bosluğu ile FILTRE sonucu yoklugu
                        // AYRI mesajlanir.
                        emptyText: search.trim()
                            ? `No ${title.toLowerCase()} match “${search.trim()}”.`
                            : `No ${title.toLowerCase()} yet. Use “Add ${singular}”.`,
                    }}
                />
                {isFetching && !initialLoading && (
                    <div
                        role="status"
                        style={{
                            marginTop: 8, fontSize: 12, color: 'var(--c-text-muted)',
                        }}
                    >
                        Refreshing…
                    </div>
                )}
            </Card>

            <Modal
                title={editingItem ? `Edit ${singular}` : `Add ${singular}`}
                open={modalOpen}
                onCancel={closeModal}
                onOk={handleSubmit}
                okText={editingItem ? 'Save Changes' : `Add ${singular}`}
                confirmLoading={isSaving}
                /* Pending'te kapanma kilidi (§7). */
                closable={!isSaving}
                maskClosable={!isSaving}
                keyboard={!isSaving}
                /**
                 * `forceRender`: form BASTAN baglidir. Aksi halde Modal
                 * cocuklarini ilk acilisa kadar cizmez ve acilis anindaki
                 * `resetFields()` BAGLI OLMAYAN bir instance'a gider —
                 * hem sessizce etkisiz kalir hem de rc-field-form uyarisi
                 * uretir. Bayat-deger kilidinin calismasi buna bagli.
                 */
                forceRender
            >
                {formError && (
                    <Alert
                        type="error"
                        showIcon
                        style={{ marginBottom: 12 }}
                        message={formError}
                    />
                )}
                <Form form={form} layout="vertical">
                    <Form.Item
                        name="name"
                        label="Name"
                        rules={[
                            { required: true, whitespace: true, message: 'Name is required.' },
                        ]}
                    >
                        <Input
                            placeholder={`${singular} name`}
                            maxLength={255}
                            onChange={(e) => {
                                // Kod YALNIZCA yeni kayitta ada gore turetilir.
                                if (!editingItem) {
                                    form.setFieldValue('code', generateCode(e.target.value))
                                }
                            }}
                        />
                    </Form.Item>
                    <Form.Item
                        name="code"
                        label="Code"
                        rules={[
                            { required: true, whitespace: true, message: 'Code is required.' },
                        ]}
                    >
                        <Input placeholder={`${singular} code`} maxLength={64} />
                    </Form.Item>
                    <Form.Item name="description" label="Description">
                        <Input.TextArea rows={2} maxLength={500} />
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
                open={!!deletingRecord}
                isActive={deletingRecord?.is_active}
                itemName={deletingRecord?.name}
                onConfirm={() => {
                    // Cift yikici islem kilidi KAYNAKTA.
                    if (isDestroying || !deletingRecord) return
                    if (deletingRecord.is_active) {
                        archiveMutation.mutate({ id: deletingRecord.id })
                    } else {
                        deleteMutation.mutate(deletingRecord.id)
                    }
                }}
                onCancel={() => setDeletingRecord(null)}
                loading={isDestroying}
            />
        </div>
    )
}

export default DictionaryCrudPage
