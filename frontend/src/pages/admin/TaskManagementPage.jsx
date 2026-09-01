/**
 * =============================================================================
 * HERMES - Admin Task Management Page
 * =============================================================================
 * RBAC cutover (2026-08-04): Task Access yonetimi ROLLERE tasindi
 * (Users → Roles). Bu sayfada KALANLAR:
 *   1. Task Assignment Hierarchy          — kim kime task atayabilir
 *   2. Issue & Suggestion Hierarchy       — kim kime issue atayabilir
 *   3. Sub Projects                       — musteri/proje alti alt projeler
 *   4. Mail Notifications                 — bildirim kurallari
 * =============================================================================
 */

import { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Table,
    Button,
    Modal,
    Form,
    Select,
    Input,
    Space,
    Spin,
    Switch,
    message,
    Tooltip,
} from 'antd'
import {
    PlusOutlined,
    EditOutlined,
    DeleteOutlined,
    DownOutlined,
    MailOutlined,
    ApartmentOutlined,
    FolderOpenOutlined,
    TeamOutlined,
    InboxOutlined,
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
import './TaskManagementPage.css'
import AssignmentHierarchyTab from './AssignmentHierarchyTab'
import LifecyclePolicyControl from '../../features/tasks/components/LifecyclePolicyControl'
import DangerConfirmModal from '../../components/common/DangerConfirmModal'
import { normalizeApiError } from '../../features/admin/shared/normalizeApiError'
import { resetAndFill } from '../../features/admin/shared/formLifecycle'
import { useT } from '../../i18n'

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

    const columns = [
        { title: t('common.name'), dataIndex: 'name' },
        { title: t('entity.customer'), dataIndex: 'customer_name' },
        { title: t('entity.project'), dataIndex: 'project_name' },
        {
            title: t('common.description'),
            dataIndex: 'description',
            render: (val) => val || '—',
        },
        {
            title: t('admin.createdAt'),
            dataIndex: 'created_at',
            render: (val) => (val ? new Date(val).toLocaleDateString() : '—'),
        },
        {
            title: t('common.actions'),
            render: (_, record) => (
                <Space>
                    {/* AntD Tooltip erisilebilir AD VERMEZ. */}
                    <Tooltip title={t('common.edit')}>
                        <Button
                            size="small"
                            aria-label={`Edit ${record.name}`}
                            disabled={isDeleting}
                            icon={<EditOutlined />}
                            onClick={() => handleOpenEdit(record)}
                        />
                    </Tooltip>
                    <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        /* Bu uc GERCEKTEN kalici siler (soft degil):
                           erisilebilir ad bunu soyler. */
                        aria-label={`Delete ${record.name} permanently`}
                        disabled={isDeleting}
                        onClick={() => setDeletingSub(record)}
                    >{t('common.delete')}</Button>
                </Space>
            ),
        },
    ]

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
            <div
                style={{
                    marginBottom: 12,
                    display: 'flex',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 8,
                }}
            >
                <Space wrap className="tm-sub-filters">
                    <Select
                        allowClear
                        showSearch
                        placeholder={t('entity.customer')}
                        style={{ width: 200 }}
                        value={filterCustomer}
                        onChange={(v) => {
                            setFilterCustomer(v)
                            setFilterProject(null)
                        }}
                        optionFilterProp="label"
                        options={customers.map((c) => ({ value: c.id, label: c.name }))}
                    />
                    <Select
                        allowClear
                        showSearch
                        placeholder={t('entity.project')}
                        style={{ width: 200 }}
                        value={filterProject}
                        disabled={!filterCustomer}
                        onChange={setFilterProject}
                        optionFilterProp="label"
                        options={filteredProjects.map((p) => ({
                            value: p.id,
                            label: p.name,
                        }))}
                    />
                </Space>
                {/* Ortak create-action dili (TE "+" referansi): notr yuzey,
                    hover'da ince mavi ring. Aksiyon section toolbar'inda. */}
                <Button
                    className="h-create-action"
                    icon={<PlusOutlined />}
                    onClick={handleOpenCreate}
                >{t('pm.createSubProject')}</Button>
            </div>

            <Table
                rowKey="id"
                columns={columns}
                dataSource={subProjects}
                loading={isLoading && subProjects.length === 0}
                locale={{
                    // ILK KULLANIM boslugu ile FILTRE sonucu yoklugu AYRI.
                    emptyText: (filterCustomer || filterProject)
                        ? 'No sub-projects match the selected filters.'
                        : 'No sub-projects yet. Use “Create Sub Project”.',
                }}
                pagination={{ pageSize: 20 }}
                scroll={{ x: 'max-content' }}
            />

            <Modal
                title={editing ? 'Edit Sub Project' : 'Create Sub Project'}
                open={modalOpen}
                onCancel={() => {
                    setModalOpen(false)
                    setEditing(null)
                }}
                onOk={() => {
                    if (isSaving) return
                    form.submit()
                }}
                okText={editing ? 'Save Changes' : 'Create Sub Project'}
                confirmLoading={isSaving}
                destroyOnHidden
                closable={!isSaving}
                maskClosable={!isSaving}
                keyboard={!isSaving}
            >
                <Form form={form} layout="vertical" onFinish={handleSubmit}>
                    <Form.Item
                        label={t('entity.customer')}
                        name="customer_id"
                        rules={[{ required: true, message: t('task.customerRequired') }]}
                    >
                        <Select
                            disabled={!!editing}
                            showSearch
                            placeholder={t('task.selectCustomer')}
                            optionFilterProp="label"
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
                                    ? 'Select project'
                                    : 'Select a customer first'
                            }
                            optionFilterProp="label"
                            options={formProjectsList.map((p) => ({
                                value: p.id,
                                label: p.name,
                            }))}
                        />
                    </Form.Item>
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
                body="This will permanently remove the sub project. This action cannot be undone."
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
// Dashboard primitives
// =============================================================================

