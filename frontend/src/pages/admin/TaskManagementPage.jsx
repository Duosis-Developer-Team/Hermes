/**
 * =============================================================================
 * HERMES - Admin Task Management Page (PM Configurations)
 * =============================================================================
 * RBAC cutover (2026-08-04): Task Access yonetimi ROLLERE tasindi
 * (Users → Roles). Bu sayfada KALANLAR:
 *   1. Task Assignment Hierarchy          — kim kime task atayabilir
 *   2. Issue & Suggestion Hierarchy       — kim kime issue atayabilir
 *   3. Sub Projects                       — musteri/proje alti alt projeler
 *   4. Mail Notifications                 — bildirim kurallari
 *   (+ is kalemi yasam dongusu / otomatik arsiv politikasi)
 *
 * Hermes Liquid (29.09): tam genislik; KPI karolari + hap segment ile
 * bolum secimi + her bolum tek cam kart. Veri akisi, sorgu anahtarlari ve
 * mutation'lar AYNI.
 * =============================================================================
 */

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
    Alert,
    Table,
    Button,
    Modal,
    Form,
    Select,
    Input,
    Spin,
    Switch,
    message,
    Tooltip,
} from 'antd'
import {
    PlusOutlined,
    EditOutlined,
    DeleteOutlined,
    MailOutlined,
    ApartmentOutlined,
    FolderOpenOutlined,
    InboxOutlined,
    FlagOutlined,
    FilterOutlined,
    InfoCircleOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
    customerService,
    projectService,
    taskSubProjectService,
    userGroupService,
    taskAssignmentService,
    taskAssignmentGroupService,
    taskNotificationSettingsService,
} from '../../services/api'
import './settingsKit.css'
import './TaskManagementPage.css'
import AssignmentHierarchyTab from './AssignmentHierarchyTab'
import LifecyclePolicyControl from '../../features/tasks/components/LifecyclePolicyControl'
import DangerConfirmModal from '../../components/common/DangerConfirmModal'
import { normalizeApiError } from '../../features/admin/shared/normalizeApiError'
import { resetAndFill } from '../../features/admin/shared/formLifecycle'
import { useT } from '../../i18n'
import { ModalHead } from '../../components/liquid'
import { SettingsEmpty, SettingsKpis, SettingsSection, SettingsTabs } from './settingsKit'
import { customerSelectRender, projectSelectRender } from '../../components/common/customerSelect'
import { selectFilter } from '../../utils/searchText'

// =============================================================================
// Sub Projects
// =============================================================================

