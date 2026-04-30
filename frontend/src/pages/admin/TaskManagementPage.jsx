/**
 * =============================================================================
 * HERMES - Admin Task Management Page
 * =============================================================================
 * Tabs:
 *   1. Task Groups          — group-based permission management (primary).
 *   2. Direct User Overrides — flat per-user toggles (exception path).
 *   3. Assignment Hierarchy  — assigner -> assignees mappings.
 *   4. Sub Projects          — task-only sub projects under customer/project.
 *
 * Effective permission (computed in backend) is:
 *   admin OR direct toggle OR any active group membership grants true.
 *
 * User list is fetched directly from auth-service (/users/lookup) and
 * merged with permission / membership rows client-side.
 * =============================================================================
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
    Card,
    Tabs,
    Table,
    Switch,
    Tag,
    Button,
    Modal,
    Form,
    Select,
    Input,
    Space,
    message,
    Tooltip,
    Popconfirm,
} from 'antd'
import TaskGroupsTab from './TaskGroupsTab'
import {
    PlusOutlined,
    DeleteOutlined,
    EditOutlined,
    InboxOutlined,
    UndoOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
    authService,
    customerService,
    projectService,
    taskAssignmentService,
    taskPermissionService,
    taskSubProjectService,
} from '../../services/api'
import './TaskManagementPage.css'

// =============================================================================
// Shared user lookup (used by tabs 1 and 2)
// =============================================================================

function useAllUsers() {
    return useQuery({
        queryKey: ['auth-users-lookup', { include_inactive: true }],
        queryFn: () =>
            authService.lookupUsers({ include_inactive: true }),
        staleTime: 60 * 1000,
    })
}

// =============================================================================
// Tab 1 — Task Access
// =============================================================================

function TaskAccessTab() {
    const queryClient = useQueryClient()

    const { data: users = [], isLoading: usersLoading } = useAllUsers()
    const { data: permissionRows = [], isLoading: permsLoading } = useQuery({
        queryKey: ['admin-task-permissions'],
        queryFn: () => taskPermissionService.listAdminUsers(),
    })

    const permMap = useMemo(() => {
        const map = {}
        for (const row of permissionRows) {
            map[row.user_id] = row
        }
        return map
    }, [permissionRows])

    // Admins always have full task access. Auto-upsert their permission rows
    // so (a) the table reflects reality and (b) admins can be selected as
    // assigners in the Assignment Hierarchy tab without manual toggling.
    const adminsNeedingFix = useMemo(() => {
        return users.filter((u) => {
            if (!u.is_admin || !u.is_active) return false
            const p = permMap[u.id]
            return !p || !p.can_access_tasks || !p.can_assign_tasks
        })
    }, [users, permMap])

    const inFlightRef = useRef(new Set())

    useEffect(() => {
        if (adminsNeedingFix.length === 0) return
        const toFix = adminsNeedingFix.filter(
            (u) => !inFlightRef.current.has(u.id)
        )
        if (toFix.length === 0) return
        toFix.forEach((u) => inFlightRef.current.add(u.id))
        Promise.all(
            toFix.map((u) =>
                taskPermissionService
                    .updateUserPermission(u.id, {
                        can_access_tasks: true,
                        can_assign_tasks: true,
                    })
                    .finally(() => inFlightRef.current.delete(u.id))
            )
        )
            .then(() => {
                queryClient.invalidateQueries({
                    queryKey: ['admin-task-permissions'],
                })
                queryClient.invalidateQueries({ queryKey: ['task-permissions'] })
            })
            .catch(() => {
                /* swallow — table will retry next mount */
            })
    }, [adminsNeedingFix, queryClient])

    // Merge users (full list) with permission rows (sparse).
    // Admin rows are forced to true/true in the UI (auto-correction may
    // still be in flight; the toggles are locked anyway).
    const rows = useMemo(() => {
        return users.map((u) => {
            const perm = permMap[u.id]
            const isAdmin = !!u.is_admin
            return {
                user_id: u.id,
                full_name: u.full_name || u.email,
                email: u.email,
                role: u.role,
                is_admin: isAdmin,
                is_active: !!u.is_active,
                can_access_tasks: isAdmin ? true : !!perm?.can_access_tasks,
                can_assign_tasks: isAdmin ? true : !!perm?.can_assign_tasks,
                updated_at: perm?.updated_at || null,
            }
        })
    }, [users, permMap])

    const updateMutation = useMutation({
        mutationFn: ({ userId, data }) =>
            taskPermissionService.updateUserPermission(userId, data),
        onSuccess: () => {
            message.success('Task permissions updated.')
            queryClient.invalidateQueries({ queryKey: ['admin-task-permissions'] })
            queryClient.invalidateQueries({ queryKey: ['task-permissions'] })
            queryClient.invalidateQueries({
                queryKey: ['admin-task-assignment-relations'],
            })
        },
        onError: (err) => {
            message.error(
                err?.response?.data?.detail || 'Failed to update permissions.'
            )
        },
    })

    const handleToggle = (row, field, value) => {
        const next = {
            can_access_tasks:
                field === 'can_access_tasks' ? value : !!row.can_access_tasks,
            can_assign_tasks:
                field === 'can_assign_tasks' ? value : !!row.can_assign_tasks,
        }
        // Apply UX invariants client-side too (backend re-applies them).
        if (field === 'can_access_tasks' && !value) {
            next.can_assign_tasks = false
        }
        if (field === 'can_assign_tasks' && value) {
            next.can_access_tasks = true
        }
        updateMutation.mutate({ userId: row.user_id, data: next })
    }

    const columns = [
        {
            title: 'User',
            dataIndex: 'full_name',
            render: (val, row) => val || row.email || row.user_id,
        },
        { title: 'Email', dataIndex: 'email' },
        {
            title: 'Role',
            dataIndex: 'role',
            render: (val) => val || '—',
        },
        {
            title: 'Admin',
            dataIndex: 'is_admin',
            render: (val) => (val ? <Tag color="gold">Admin</Tag> : '—'),
        },
        {
            title: 'Active',
            dataIndex: 'is_active',
            render: (val) =>
                val ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>,
        },
        {
            title: 'Can Access Tasks',
            dataIndex: 'can_access_tasks',
            render: (val, row) => (
                <Tooltip
                    title={
                        row.is_admin
                            ? 'Admins always have task access (auto).'
                            : ''
                    }
                >
                    <Switch
                        checked={!!val}
                        disabled={
                            row.is_admin ||
                            !row.is_active ||
                            updateMutation.isPending
                        }
                        onChange={(checked) =>
                            handleToggle(row, 'can_access_tasks', checked)
                        }
                    />
                </Tooltip>
            ),
        },
        {
            title: 'Can Assign Tasks',
            dataIndex: 'can_assign_tasks',
            render: (val, row) => (
                <Tooltip
                    title={
                        row.is_admin
                            ? 'Admins always have assignment permission (auto).'
                            : ''
                    }
                >
                    <Switch
                        checked={!!val}
                        disabled={
                            row.is_admin ||
                            !row.is_active ||
                            updateMutation.isPending
                        }
                        onChange={(checked) =>
                            handleToggle(row, 'can_assign_tasks', checked)
                        }
                    />
                </Tooltip>
            ),
        },
    ]

    return (
        <Table
            rowKey="user_id"
            loading={usersLoading || permsLoading}
            columns={columns}
            dataSource={rows}
            pagination={{ pageSize: 20 }}
            locale={{ emptyText: 'No users found.' }}
        />
    )
}

