/**
 * =============================================================================
 * HERMES - Admin Task Management Page
 * =============================================================================
 * Three tabs:
 *   1. Task Access — toggle can_access_tasks / can_assign_tasks per user.
 *   2. Assignment Hierarchy — assigner -> assignees mappings.
 *   3. Sub Projects — task-only sub projects under existing customer/project.
 * =============================================================================
 */

import { useMemo, useState } from 'react'
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
import {
    PlusOutlined,
    DeleteOutlined,
    EditOutlined,
    InboxOutlined,
    UndoOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
    customerService,
    projectService,
    taskAssignmentService,
    taskPermissionService,
    taskSubProjectService,
} from '../../services/api'

// =============================================================================
// Tab 1 — Task Access
// =============================================================================

function TaskAccessTab() {
    const queryClient = useQueryClient()

    const { data: rows = [], isLoading } = useQuery({
        queryKey: ['admin-task-permissions'],
        queryFn: () => taskPermissionService.listAdminUsers(),
    })

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
            render: (val) => (val ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>),
        },
        {
            title: 'Can Access Tasks',
            dataIndex: 'can_access_tasks',
            render: (val, row) => (
                <Switch
                    checked={!!val}
                    disabled={!row.is_active || updateMutation.isPending}
                    onChange={(checked) => handleToggle(row, 'can_access_tasks', checked)}
                />
            ),
        },
        {
            title: 'Can Assign Tasks',
            dataIndex: 'can_assign_tasks',
            render: (val, row) => (
                <Switch
                    checked={!!val}
                    disabled={!row.is_active || updateMutation.isPending}
                    onChange={(checked) => handleToggle(row, 'can_assign_tasks', checked)}
                />
            ),
        },
    ]

    return (
        <Table
            rowKey="user_id"
            loading={isLoading}
            columns={columns}
            dataSource={rows}
            pagination={{ pageSize: 20 }}
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

    const { data: relations = [], isLoading } = useQuery({
        queryKey: ['admin-task-assignment-relations'],
        queryFn: () => taskAssignmentService.list(),
    })

    const { data: permissionRows = [] } = useQuery({
        queryKey: ['admin-task-permissions'],
        queryFn: () => taskPermissionService.listAdminUsers(),
    })

    const possibleAssigners = useMemo(
        () => permissionRows.filter((r) => r.is_active && (r.is_admin || r.can_assign_tasks)),
        [permissionRows]
    )
    const possibleAssignees = useMemo(
        () => permissionRows.filter((r) => r.is_active && r.can_access_tasks),
        [permissionRows]
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
        {
            title: 'Assigner',
            dataIndex: ['assigner_user', 'full_name'],
            render: (_, record) =>
                record.assigner_user?.full_name ||
                record.assigner_user?.email ||
                record.assigner_user?.id,
        },
        {
            title: 'Assignee',
            dataIndex: ['assignee_user', 'full_name'],
            render: (_, record) =>
                record.assignee_user?.full_name ||
                record.assignee_user?.email ||
                record.assignee_user?.id,
        },
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
                dataSource={relations}
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
                            options={possibleAssigners.map((u) => ({
                                value: u.user_id,
                                label: u.full_name || u.email,
                            }))}
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
                    >
                        <Select
                            mode="multiple"
                            showSearch
                            placeholder="Select assignees"
                            optionFilterProp="label"
                            options={possibleAssignees.map((u) => ({
                                value: u.user_id,
                                label: u.full_name || u.email,
                            }))}
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
            queryClient.invalidateQueries({
                queryKey: ['admin-task-sub-projects'],
            })
            queryClient.invalidateQueries({ queryKey: ['task-sub-projects'] })
        },
        onError: (err) => {
            message.error(
                err?.response?.data?.detail || 'Failed to create sub project.'
            )
        },
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => taskSubProjectService.update(id, data),
        onSuccess: () => {
            message.success('Sub project updated.')
            setModalOpen(false)
            setEditing(null)
            form.resetFields()
            queryClient.invalidateQueries({
                queryKey: ['admin-task-sub-projects'],
            })
            queryClient.invalidateQueries({ queryKey: ['task-sub-projects'] })
        },
        onError: (err) => {
            message.error(
                err?.response?.data?.detail || 'Failed to update sub project.'
            )
        },
    })

    const archiveMutation = useMutation({
        mutationFn: (id) => taskSubProjectService.archive(id),
        onSuccess: () => {
            message.success('Sub project archived.')
            queryClient.invalidateQueries({
                queryKey: ['admin-task-sub-projects'],
            })
            queryClient.invalidateQueries({ queryKey: ['task-sub-projects'] })
        },
        onError: (err) => {
            message.error(
                err?.response?.data?.detail || 'Failed to archive sub project.'
            )
        },
    })

    const reactivateMutation = useMutation({
        mutationFn: (id) =>
            taskSubProjectService.update(id, { is_active: true }),
        onSuccess: () => {
            message.success('Sub project reactivated.')
            queryClient.invalidateQueries({
                queryKey: ['admin-task-sub-projects'],
            })
            queryClient.invalidateQueries({ queryKey: ['task-sub-projects'] })
        },
        onError: (err) => {
            message.error(
                err?.response?.data?.detail || 'Failed to reactivate sub project.'
            )
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
                confirmLoading={
                    createMutation.isPending || updateMutation.isPending
                }
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
                style={{ background: '#161616', borderColor: '#303030' }}
            >
                <Tabs
                    items={[
                        { key: 'access', label: 'Task Access', children: <TaskAccessTab /> },
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
