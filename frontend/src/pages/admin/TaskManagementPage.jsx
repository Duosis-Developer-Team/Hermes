/**
 * =============================================================================
 * HERMES - Admin Task Management Page
 * =============================================================================
 * Tabs:
 *   1. Task Access           — group-driven permission management, with an
 *                              "Additional Users" section for people who
 *                              live outside any group.
 *   2. Assignment Hierarchy  — assigner -> assignees mappings.
 *   3. Sub Projects          — task-only sub projects under customer/project.
 * =============================================================================
 */

import { useMemo, useState } from 'react'
import {
    Table,
    Button,
    Modal,
    Form,
    Select,
    Input,
    Space,
    message,
    Tooltip,
} from 'antd'
import {
    PlusOutlined,
    EditOutlined,
    DeleteOutlined,
    DownOutlined,
    SafetyCertificateOutlined,
    ApartmentOutlined,
    FolderOpenOutlined,
    TeamOutlined,
    KeyOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
    customerService,
    projectService,
    taskSubProjectService,
    userGroupService,
    taskAssignmentService,
    taskAssignmentGroupService,
    taskPermissionService,
} from '../../services/api'
import './TaskManagementPage.css'
import TaskAccessByGroupTab from './TaskAccessByGroupTab'
import AssignmentHierarchyTab from './AssignmentHierarchyTab'
import DangerConfirmModal from '../../components/common/DangerConfirmModal'

// =============================================================================
// Sub Projects
// =============================================================================

function SubProjectsTab() {
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

    const { data: subProjects = [], isLoading } = useQuery({
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
            message.error(err?.response?.data?.detail || 'Failed to create sub project.')
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
            message.error(err?.response?.data?.detail || 'Failed to update sub project.')
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
            message.error(err?.response?.data?.detail || 'Failed to delete sub project.')
            setDeletingSub(null)
        },
    })

    const handleOpenCreate = () => {
        setEditing(null)
        form.resetFields()
        setModalOpen(true)
    }

    const handleOpenEdit = (record) => {
        setEditing(record)
        form.setFieldsValue({
            customer_id: record.customer_id,
            project_id: record.project_id,
            name: record.name,
            description: record.description || '',
        })
        setModalOpen(true)
    }

    const handleSubmit = (values) => {
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
                    <Tooltip title="Edit">
                        <Button
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => handleOpenEdit(record)}
                        />
                    </Tooltip>
                    <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
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
            <div
                style={{
                    marginBottom: 12,
                    display: 'flex',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 8,
                }}
            >
                <Space wrap>
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
                <Button
                    type="primary"
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
                loading={isLoading}
                locale={{ emptyText: 'No sub-projects found.' }}
                pagination={{ pageSize: 20 }}
            />

            <Modal
                title={editing ? 'Edit Sub Project' : 'Create Sub Project'}
                open={modalOpen}
                onCancel={() => {
                    setModalOpen(false)
                    setEditing(null)
                }}
                onOk={() => form.submit()}
                okText={editing ? 'Save Changes' : 'Create Sub Project'}
                confirmLoading={createMutation.isPending || updateMutation.isPending}
                destroyOnClose
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
                            { required: true, message: 'Name is required.' },
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
                onConfirm={() =>
                    deletingSub && deleteMutation.mutate(deletingSub.id)
                }
                loading={deleteMutation.isPending}
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
        access: true,
        hierarchy: false,
        issueHierarchy: false,
        sub: false,
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
    const { data: effective = [] } = useQuery({
        queryKey: ['admin-task-permissions-effective'],
        queryFn: () => taskPermissionService.listEffective(),
    })

    const usersWithAccess = useMemo(
        () =>
            effective.filter(
                (r) =>
                    r.direct_can_access_tasks ||
                    (Array.isArray(r.group_grants_access) &&
                        r.group_grants_access.length > 0)
            ).length,
        [effective]
    )
    const rulesCount = userRelations.length + groupRelations.length
    const issueRulesCount =
        issueUserRelations.length + issueGroupRelations.length

    return (
        <div className="tm-page">
            <header className="tm-header">
                <h1 className="tm-title">PM Configurations</h1>
                <p className="tm-subtitle">
                    Manage access, assignment hierarchies, and sub-projects
                    for tasks, issues &amp; suggestions in one place.
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
                    icon={<KeyOutlined />}
                    label="Users with access"
                    value={usersWithAccess}
                    accent="#6366f1"
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
                icon={<SafetyCertificateOutlined />}
                title="Task Access"
                subtitle="Access & assign permissions for groups and ungrouped users"
                count={groups.length}
                accent="#388bff"
                open={open.access}
                onToggle={() => toggle('access')}
            >
                <TaskAccessByGroupTab />
            </Section>

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
        </div>
    )
}

export default TaskManagementPage