// =============================================================================
// Tab 2 — Assignment Hierarchy
// =============================================================================

function AssignmentHierarchyTab() {
    const queryClient = useQueryClient()
    const [modalOpen, setModalOpen] = useState(false)
    const [form] = Form.useForm()

    // Watch the selected assigner so the assignees dropdown can exclude it.
    const watchedAssigner = Form.useWatch('assigner_user_id', form)

    const { data: users = [] } = useAllUsers()
    const { data: permissionRows = [] } = useQuery({
        queryKey: ['admin-task-permissions'],
        queryFn: () => taskPermissionService.listAdminUsers(),
    })
    const { data: relations = [], isLoading } = useQuery({
        queryKey: ['admin-task-assignment-relations'],
        queryFn: () => taskAssignmentService.list(),
    })

    const userMap = useMemo(() => {
        const map = {}
        for (const u of users) map[u.id] = u
        return map
    }, [users])

    const permMap = useMemo(() => {
        const map = {}
        for (const p of permissionRows) map[p.user_id] = p
        return map
    }, [permissionRows])

    const possibleAssigners = useMemo(
        () =>
            users.filter(
                (u) => u.is_active && !!permMap[u.id]?.can_assign_tasks
            ),
        [users, permMap]
    )
    const possibleAssignees = useMemo(
        () =>
            users.filter(
                (u) => u.is_active && !!permMap[u.id]?.can_access_tasks
            ),
        [users, permMap]
    )

    // Exclude the currently selected assigner from the assignee options so a
    // user cannot map themselves (also enforced server-side via the
    // chk_task_assignment_not_self constraint).
    const assigneeOptions = useMemo(
        () =>
            possibleAssignees
                .filter((u) => u.id !== watchedAssigner)
                .map((u) => ({
                    value: u.id,
                    label: u.full_name || u.email,
                })),
        [possibleAssignees, watchedAssigner]
    )

    // If the assigner changes after assignees were already picked, drop any
    // assignee that now equals the new assigner (auto-clean).
    const handleAssignerChange = (nextAssignerId) => {
        const current = form.getFieldValue('assignee_user_ids') || []
        const filtered = current.filter((id) => id !== nextAssignerId)
        if (filtered.length !== current.length) {
            form.setFieldValue('assignee_user_ids', filtered)
        }
    }

    const enrichedRelations = useMemo(
        () =>
            relations.map((r) => {
                const a = userMap[r.assigner_user_id] || {}
                const b = userMap[r.assignee_user_id] || {}
                return {
                    ...r,
                    assigner_label:
                        a.full_name || a.email || r.assigner_user_id,
                    assignee_label:
                        b.full_name || b.email || r.assignee_user_id,
                }
            }),
        [relations, userMap]
    )

    const createMutation = useMutation({
        mutationFn: (data) => taskAssignmentService.create(data),
        onSuccess: () => {
            message.success('Assignment mappings saved.')
            setModalOpen(false)
            form.resetFields()
            queryClient.invalidateQueries({
                queryKey: ['admin-task-assignment-relations'],
            })
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to save mappings.')
        },
    })

    const deleteMutation = useMutation({
        mutationFn: (id) => taskAssignmentService.delete(id),
        onSuccess: () => {
            message.success('Mapping removed.')
            queryClient.invalidateQueries({
                queryKey: ['admin-task-assignment-relations'],
            })
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to remove mapping.')
        },
    })

    const handleSubmit = (values) => {
        createMutation.mutate({
            assigner_user_id: values.assigner_user_id,
            assignee_user_ids: values.assignee_user_ids,
        })
    }

    const columns = [
        { title: 'Assigner', dataIndex: 'assigner_label' },
        { title: 'Assignee', dataIndex: 'assignee_label' },
        {
            title: 'Created',
            dataIndex: 'created_at',
            render: (val) => (val ? new Date(val).toLocaleString() : '—'),
        },
        {
            title: 'Actions',
            render: (_, record) => (
                <Popconfirm
                    title="Remove mapping?"
                    description="This prevents future assignment but does not delete existing tasks."
                    okText="Remove"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => deleteMutation.mutate(record.id)}
                >
                    <Button danger size="small" icon={<DeleteOutlined />}>
                        Remove
                    </Button>
                </Popconfirm>
            ),
        },
    ]

    return (
        <>
            <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => {
                        form.resetFields()
                        setModalOpen(true)
                    }}
                >
                    Add Assignment Mapping
                </Button>
            </div>
            <Table
                rowKey="id"
                columns={columns}
                dataSource={enrichedRelations}
                loading={isLoading}
                locale={{ emptyText: 'No assignment mappings found.' }}
                pagination={{ pageSize: 20 }}
            />

            <Modal
                title="Add Assignment Mapping"
                open={modalOpen}
                onCancel={() => setModalOpen(false)}
                onOk={() => form.submit()}
                okText="Save"
                confirmLoading={createMutation.isPending}
                destroyOnClose
            >
                <Form form={form} layout="vertical" onFinish={handleSubmit}>
                    <Form.Item
                        label="Assigner"
                        name="assigner_user_id"
                        rules={[{ required: true, message: 'Assigner is required.' }]}
                    >
                        <Select
                            showSearch
                            placeholder="Select assigner"
                            optionFilterProp="label"
                            onChange={handleAssignerChange}
                            options={possibleAssigners.map((u) => ({
                                value: u.id,
                                label: u.full_name || u.email,
                            }))}
                            notFoundContent={
                                possibleAssigners.length === 0
                                    ? 'No users with Can Assign Tasks enabled. Enable it in Task Access first.'
                                    : undefined
                            }
                        />
                    </Form.Item>
                    <Form.Item
                        label="Assignees"
                        name="assignee_user_ids"
                        rules={[
                            {
                                required: true,
                                message: 'Pick at least one assignee.',
                            },
                        ]}
                        extra={
                            watchedAssigner
                                ? 'The selected assigner is hidden from this list.'
                                : undefined
                        }
                    >
                        <Select
                            mode="multiple"
                            showSearch
                            placeholder="Select assignees"
                            optionFilterProp="label"
                            options={assigneeOptions}
                            notFoundContent={
                                possibleAssignees.length === 0
                                    ? 'No users with Can Access Tasks enabled. Enable it in Task Access first.'
                                    : assigneeOptions.length === 0
                                    ? 'No other users are available — assigner is excluded from this list.'
                                    : undefined
                            }
                        />
                    </Form.Item>
                </Form>
            </Modal>
        </>
    )
}

