/**
 * =============================================================================
 * HERMES - Proje turleri (Ayarlar > Musteri ve projeler)
 * =============================================================================
 * Destek, Talep, Proje... Turun iki isi var:
 *   - Efor girisinde projeler ture gore alt basliklar altinda listelenir.
 *   - Turun RENGI, o turdeki projelerin jenerik logolarinin rengidir
 *     (renk + glif). Renk degisince hepsi birlikte degisir.
 * Renk serbest degil: ana renk paletinden (features/projectTypes/palette)
 * gorsel orneklerle secilir. Kullanimdaki tur silinemez (once projeler
 * baska ture tasinir).
 * =============================================================================
 */
import { useMemo, useState } from 'react'
import { Button, Card, Form, Input, Modal, Space, Table, message } from 'antd'
import { BgColorsOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { projectService, projectTypeService } from '../../services/api'
import { queryKeys } from '../../query/queryKeys'
import { normalizeApiError } from '../../features/admin/shared/normalizeApiError'
import { AdminErrorAlert, AdminRefreshHint } from '../../features/admin/shared/AdminListStates'
import { GenericLogo, ModalHead } from '../../components/liquid'
import { PROJECT_TYPE_COLOR_KEYS, PROJECT_TYPE_PALETTE } from '../../features/projectTypes/palette'
import { useT } from '../../i18n'
import { ProjectPeek, useRowDisclosure } from '../../features/admin/shared/ProjectPeek'
import './ProjectTypesPage.css'

// Onizlemede renk + glif mantigini gosteren ornek glifler.
const PREVIEW_GLYPHS = ['general', 'monitoring', 'lv2', 'devops', 'meeting']

/** Ana renklerden secim: gradyan ornek + ad (yalniz metin degil). */
export function ColorPicker({ value, onChange, labelId }) {
    const t = useT()
    return (
        <div className="pt-colors" role="radiogroup" aria-labelledby={labelId}>
            {PROJECT_TYPE_COLOR_KEYS.map((key) => {
                const { from, to } = PROJECT_TYPE_PALETTE[key]
                const on = value === key
                return (
                    <button
                        key={key}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        className={`pt-color${on ? ' is-on' : ''}`}
                        onClick={() => onChange?.(key)}
                    >
                        <span className="pt-color__swatch" style={{ background: `linear-gradient(135deg, ${from}, ${to})` }} aria-hidden="true" />
                        <span className="pt-color__name">{t(`projectTypes.colorName.${key}`)}</span>
                    </button>
                )
            })}
        </div>
    )
}

function ProjectTypesPage() {
    const t = useT()
    const queryClient = useQueryClient()
    const [form] = Form.useForm()
    const [editing, setEditing] = useState(null) // null | 'new' | kayit
    const [deleting, setDeleting] = useState(null)
    const color = Form.useWatch('color', form)
    const name = Form.useWatch('name', form)

    const { data: types = [], isLoading, isFetching, isError, error, refetch } = useQuery({
        queryKey: queryKeys.projectTypes.all,
        queryFn: () => projectTypeService.getAll(),
    })

    // Satira tikla → altinda turun projeleri (yalniz goruntuleme).
    const { data: allProjects = [], isLoading: projectsLoading } = useQuery({
        queryKey: ['projects', { include_inactive: true }],
        queryFn: () => projectService.getAll({ include_inactive: true }),
    })
    const projectsByType = useMemo(() => {
        const out = {}
        for (const p of allProjects) if (p.project_type_id) (out[p.project_type_id] ||= []).push(p)
        return out
    }, [allProjects])
    const rowDisclosure = useRowDisclosure()

    // Tur rengi/adi projelerin yanitinda tasinir: proje listeleri de tazelenir
    // (jenerik logolar yeni renge gecer).
    const refresh = () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.projectTypes.all })
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
        queryClient.invalidateQueries({ queryKey: ['projects'] })
    }

    const close = () => { setEditing(null); form.resetFields() }

    const save = useMutation({
        mutationFn: (values) => (editing && editing !== 'new'
            ? projectTypeService.update(editing.id, values)
            : projectTypeService.create(values)),
        onSuccess: () => {
            message.success(t(editing && editing !== 'new' ? 'projectTypes.updated' : 'projectTypes.created'))
            close()
            refresh()
        },
        onError: (err) => message.error(normalizeApiError(err).message),
    })

    const remove = useMutation({
        mutationFn: (id) => projectTypeService.delete(id),
        onSuccess: () => { message.success(t('projectTypes.deleted')); setDeleting(null); refresh() },
        onError: (err) => message.error(normalizeApiError(err).message),
    })

    const open = (record) => {
        setEditing(record || 'new')
        form.resetFields()
        form.setFieldsValue(record ? { name: record.name, color: record.color } : { name: '', color: 'blue' })
    }

    const askDelete = (record) => {
        if (record.project_count > 0) {
            message.warning(t('projectTypes.deleteInUse', { n: record.project_count }))
            return
        }
        setDeleting(record)
    }

    const columns = [
        {
            title: t('projectTypes.name'),
            dataIndex: 'name',
            key: 'name',
            render: (value, record) => (
                <span className="admin-name">
                    <GenericLogo glyph="general" color={record.color} size={32} />
                    <span className="admin-name__text"><b>{value}</b></span>
                </span>
            ),
        },
        {
            title: t('projectTypes.color'),
            dataIndex: 'color',
            key: 'color',
            render: (key) => {
                const tone = PROJECT_TYPE_PALETTE[key]
                return (
                    <span className="pt-chip">
                        <i style={tone ? { background: `linear-gradient(135deg, ${tone.from}, ${tone.to})` } : undefined} aria-hidden="true" />
                        {t(`projectTypes.colorName.${key}`)}
                    </span>
                )
            },
        },
        {
            title: t('projectTypes.projects'),
            dataIndex: 'project_count',
            key: 'project_count',
            width: 120,
            render: (n) => <span className="pt-count">{t('projectTypes.projectCount', { n })}</span>,
        },
        {
            title: t('common.actions'),
            key: 'actions',
            width: 110,
            render: (_, record) => (
                <Space>
                    <Button type="text" icon={<EditOutlined />} aria-label={`${t('projectTypes.editType')}: ${record.name}`} onClick={() => open(record)} />
                    <Button type="text" danger icon={<DeleteOutlined />} aria-label={`${t('projectTypes.deleteTitle')}: ${record.name}`} onClick={() => askDelete(record)} />
                </Space>
            ),
        },
    ]

    return (
        <div className="project-types-page fade-in">
            <div className="page-header">
                <h1>{t('projectTypes.title')}</h1>
                <p>{t('projectTypes.subtitle')}</p>
            </div>
            <AdminErrorAlert error={isError ? error : null} onRetry={refetch} />

            <Card
                variant="borderless"
                title={t('admin.entityCount', { entity: t('projectTypes.title'), n: types.length })}
                extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => open(null)}>{t('projectTypes.newType')}</Button>}
            >
                <Table
                    {...rowDisclosure((record) => (
                        <ProjectPeek projects={projectsByType[record.id] || []} meta="customer" loading={projectsLoading} />
                    ))}
                    dataSource={types}
                    columns={columns}
                    rowKey="id"
                    loading={isLoading && types.length === 0}
                    pagination={false}
                    scroll={{ x: 'max-content' }}
                    locale={{
                        emptyText: (
                            <div className="pt-empty">
                                <b>{t('projectTypes.empty')}</b>
                                <p>{t('projectTypes.emptyHint')}</p>
                                <Button type="primary" icon={<PlusOutlined />} onClick={() => open(null)}>{t('projectTypes.newType')}</Button>
                            </div>
                        ),
                    }}
                />
                <AdminRefreshHint isFetching={isFetching} hasData={types.length > 0} />
            </Card>

            <Modal
                title={<ModalHead icon={<BgColorsOutlined />} tone="violet" title={t(editing && editing !== 'new' ? 'projectTypes.editType' : 'projectTypes.newType')} />}
                open={!!editing}
                onCancel={close}
                footer={null}
                width={560}
                closable={!save.isPending}
                maskClosable={!save.isPending}
            >
                <Form form={form} layout="vertical" onFinish={(values) => { if (!save.isPending) save.mutate(values) }}>
                    <Form.Item name="name" label={t('projectTypes.name')} rules={[{ required: true, whitespace: true, message: t('projectTypes.nameRequired') }]}>
                        <Input placeholder={t('projectTypes.nameExample')} maxLength={100} />
                    </Form.Item>
                    <Form.Item name="color" label={<span id="pt-color-label">{t('projectTypes.color')}</span>} extra={t('projectTypes.colorHint')} rules={[{ required: true }]}>
                        <ColorPicker labelId="pt-color-label" />
                    </Form.Item>
                    <div className="pt-preview" aria-label={t('projectTypes.preview')}>
                        <span className="pt-preview__label">{t('projectTypes.preview')}</span>
                        <div className="pt-preview__row">
                            {PREVIEW_GLYPHS.map((g) => <GenericLogo key={g} glyph={g} color={color} size={44} />)}
                            <b className="pt-preview__name">{name?.trim() || t('projectTypes.nameExample')}</b>
                        </div>
                    </div>
                    <div className="lq-mf">
                        <Button onClick={close}>{t('common.cancel')}</Button>
                        <Button type="primary" htmlType="submit" loading={save.isPending}>
                            {editing && editing !== 'new' ? t('admin.update') : t('common.create')}
                        </Button>
                    </div>
                </Form>
            </Modal>

            <Modal
                title={<ModalHead icon={<DeleteOutlined />} tone="red" title={t('projectTypes.deleteTitle')} />}
                open={!!deleting}
                onCancel={() => setDeleting(null)}
                footer={null}
            >
                <p>{t('projectTypes.deleteBody', { name: deleting?.name || '' })}</p>
                <div className="lq-mf">
                    <Button onClick={() => setDeleting(null)}>{t('common.cancel')}</Button>
                    <Button danger type="primary" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>
                        {t('projectTypes.deleteTitle')}
                    </Button>
                </div>
            </Modal>
        </div>
    )
}

export default ProjectTypesPage
