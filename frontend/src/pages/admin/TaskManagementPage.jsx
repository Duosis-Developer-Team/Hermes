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
import DangerConfirmModal from '../../components/common/DangerConfirmModal'
import { normalizeApiError } from '../../features/admin/shared/normalizeApiError'
import { resetAndFill } from '../../features/admin/shared/formLifecycle'

// =============================================================================
// Sub Projects
// =============================================================================

export function SubProjectsTab() {
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
            message.success('Sub project created.')
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
            message.success('Sub project updated.')
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
            message.success('Sub project deleted.')
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
        { title: 'Name', dataIndex: 'name' },
        { title: 'Customer', dataIndex: 'customer_name' },
        { title: 'Project', dataIndex: 'project_name' },
        {
            title: 'Description',
            dataIndex: 'description',
            render: (val) => val || '—',
        },
        {
            title: 'Created',
            dataIndex: 'created_at',
            render: (val) => (val ? new Date(val).toLocaleDateString() : '—'),
        },
        {
            title: 'Actions',
            render: (_, record) => (
                <Space>
                    {/* AntD Tooltip erisilebilir AD VERMEZ. */}
                    <Tooltip title="Edit">
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
                    >
                        Delete
                    </Button>
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
                        <Button size="small" onClick={() => refetch()}>
                            Retry
                        </Button>
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
                        placeholder="Customer"
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
                        placeholder="Project"
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
                >
                    Create Sub Project
                </Button>
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
                        label="Customer"
                        name="customer_id"
                        rules={[{ required: true, message: 'Customer is required.' }]}
                    >
                        <Select
                            disabled={!!editing}
                            showSearch
                            placeholder="Select customer"
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
                        label="Project"
                        name="project_id"
                        rules={[{ required: true, message: 'Project is required.' }]}
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
                        label="Name"
                        name="name"
                        rules={[
                            {
                                required: true, whitespace: true,
                                message: 'Name is required.',
                            },
                            { max: 255, message: 'Max 255 characters.' },
                        ]}
                    >
                        <Input maxLength={255} />
                    </Form.Item>
                    <Form.Item label="Description" name="description">
                        <Input.TextArea rows={3} />
                    </Form.Item>
                </Form>
            </Modal>

            <DangerConfirmModal
                open={!!deletingSub}
                title="Delete sub project?"
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
                confirmLabel="Delete"
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

const NOTIF_TYPES = [
    { value: 'task', label: 'Tasks', color: '#388bff' },
    { value: 'issue', label: 'Issues', color: '#f97316' },
    { value: 'suggestion', label: 'Suggestions', color: '#a855f7' },
]

const NOTIF_PRIORITY_OPTIONS = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'urgent', label: 'Urgent' },
]

const NOTIF_DUE_RULES = [
    { value: 'any', label: 'All items' },
    { value: 'with_due', label: 'Only with due date' },
    { value: 'without_due', label: 'Only without due date' },
]

const NOTIF_EVENTS = [
    { key: 'notify_assignment', label: 'Assigned' },
    { key: 'notify_accept', label: 'Accepted' },
    { key: 'notify_complete', label: 'Completed' },
]

function MailNotificationsTab() {
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
            message.success('Notification settings saved.')
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
            {NOTIF_TYPES.map((t) => {
                const row = byType[t.value]
                if (!row) return null
                const disabled = !row.enabled || saveMutation.isPending
                return (
                    <div
                        key={t.value}
                        className={`tm-notif-row${
                            row.enabled ? '' : ' is-off'
                        }`}
                        style={{ '--notif-accent': t.color }}
                    >
                        <div className="tm-notif-head">
                            <span className="tm-notif-dot" />
                            <span className="tm-notif-name">{t.label}</span>
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
                                <span className="tm-notif-label">Events</span>
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
                                                {ev.label}
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>
                            <div className="tm-notif-field">
                                <span className="tm-notif-label">
                                    Priorities
                                </span>
                                <Select
                                    mode="multiple"
                                    className="tm-notif-priorities"
                                    value={row.priorities}
                                    options={NOTIF_PRIORITY_OPTIONS}
                                    disabled={disabled}
                                    maxTagCount="responsive"
                                    placeholder="No priorities → no e-mails"
                                    onChange={(vals) =>
                                        save(row, { priorities: vals })
                                    }
                                />
                            </div>
                            <div className="tm-notif-field">
                                <span className="tm-notif-label">
                                    Due date
                                </span>
                                <Select
                                    className="tm-notif-due"
                                    value={row.due_date_rule}
                                    options={NOTIF_DUE_RULES}
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
    // Multiple sections can be open at once (accordion felt restrictive).
    const [open, setOpen] = useState({
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
                <h1 className="tm-title">PM Configurations</h1>
                <p className="tm-subtitle">
                    Manage assignment hierarchies, sub-projects and mail
                    notifications. Who can USE the task module is managed in
                    Roles (Users → Roles).
                </p>
            </header>

            <div className="tm-stats">
                <StatCard
                    icon={<TeamOutlined />}
                    label="Groups"
                    value={groups.length}
                    accent="#388bff"
                />
                <StatCard
                    icon={<ApartmentOutlined />}
                    label="Assignment rules"
                    value={rulesCount}
                    accent="#7c5cff"
                />
                <StatCard
                    icon={<FolderOpenOutlined />}
                    label="Sub-projects"
                    value={subProjects.length}
                    accent="#22a06b"
                />
            </div>

            <Section
                icon={<ApartmentOutlined />}
                title="Task Hierarchy"
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
                title="Issue / Suggestion Hierarchy"
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
                title="Sub Projects"
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
                title="Mail Notifications"
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