export function SubProjectsTab() {
    const t = useT()
    const queryClient = useQueryClient()
    const [filterCustomer, setFilterCustomer] = useState(null)
    const [filterProject, setFilterProject] = useState(null)

    const [modalOpen, setModalOpen] = useState(false)
    const [editing, setEditing] = useState(null)
    const [deletingSub, setDeletingSub] = useState(null)
    const [form] = Form.useForm()

    const { data: customers = [] } = useQuery({
        queryKey: ['customers'],
        queryFn: () => customerService.getAll(),
    })
    const { data: projects = [] } = useQuery({
        queryKey: ['projects'],
        queryFn: () => projectService.getAll(),
    })

    const filteredProjects = useMemo(() => {
        if (!filterCustomer) return projects
        return projects.filter((p) => p.customer_id === filterCustomer)
    }, [projects, filterCustomer])

    const formCustomerId = Form.useWatch('customer_id', form)
    const formProjectsList = useMemo(() => {
        if (!formCustomerId) return []
        return projects.filter((p) => p.customer_id === formCustomerId)
    }, [projects, formCustomerId])

    const {
        data: subProjects = [], isLoading, isError, error, refetch,
    } = useQuery({
        queryKey: ['admin-task-sub-projects', filterCustomer, filterProject],
        queryFn: () =>
            taskSubProjectService.list({
                customer_id: filterCustomer || undefined,
                project_id: filterProject || undefined,
            }),
    })

    const createMutation = useMutation({
        mutationFn: (data) => taskSubProjectService.create(data),
        onSuccess: () => {
            message.success(t('pm.subProjectCreated'))
            setModalOpen(false)
            form.resetFields()
            queryClient.invalidateQueries({ queryKey: ['admin-task-sub-projects'] })
            queryClient.invalidateQueries({ queryKey: ['task-sub-projects'] })
        },
        onError: (err) => {
            message.error(normalizeApiError(err).message)
        },
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => taskSubProjectService.update(id, data),
        onSuccess: () => {
            message.success(t('pm.subProjectUpdated'))
            setModalOpen(false)
            setEditing(null)
            form.resetFields()
            queryClient.invalidateQueries({ queryKey: ['admin-task-sub-projects'] })
            queryClient.invalidateQueries({ queryKey: ['task-sub-projects'] })
        },
        onError: (err) => {
            message.error(normalizeApiError(err).message)
        },
    })

    const deleteMutation = useMutation({
        mutationFn: (id) => taskSubProjectService.delete(id),
        onSuccess: () => {
            message.success(t('pm.subProjectDeleted'))
            setDeletingSub(null)
            queryClient.invalidateQueries({ queryKey: ['admin-task-sub-projects'] })
            queryClient.invalidateQueries({ queryKey: ['task-sub-projects'] })
        },
        onError: (err) => {
            message.error(normalizeApiError(err).message)
            setDeletingSub(null)
        },
    })

    const handleOpenCreate = () => {
        setEditing(null)
        setModalOpen(true)
    }

    const handleOpenEdit = (record) => {
        setEditing(record)
        setModalOpen(true)
    }

    /**
     * Form doldurma MODAL ACILDIKTAN SONRA yapilir. `destroyOnHidden`
     * kullanildigi icin modal kapaliyken form alanlari MOUNT DEGILDIR;
     * acilis handler'i icinde doldurmak baglanmamis bir instance'a
     * yazmak demekti. Etki: ikinci Edit acilisi hic cizilmiyordu.
     *
     * resetAndFill TAM sekli yazar: Edit A → Edit B geciste A'nin (orn.
     * eksik olan) aciklamasi B'de KALMAZ — `setFieldsValue` sig
     * birlestirir.
     */
    useEffect(() => {
        if (!modalOpen) return
        resetAndFill(form, editing
            ? {
                customer_id: editing.customer_id,
                project_id: editing.project_id,
                name: editing.name ?? '',
                description: editing.description ?? '',
            }
            : {
                customer_id: undefined,
                project_id: undefined,
                name: '',
                description: '',
            })
    }, [modalOpen, editing, form])

    const isSaving = createMutation.isPending || updateMutation.isPending
    const isDeleting = deleteMutation.isPending

    const handleSubmit = (values) => {
        // Cift gonderim kilidi KAYNAKTA.
        if (isSaving) return
        if (editing) {
            updateMutation.mutate({
                id: editing.id,
                data: {
                    name: values.name?.trim(),
                    description: values.description || null,
                },
            })
        } else {
            createMutation.mutate({
                customer_id: values.customer_id,
                project_id: values.project_id,
                name: values.name?.trim(),
                description: values.description || null,
            })
        }
    }

    const createAction = (
        /* Ortak create-action dili: sayfa/bolum aksiyonu solid mavi DEGIL. */
        <Button
            className="h-create-action"
            icon={<PlusOutlined />}
            onClick={handleOpenCreate}
        >{t('pm.createSubProject')}</Button>
    )

    const columns = [
        {
            title: t('common.name'),
            dataIndex: 'name',
            render: (val, record) => (
                <span className="tm-sub-name">
                    <span className="tm-sub-name__title">{val}</span>
                    {record.description && (
                        <span className="tm-sub-name__desc">{record.description}</span>
                    )}
                </span>
            ),
        },
        { title: t('entity.customer'), dataIndex: 'customer_name', render: (val) => val || '—' },
        { title: t('entity.project'), dataIndex: 'project_name', render: (val) => val || '—' },
        {
            title: t('admin.createdAt'),
            dataIndex: 'created_at',
            width: 130,
            render: (val) => (
                <span className="sk-nowrap sk-muted">{val ? new Date(val).toLocaleDateString() : '—'}</span>
            ),
        },
        {
            title: <span className="h-sr-only">{t('common.actions')}</span>,
            key: 'actions',
            width: 96,
            align: 'right',
            render: (_, record) => (
                <span className="sk-row-actions">
                    {/* AntD Tooltip erisilebilir AD VERMEZ. */}
                    <Tooltip title={t('common.edit')}>
                        <Button
                            size="small"
                            className="h-inline-action"
                            aria-label={t('pm.editNamed', { name: record.name })}
                            disabled={isDeleting}
                            icon={<EditOutlined />}
                            onClick={() => handleOpenEdit(record)}
                        />
                    </Tooltip>
                    <Tooltip title={t('common.delete')}>
                        <Button
                            size="small"
                            className="h-inline-action h-inline-action--danger"
                            icon={<DeleteOutlined />}
                            /* Bu uc GERCEKTEN kalici siler (soft degil):
                               erisilebilir ad bunu soyler. */
                            aria-label={t('pm.deleteNamedPermanently', { name: record.name })}
                            disabled={isDeleting}
                            onClick={() => setDeletingSub(record)}
                        />
                    </Tooltip>
                </span>
            ),
        },
    ]

    const filtering = Boolean(filterCustomer || filterProject)

    return (
        <>
            {isError && (
                <Alert
                    type="error"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message={normalizeApiError(error).message}
                    action={
                        <Button size="small" onClick={() => refetch()}>{t('common.retry')}</Button>
                    }
                />
            )}
            <div className="sk-toolbar">
                <div className="sk-toolbar__filters tm-sub-filters">
                    <Select
                        allowClear
                        showSearch
                        aria-label={t('pm.filterByCustomer')}
                        placeholder={t('entity.customer')}
                        className="tm-sub-filter"
                        value={filterCustomer}
                        onChange={(v) => {
                            setFilterCustomer(v)
                            setFilterProject(null)
                        }}
                        filterOption={selectFilter}
                        options={customers.map((c) => ({ value: c.id, label: c.name }))}
                        {...customerSelectRender}
                    />
                    <Select
                        allowClear
                        showSearch
                        aria-label={t('pm.filterByProject')}
                        placeholder={t('entity.project')}
                        className="tm-sub-filter"
                        value={filterProject}
                        disabled={!filterCustomer}
                        onChange={setFilterProject}
                        filterOption={selectFilter}
                        options={filteredProjects.map((p) => ({
                            value: p.id,
                            label: p.name,
                        }))}
                        {...projectSelectRender}
                    />
                </div>
                {createAction}
            </div>

            <Table
                rowKey="id"
                columns={columns}
                dataSource={subProjects}
                loading={isLoading && subProjects.length === 0}
                locale={{
                    // ILK KULLANIM boslugu ile FILTRE sonucu yoklugu AYRI.
                    emptyText: filtering ? (
                        <SettingsEmpty
                            compact
                            icon={<FilterOutlined />}
                            text={t('pm.noSubProjectsMatch')}
                        />
                    ) : (
                        <SettingsEmpty
                            icon={<FolderOpenOutlined />}
                            title={t('pm.noSubProjectsTitle')}
                            text={t('pm.noSubProjectsText')}
                        />
                    ),
                }}
                pagination={{ pageSize: 20, hideOnSinglePage: true }}
                scroll={{ x: 'max-content' }}
            />

            <Modal
                title={<ModalHead icon={<FolderOpenOutlined />} tone="green" title={editing ? t('modalTitles.editSubProject') : t('modalTitles.createSubProject')} />}
                open={modalOpen}
                onCancel={() => {
                    setModalOpen(false)
                    setEditing(null)
                }}
                onOk={() => {
                    if (isSaving) return
                    form.submit()
                }}
                okText={editing ? t('pm.saveChanges') : t('pm.createSubProject')}
                confirmLoading={isSaving}
                destroyOnHidden
                closable={!isSaving}
                maskClosable={!isSaving}
                keyboard={!isSaving}
            >
                <Form form={form} layout="vertical" onFinish={handleSubmit}>
                    <div className="lq-frm">
                        <Form.Item
                            label={t('entity.customer')}
                            name="customer_id"
                            rules={[{ required: true, message: t('task.customerRequired') }]}
                        >
                            <Select
                                disabled={!!editing}
                                showSearch
                                placeholder={t('task.selectCustomer')}
                                filterOption={selectFilter}
                                onChange={() => {
                                    form.setFieldsValue({ project_id: undefined })
                                }}
                                options={customers.map((c) => ({
                                    value: c.id,
                                    label: c.name,
                                }))}
                            />
                        </Form.Item>
                        <Form.Item
                            label={t('entity.project')}
                            name="project_id"
                            rules={[{ required: true, message: t('task.projectRequired') }]}
                        >
                            <Select
                                disabled={!!editing || !formCustomerId}
                                showSearch
                                placeholder={
                                    formCustomerId
                                        ? t('pm.selectProject')
                                        : t('pm.selectCustomerFirst')
                                }
                                filterOption={selectFilter}
                                options={formProjectsList.map((p) => ({
                                    value: p.id,
                                    label: p.name,
                                }))}
                            />
                        </Form.Item>
                    </div>
                    <Form.Item
                        label={t('common.name')}
                        name="name"
                        rules={[
                            {
                                required: true, whitespace: true,
                                message: t('pm.nameRequired'),
                            },
                            { max: 255, message: t('task.maxChars') },
                        ]}
                    >
                        <Input maxLength={255} />
                    </Form.Item>
                    <Form.Item label={t('common.description')} name="description">
                        <Input.TextArea rows={3} />
                    </Form.Item>
                </Form>
            </Modal>

            <DangerConfirmModal
                open={!!deletingSub}
                title={t('pm.deleteSubProject')}
                body={t('pm.deleteSubProjectBody')}
                itemName={deletingSub?.name}
                itemSubtitle={
                    deletingSub
                        ? `${deletingSub.customer_name || '—'}${
                              deletingSub.project_name
                                  ? ` · ${deletingSub.project_name}`
                                  : ''
                          }`
                        : null
                }
                confirmLabel={t('common.delete')}
                onCancel={() => setDeletingSub(null)}
                onConfirm={() => {
                    // Cift tetikleme kilidi KAYNAKTA.
                    if (isDeleting || !deletingSub) return
                    deleteMutation.mutate(deletingSub.id)
                }}
                loading={isDeleting}
            />
        </>
    )
}