// =============================================================================
// Tab 3 — Sub Projects
// =============================================================================

function SubProjectsTab() {
    const queryClient = useQueryClient()
    const [filterCustomer, setFilterCustomer] = useState(null)
    const [filterProject, setFilterProject] = useState(null)
    const [includeInactive, setIncludeInactive] = useState(false)

    const [modalOpen, setModalOpen] = useState(false)
    const [editing, setEditing] = useState(null)
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
        queryKey: [
            'admin-task-sub-projects',
            filterCustomer,
            filterProject,
            includeInactive,
        ],
        queryFn: () =>
            taskSubProjectService.list({
                customer_id: filterCustomer || undefined,
                project_id: filterProject || undefined,
                include_inactive: includeInactive ? true : undefined,
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

    const archiveMutation = useMutation({
        mutationFn: (id) => taskSubProjectService.archive(id),
        onSuccess: () => {
            message.success('Sub project archived.')
            queryClient.invalidateQueries({ queryKey: ['admin-task-sub-projects'] })
            queryClient.invalidateQueries({ queryKey: ['task-sub-projects'] })
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to archive sub project.')
        },
    })

    const reactivateMutation = useMutation({
        mutationFn: (id) => taskSubProjectService.update(id, { is_active: true }),
        onSuccess: () => {
            message.success('Sub project reactivated.')
            queryClient.invalidateQueries({ queryKey: ['admin-task-sub-projects'] })
            queryClient.invalidateQueries({ queryKey: ['task-sub-projects'] })
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to reactivate sub project.')
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
            title: 'Active',
            dataIndex: 'is_active',
            render: (val) =>
                val ? <Tag color="green">Active</Tag> : <Tag>Archived</Tag>,
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
                    {record.is_active ? (
                        <Popconfirm
                            title="Archive sub project?"
                            description="It will not be selectable for new tasks. Existing tasks remain visible."
                            okText="Archive"
                            okButtonProps={{ danger: true }}
                            onConfirm={() => archiveMutation.mutate(record.id)}
                        >
                            <Button size="small" danger icon={<InboxOutlined />}>
                                Archive
                            </Button>
                        </Popconfirm>
                    ) : (
                        <Button
                            size="small"
                            icon={<UndoOutlined />}
                            onClick={() => reactivateMutation.mutate(record.id)}
                        >
                            Reactivate
                        </Button>
                    )}
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
                    <Switch
                        checked={includeInactive}
                        onChange={setIncludeInactive}
                        checkedChildren="With archived"
                        unCheckedChildren="Active only"
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
        </>
    )
}

// =============================================================================
// Page
// =============================================================================

function TaskManagementPage() {
    return (
        <div style={{ padding: 24 }}>
            <Card
                title="Task Management"
                className="task-mgmt-card"
                style={{ background: '#161616', borderColor: '#303030' }}
            >
                <Tabs
                    className="task-mgmt-tabs"
                    items={[
                        {
                            key: 'groups',
                            label: 'Task Groups',
                            children: <TaskGroupsTab />,
                        },
                        {
                            key: 'direct',
                            label: 'Direct User Overrides',
                            children: <TaskAccessTab />,
                        },
                        {
                            key: 'hierarchy',
                            label: 'Assignment Hierarchy',
                            children: <AssignmentHierarchyTab />,
                        },
                        {
                            key: 'sub-projects',
                            label: 'Sub Projects',
                            children: <SubProjectsTab />,
                        },
                    ]}
                />
            </Card>
        </div>
    )
}

export default TaskManagementPage