function StatCard({ icon, label, value, accent }) {
    return (
        <div className="tm-stat" style={{ '--tm-accent': accent }}>
            <div className="tm-stat-icon">{icon}</div>
            <div className="tm-stat-body">
                <div className="tm-stat-value">
                    {value === null || value === undefined ? '—' : value}
                </div>
                <div className="tm-stat-label">{label}</div>
            </div>
        </div>
    )
}

// =============================================================================
// Mail Notifications — admin-configurable e-mail rules per work-item type
// =============================================================================

// Sabitler ANAHTAR tasir, cevrilmis metin DEGIL: ceviri bir hook'a
// baglidir ve modul duzeyinde cagrilamaz. Degerler (task/issue/low...)
// API sozlesmesidir ve cevrilmez.
const NOTIF_TYPES = [
    { value: 'task', labelKey: 'pm.tasks', color: '#388bff' },
    { value: 'issue', labelKey: 'pm.issues', color: '#f97316' },
    { value: 'suggestion', labelKey: 'pm.suggestions', color: '#a855f7' },
]

const NOTIF_PRIORITY_KEYS = [
    ['low', 'task.low'], ['medium', 'task.medium'],
    ['high', 'task.high'], ['urgent', 'task.urgent'],
]

const NOTIF_DUE_KEYS = [
    ['any', 'pm.allItems'], ['with_due', 'pm.onlyWithDueDate'],
    ['without_due', 'pm.onlyWithoutDueDate'],
]