// =============================================================================
// Mail Notifications — admin-configurable e-mail rules per work-item type
// =============================================================================

// Sabitler ANAHTAR tasir, cevrilmis metin DEGIL: ceviri bir hook'a
// baglidir ve modul duzeyinde cagrilamaz. Degerler (task/issue/low...)
// API sozlesmesidir ve cevrilmez. `tone` = tur rengi (token).
const NOTIF_TYPES = [
    { value: 'task', labelKey: 'pm.tasks', tone: 'blue' },
    { value: 'issue', labelKey: 'pm.issues', tone: 'amber' },
    { value: 'suggestion', labelKey: 'pm.suggestions', tone: 'violet' },
]

const NOTIF_PRIORITY_KEYS = [
    ['low', 'task.low'], ['medium', 'task.medium'],
    ['high', 'task.high'], ['urgent', 'task.urgent'],
]

const NOTIF_DUE_KEYS = [
    ['any', 'pm.allItems'], ['with_due', 'pm.onlyWithDueDate'],
    ['without_due', 'pm.onlyWithoutDueDate'],
]

const NOTIF_CHANNELS = [
    { key: 'email_enabled', labelKey: 'pm.channelEmail' },
    { key: 'in_app_enabled', labelKey: 'pm.channelInApp' },
]

const NOTIF_EVENTS = [
    { key: 'notify_assignment', labelKey: 'pm.assigned' },
    { key: 'notify_accept', labelKey: 'pm.accepted' },
    { key: 'notify_complete', labelKey: 'pm.completed' },
]

function NotifChips({ items, isOn, disabled, onToggle, ariaLabel }) {
    const t = useT()
    return (
        <div className="tm-notif-chips" role="group" aria-label={ariaLabel}>
            {items.map((it) => {
                const on = isOn(it.key)
                return (
                    <button
                        key={it.key}
                        type="button"
                        className={`tm-notif-chip${on ? ' is-on' : ''}`}
                        aria-pressed={on}
                        disabled={disabled}
                        onClick={() => onToggle(it.key, on)}
                    >
                        <span className="tm-notif-chip-dot" aria-hidden="true" />
                        {t(it.labelKey)}
                    </button>
                )
            })}
        </div>
    )
}

function MailNotificationsTab() {
    const t = useT()
    const priorityOptions = NOTIF_PRIORITY_KEYS.map(([value, key]) => ({
        value, label: t(key),
    }))
    const dueRuleOptions = NOTIF_DUE_KEYS.map(([value, key]) => ({
        value, label: t(key),
    }))
    const queryClient = useQueryClient()

    const { data: settings = [], isLoading } = useQuery({
        queryKey: ['admin-notification-settings'],
        queryFn: () => taskNotificationSettingsService.list(),
    })
    const byType = useMemo(() => {
        const map = {}
        for (const s of settings) map[s.task_type] = s
        return map
    }, [settings])

    const saveMutation = useMutation({
        mutationFn: ({ taskType, data }) =>
            taskNotificationSettingsService.update(taskType, data),
        onSuccess: () => {
            message.success(t('pm.notificationsSaved'))
            queryClient.invalidateQueries({
                queryKey: ['admin-notification-settings'],
            })
        },
        onError: (err) => {
            message.error(normalizeApiError(err).message)
        },
    })

    // Every change sends the FULL row (current values + the patch) so the
    // backend upsert stays a simple whole-row write.
    const save = (row, patch) => {
        saveMutation.mutate({
            taskType: row.task_type,
            data: {
                enabled: row.enabled,
                notify_assignment: row.notify_assignment,
                notify_accept: row.notify_accept,
                notify_complete: row.notify_complete,
                // C3: kanal anahtarlari — eski satirlarda yoksa acik sayilir.
                email_enabled: row.email_enabled !== false,
                in_app_enabled: row.in_app_enabled !== false,
                priorities: row.priorities,
                due_date_rule: row.due_date_rule,
                ...patch,
            },
        })
    }

    if (isLoading) {
        return <div className="tm-loading"><Spin /></div>
    }

    const rows = NOTIF_TYPES.filter((type) => byType[type.value])

    return (
        <div className="tm-notif">
            <p className="sk-hint">
                <InfoCircleOutlined aria-hidden="true" />
                <span>{t('pm.notifHint')}</span>
            </p>
            {rows.length === 0 ? (
                <SettingsEmpty compact icon={<MailOutlined />} text={t('pm.noNotifSettings')} />
            ) : (
                <div className="tm-notif-grid">
                    {/* Parametre `type`: eskiden `t` idi ve cevirici `t`'yi
                        GOLGELIYORDU. */}
                    {rows.map((type) => {
                        const row = byType[type.value]
                        const disabled = !row.enabled || saveMutation.isPending
                        const typeLabel = t(type.labelKey)
                        return (
                            <div
                                key={type.value}
                                className={`tm-notif-row tm-notif-row--${type.tone}${
                                    row.enabled ? '' : ' is-off'
                                }`}
                            >
                                <div className="tm-notif-head">
                                    <span className="tm-notif-dot" aria-hidden="true" />
                                    <span className="tm-notif-name">{typeLabel}</span>
                                    <Switch
                                        aria-label={t('pm.notifToggle', { type: typeLabel })}
                                        checked={row.enabled}
                                        loading={saveMutation.isPending}
                                        onChange={(checked) =>
                                            save(row, { enabled: checked })
                                        }
                                    />
                                </div>
                                <div className="tm-notif-controls">
                                    {/* C3 (PM rework P2.2): kanal ayrimi — bir olayi
                                        e-postada kapatip uygulama icinde acik birakmak. */}
                                    <div className="tm-notif-field">
                                        <span className="tm-notif-label">{t('pm.channels')}</span>
                                        <NotifChips
                                            ariaLabel={`${typeLabel} · ${t('pm.channels')}`}
                                            items={NOTIF_CHANNELS}
                                            isOn={(key) => row[key] !== false}
                                            disabled={disabled}
                                            onToggle={(key, on) => save(row, { [key]: !on })}
                                        />
                                    </div>
                                    {/*
                                      * Kullanici karari (2026-08-04): daginik
                                      * checkbox'lar yerine RBAC izin satirlarindaki
                                      * gibi TIKLANABILIR TOGGLE CIP'ler. Davranis/
                                      * kaydetme AYNI.
                                      */}
                                    <div className="tm-notif-field">
                                        <span className="tm-notif-label">{t('pm.events')}</span>
                                        <NotifChips
                                            ariaLabel={`${typeLabel} · ${t('pm.events')}`}
                                            items={NOTIF_EVENTS}
                                            isOn={(key) => !!row[key]}
                                            disabled={disabled}
                                            onToggle={(key, on) => save(row, { [key]: !on })}
                                        />
                                    </div>
                                    <div className="tm-notif-field">
                                        <span className="tm-notif-label">{t('pm.priorities')}</span>
                                        <Select
                                            mode="multiple"
                                            className="tm-notif-priorities"
                                            aria-label={`${typeLabel} · ${t('pm.priorities')}`}
                                            value={row.priorities}
                                            options={priorityOptions}
                                            disabled={disabled}
                                            maxTagCount="responsive"
                                            placeholder={t('pm.noPrioritiesNoMail')}
                                            onChange={(vals) =>
                                                save(row, { priorities: vals })
                                            }
                                        />
                                    </div>
                                    <div className="tm-notif-field">
                                        <span className="tm-notif-label">{t('pm.dueDate')}</span>
                                        <Select
                                            className="tm-notif-due"
                                            aria-label={`${typeLabel} · ${t('pm.dueDate')}`}
                                            value={row.due_date_rule}
                                            options={dueRuleOptions}
                                            disabled={disabled}
                                            onChange={(val) =>
                                                save(row, { due_date_rule: val })
                                            }
                                        />
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

// =============================================================================
// Page
// =============================================================================

const SECTION_KEYS = ['hierarchy', 'issueHierarchy', 'sub', 'mail', 'lifecycle']

function TaskManagementPage() {
    const t = useT()
    /* Bolum secimi URL'de (`?section=`): geri tusu ve paylasilan baglanti
       ayni bolumu acar. Bilinmeyen deger varsayilana duser. */
    const [params, setParams] = useSearchParams()
    const requested = params.get('section')
    const section = SECTION_KEYS.includes(requested) ? requested : 'hierarchy'
    const selectSection = (key) => {
        setParams((prev) => {
            const next = new URLSearchParams(prev)
            next.set('section', key)
            return next
        }, { replace: true })
    }

    // Summary stats — reuse the exact query keys the sections use, so React
    // Query serves them from one shared cache (no duplicate network calls).
    const { data: groups = [] } = useQuery({
        queryKey: ['admin-user-groups'],
        queryFn: () => userGroupService.list(),
    })
    const { data: userRelations = [] } = useQuery({
        queryKey: ['admin-task-assignment-relations', 'task'],
        queryFn: () => taskAssignmentService.list('task'),
    })
    const { data: groupRelations = [] } = useQuery({
        queryKey: ['admin-task-assignment-group-relations', 'task'],
        queryFn: () => taskAssignmentGroupService.list('task'),
    })
    const { data: issueUserRelations = [] } = useQuery({
        queryKey: ['admin-task-assignment-relations', 'issue'],
        queryFn: () => taskAssignmentService.list('issue'),
    })
    const { data: issueGroupRelations = [] } = useQuery({
        queryKey: ['admin-task-assignment-group-relations', 'issue'],
        queryFn: () => taskAssignmentGroupService.list('issue'),
    })
    const { data: subProjects = [] } = useQuery({
        queryKey: ['admin-task-sub-projects', null, null],
        queryFn: () => taskSubProjectService.list({}),
    })
    const rulesCount = userRelations.length + groupRelations.length
    const issueRulesCount =
        issueUserRelations.length + issueGroupRelations.length

    const sections = {
        hierarchy: {
            icon: <ApartmentOutlined />, tone: 'violet',
            title: t('pm.taskHierarchy'), subtitle: t('pm.taskHierarchySub'),
            tab: t('pm.tabTaskHierarchy'), count: rulesCount,
            body: <AssignmentHierarchyTab scope="task" />,
        },
        issueHierarchy: {
            icon: <FlagOutlined />, tone: 'amber',
            title: t('pm.issueHierarchy'), subtitle: t('pm.issueHierarchySub'),
            tab: t('pm.tabIssueHierarchy'), count: issueRulesCount,
            body: <AssignmentHierarchyTab scope="issue" />,
        },
        sub: {
            icon: <FolderOpenOutlined />, tone: 'green',
            title: t('pm.subProjects'), subtitle: t('pm.subProjectsSub'),
            tab: t('pm.subProjectsShort'), count: subProjects.length,
            body: <SubProjectsTab />,
        },
        mail: {
            icon: <MailOutlined />, tone: 'blue',
            title: t('pm.mailNotifications'), subtitle: t('pm.mailNotificationsSub'),
            tab: t('pm.tabNotifications'),
            body: <MailNotificationsTab />,
        },
        lifecycle: {
            icon: <InboxOutlined />, tone: 'ink',
            title: t('pm.workItemLifecycle'), subtitle: t('pm.lifecycleSub'),
            tab: t('pm.tabLifecycle'),
            body: <LifecyclePolicyControl />,
        },
    }
    const active = sections[section]

    return (
        <div className="tm-page">
            <div className="page-header">
                <h1>{t('pm.title')}</h1>
                <p>{t('pm.subtitle')}</p>
            </div>

            <SettingsKpis
                ariaLabel={t('pm.summary')}
                items={[
                    { key: 'groups', label: t('task.groups'), value: groups.length },
                    { key: 'task', label: t('pm.kpiTaskRules'), value: rulesCount },
                    { key: 'issue', label: t('pm.kpiIssueRules'), value: issueRulesCount },
                    { key: 'sub', label: t('pm.subProjectsShort'), value: subProjects.length },
                ]}
            />

            <SettingsTabs
                ariaLabel={t('pm.sections')}
                value={section}
                onChange={selectSection}
                options={SECTION_KEYS.map((key) => ({
                    value: key,
                    label: sections[key].tab,
                    count: sections[key].count,
                }))}
            />

            {/* key: bolum degisince kart yeniden girer (lq-enter). */}
            <div className="lq-enter" key={section}>
                <SettingsSection
                    icon={active.icon}
                    tone={active.tone}
                    title={active.title}
                    subtitle={active.subtitle}
                    count={active.count}
                >
                    {active.body}
                </SettingsSection>
            </div>
        </div>
    )
}

export default TaskManagementPage