const NOTIF_EVENTS = [
    { key: 'notify_assignment', labelKey: 'pm.assigned' },
    { key: 'notify_accept', labelKey: 'pm.accepted' },
    { key: 'notify_complete', labelKey: 'pm.completed' },
]

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
                priorities: row.priorities,
                due_date_rule: row.due_date_rule,
                ...patch,
            },
        })
    }

    if (isLoading) {
        return (
            <div style={{ textAlign: 'center', padding: 24 }}>
                <Spin />
            </div>
        )
    }

    return (
        <div className="tm-notif">
            <p className="tm-notif-hint">
                E-mails are sent only when ALL rules of the item's type
                match: the type is enabled, the event is on, the item's
                priority is selected, and the due-date rule fits. Types
                never configured default to everything on.
            </p>
            {/* Parametre `type`: eskiden `t` idi ve cevirici `t`'yi
                    GOLGELIYORDU. */}
            {NOTIF_TYPES.map((type) => {
                const row = byType[type.value]
                if (!row) return null
                const disabled = !row.enabled || saveMutation.isPending
                return (
                    <div
                        key={type.value}
                        className={`tm-notif-row${
                            row.enabled ? '' : ' is-off'
                        }`}
                        style={{ '--notif-accent': type.color }}
                    >
                        <div className="tm-notif-head">
                            <span className="tm-notif-dot" />
                            <span className="tm-notif-name">{t(type.labelKey)}</span>
                            <Switch
                                checked={row.enabled}
                                loading={saveMutation.isPending}
                                onChange={(checked) =>
                                    save(row, { enabled: checked })
                                }
                            />
                        </div>
                        <div className="tm-notif-controls">
                            <div className="tm-notif-field">
                                <span className="tm-notif-label">{t('pm.events')}</span>
                                {/*
                                  * Kullanici karari (2026-08-04): dagini k
                                  * checkbox'lar yerine RBAC izin satirlarindaki
                                  * gibi TIKLANABILIR TOGGLE CIP'ler — secili
                                  * olan tonal accent tasir, secili olmayan
                                  * sessiz kalir. Davranis/kaydetme AYNI.
                                  */}
                                <div className="tm-notif-chips">
                                    {NOTIF_EVENTS.map((ev) => {
                                        const on = !!row[ev.key]
                                        return (
                                            <button
                                                key={ev.key}
                                                type="button"
                                                className={`tm-notif-chip${on ? ' is-on' : ''}`}
                                                aria-pressed={on}
                                                disabled={disabled}
                                                onClick={() =>
                                                    save(row, { [ev.key]: !on })
                                                }
                                            >
                                                <span className="tm-notif-chip-dot" aria-hidden="true" />
                                                {t(ev.labelKey)}
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>
                            <div className="tm-notif-field">
                                <span className="tm-notif-label">{t('pm.priorities')}</span>
                                <Select
                                    mode="multiple"
                                    className="tm-notif-priorities"
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
    )
}

function Section({ icon, title, subtitle, count, accent, open, onToggle, children }) {
    return (
        <section className={`tm-section${open ? ' is-open' : ''}`} style={{ '--tm-accent': accent }}>
            <button
                type="button"
                className="tm-section-head"
                onClick={onToggle}
                aria-expanded={open}
            >
                <span className="tm-section-icon">{icon}</span>
                <span className="tm-section-titles">
                    <span className="tm-section-title">{title}</span>
                    {subtitle && (
                        <span className="tm-section-sub">{subtitle}</span>
                    )}
                </span>
                {typeof count === 'number' && (
                    <span className="tm-section-count">{count}</span>
                )}
                <DownOutlined className="tm-section-chevron" />
            </button>
            <div className="tm-section-body-wrap">
                <div className="tm-section-body">
                    <div className="tm-section-inner">{children}</div>
                </div>
            </div>
        </section>
    )
}

// =============================================================================
// Page
// =============================================================================

function TaskManagementPage() {
    const t = useT()
    // Multiple sections can be open at once (accordion felt restrictive).
    const [open, setOpen] = useState({
        lifecycle: false,
        hierarchy: true,
        issueHierarchy: false,
        sub: false,
        mail: false,
    })
    const toggle = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }))

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

    return (
        <div className="tm-page">
            <header className="tm-header">
                <h1 className="tm-title">{t('pm.title')}</h1>
                <p className="tm-subtitle">
                    Manage assignment hierarchies, sub-projects and mail
                    notifications. Who can USE the task module is managed in
                    Roles (Users → Roles).
                </p>
            </header>

            <div className="tm-stats">
                <StatCard
                    icon={<TeamOutlined />}
                    label={t('task.groups')}
                    value={groups.length}
                    accent="#388bff"
                />
                <StatCard
                    icon={<ApartmentOutlined />}
                    label={t('pm.assignmentRules')}
                    value={rulesCount}
                    accent="#7c5cff"
                />
                <StatCard
                    icon={<FolderOpenOutlined />}
                    label={t('pm.subProjectsShort')}
                    value={subProjects.length}
                    accent="#22a06b"
                />
            </div>

            <Section
                icon={<InboxOutlined />}
                title={t('pm.workItemLifecycle')}
                subtitle="When completed and rejected work is archived"
                accent="#38bdf8"
                open={open.lifecycle}
                onToggle={() => toggle('lifecycle')}
            >
                <LifecyclePolicyControl />
            </Section>

            <Section
                icon={<ApartmentOutlined />}
                title={t('pm.taskHierarchy')}
                subtitle="Who can assign tasks to which users or groups"
                count={rulesCount}
                accent="#7c5cff"
                open={open.hierarchy}
                onToggle={() => toggle('hierarchy')}
            >
                <AssignmentHierarchyTab scope="task" />
            </Section>

            <Section
                icon={<ApartmentOutlined />}
                title={t('pm.issueHierarchy')}
                subtitle="Who can assign issues & suggestions to which users or groups"
                count={issueRulesCount}
                accent="#7c5cff"
                open={open.issueHierarchy}
                onToggle={() => toggle('issueHierarchy')}
            >
                <AssignmentHierarchyTab scope="issue" />
            </Section>

            <Section
                icon={<FolderOpenOutlined />}
                title={t('pm.subProjects')}
                subtitle="Task-only sub-projects under a customer/project"
                count={subProjects.length}
                accent="#22a06b"
                open={open.sub}
                onToggle={() => toggle('sub')}
            >
                <SubProjectsTab />
            </Section>

            <Section
                icon={<MailOutlined />}
                title={t('pm.mailNotifications')}
                subtitle="Which e-mails go out, per type / event / priority / due date"
                accent="#f97316"
                open={open.mail}
                onToggle={() => toggle('mail')}
            >
                <MailNotificationsTab />
            </Section>
        </div>
    )
}

export default TaskManagementPage
