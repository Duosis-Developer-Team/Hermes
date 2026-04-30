/**
 * =============================================================================
 * HERMES - Create / Edit Task Modal
 * =============================================================================
 * Mirrors Hermes Ant Design modal style. Reuses customer/project selectors
 * from existing core API and the task-only sub-projects API.
 *
 * - Sub Project is OPTIONAL (task can be created directly under a project).
 * - Admin sees all active users in the assignee dropdown (fetched from
 *   auth-service /users/lookup directly).
 * - Non-admin assigner sees only mapped assignee IDs from
 *   /tasks/permissions/me, resolved to names via the same auth lookup.
 * =============================================================================
 */

import { useEffect, useMemo } from 'react'
import {
    Modal,
    Form,
    Input,
    Select,
    DatePicker,
    Alert,
    Space,
} from 'antd'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'

import {
    authService,
    customerService,
    projectService,
    taskService,
    taskSubProjectService,
} from '../../services/api'

const PRIORITY_OPTIONS = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'urgent', label: 'Urgent' },
]

function CreateTaskModal({
    open,
    onClose,
    onSubmit,
    initialDate,
    editingTask = null,
    assignableUserIds = [],
    isAdmin = false,
    loading = false,
}) {
    // Form value for assignee is a prefixed string:
    //   "user:<uuid>"  → single-user task
    //   "group:<uuid>" → fan-out per active group member (only on create)
    // Edit mode is single-user only (each task row is per assignee).
    const [form] = Form.useForm()
    const isEditing = !!editingTask

    const customerId = Form.useWatch('customer_id', form)
    const projectId = Form.useWatch('project_id', form)

    const { data: customers = [] } = useQuery({
        queryKey: ['customers'],
        queryFn: () => customerService.getAll(),
        enabled: open,
    })

    const { data: projects = [] } = useQuery({
        queryKey: ['projects'],
        queryFn: () => projectService.getAll(),
        enabled: open,
    })

    const filteredProjects = useMemo(() => {
        if (!customerId) return []
        return projects.filter((p) => p.customer_id === customerId)
    }, [projects, customerId])

    const { data: subProjects = [], isFetching: subProjectsLoading } = useQuery({
        queryKey: ['task-sub-projects', customerId, projectId],
        queryFn: () =>
            taskSubProjectService.list({
                customer_id: customerId,
                project_id: projectId,
            }),
        enabled: open && !!customerId && !!projectId,
    })

    // Resolve assignee user list:
    // - Admin: fetch all active users directly from auth-service.
    // - Non-admin: backend gave us assignable user IDs; resolve names via lookup.
    const { data: allActiveUsers = [] } = useQuery({
        queryKey: ['auth-users-lookup', { include_inactive: false }],
        queryFn: () => authService.lookupUsers(),
        enabled: open && isAdmin,
        staleTime: 60 * 1000,
    })

    const { data: mappedUsers = [] } = useQuery({
        queryKey: ['auth-users-lookup', { ids: assignableUserIds }],
        queryFn: () => authService.lookupUsers({ ids: assignableUserIds }),
        enabled: open && !isAdmin && assignableUserIds.length > 0,
        staleTime: 60 * 1000,
    })

    const { data: assignableGroups = [] } = useQuery({
        queryKey: ['tasks-assignable-groups'],
        queryFn: () => taskService.listAssignableGroups(),
        enabled: open,
        staleTime: 60 * 1000,
    })

    // Build the grouped option list for the assignee dropdown.
    // - Edit mode: single-user only (no group rows).
    // - Create mode: Groups section (if any) + Users section.
    const assigneeOptions = useMemo(() => {
        const userList = isAdmin ? allActiveUsers : mappedUsers
        const userOptions = userList.map((u) => ({
            value: `user:${u.id}`,
            label: u.full_name || u.email,
        }))
        if (editingTask) {
            return userOptions
        }
        if (assignableGroups.length === 0) {
            return userOptions
        }
        return [
            {
                label: 'Groups',
                options: assignableGroups.map((g) => ({
                    value: `group:${g.id}`,
                    label: `${g.name} (${g.member_count} member${
                        g.member_count === 1 ? '' : 's'
                    })`,
                })),
            },
            {
                label: 'Users',
                options: userOptions,
            },
        ]
    }, [isAdmin, allActiveUsers, mappedUsers, assignableGroups, editingTask])

    useEffect(() => {
        if (!open) return
        if (editingTask) {
            form.setFieldsValue({
                customer_id: editingTask.customer_id,
                project_id: editingTask.project_id,
                sub_project_id: editingTask.sub_project_id || undefined,
                assignee: `user:${editingTask.assignee_user_id}`,
                title: editingTask.title,
                description: editingTask.description || '',
                scheduled_date: editingTask.scheduled_date
                    ? dayjs(editingTask.scheduled_date)
                    : null,
                due_date: editingTask.due_date ? dayjs(editingTask.due_date) : null,
                priority: editingTask.priority || 'medium',
            })
        } else {
            form.resetFields()
            const baseValues = { priority: 'medium' }
            if (initialDate) {
                form.setFieldsValue({ ...baseValues, scheduled_date: dayjs(initialDate) })
            } else {
                form.setFieldsValue(baseValues)
            }
        }
    }, [open, editingTask, initialDate, form])

    const handleCustomerChange = () => {
        form.setFieldsValue({ project_id: undefined, sub_project_id: undefined })
    }

    const handleProjectChange = () => {
        form.setFieldsValue({ sub_project_id: undefined })
    }

    const handleFinish = async (values) => {
        const scheduled = values.scheduled_date?.format('YYYY-MM-DD')
        const due = values.due_date ? values.due_date.format('YYYY-MM-DD') : null
        if (due && scheduled && due < scheduled) {
            form.setFields([
                {
                    name: 'due_date',
                    errors: ['Due date cannot be before the scheduled date.'],
                },
            ])
            return
        }
        const subProjectId = values.sub_project_id || null
        const description = (values.description || '').trim()
        if (!description) {
            form.setFields([
                { name: 'description', errors: ['Description is required.'] },
            ])
            return
        }
        const assigneeRaw = values.assignee || ''
        const [assigneeKind, assigneeId] = assigneeRaw.includes(':')
            ? assigneeRaw.split(':')
            : ['user', assigneeRaw]

        const basePayload = {
            customer_id: values.customer_id,
            project_id: values.project_id,
            sub_project_id: subProjectId,
            title: values.title?.trim(),
            description,
            scheduled_date: scheduled,
            due_date: due,
            priority: values.priority || 'medium',
        }

        if (assigneeKind === 'group' && !isEditing) {
            // Group assignee: backend fans the task out to one row per
            // active member via POST /tasks/group.
            await onSubmit(
                { ...basePayload, assignee_group_id: assigneeId },
                { isGroup: true }
            )
            return
        }

        const payload = { ...basePayload, assignee_user_id: assigneeId }
        if (isEditing) {
            payload.clear_sub_project =
                !!editingTask.sub_project_id && !subProjectId
        }
        await onSubmit(payload, { taskId: editingTask?.id })
    }

    // Assignee dropdown is empty when there are no users AND no groups
    // available — applies in either flat or grouped option shape.
    const noAssignableUsers = useMemo(() => {
        if (!assigneeOptions || assigneeOptions.length === 0) return true
        return assigneeOptions.every((opt) =>
            Array.isArray(opt.options) ? opt.options.length === 0 : false
        ) && !assigneeOptions.some((opt) => !Array.isArray(opt.options))
    }, [assigneeOptions])

    return (
        <Modal
            title={isEditing ? 'Edit Task' : 'Create Task'}
            open={open}
            onCancel={onClose}
            okText={isEditing ? 'Save Changes' : 'Create Task'}
            cancelText="Cancel"
            confirmLoading={loading}
            onOk={() => form.submit()}
            width={640}
            destroyOnClose
        >
            <Form
                form={form}
                layout="vertical"
                requiredMark
                onFinish={handleFinish}
                initialValues={{ priority: 'medium' }}
            >
                {!isEditing && noAssignableUsers && !isAdmin && (
                    <Alert
                        type="warning"
                        message="No assignable users are available. Please contact an administrator."
                        showIcon
                        style={{ marginBottom: 16 }}
                    />
                )}

                <Form.Item
                    label="Customer"
                    name="customer_id"
                    rules={[{ required: true, message: 'Customer is required.' }]}
                >
                    <Select
                        showSearch
                        placeholder="Select customer"
                        onChange={handleCustomerChange}
                        optionFilterProp="label"
                        options={customers.map((c) => ({ value: c.id, label: c.name }))}
                    />
                </Form.Item>

                <Form.Item
                    label="Project"
                    name="project_id"
                    rules={[{ required: true, message: 'Project is required.' }]}
                >
                    <Select
                        showSearch
                        placeholder={
                            customerId ? 'Select project' : 'Select a customer first'
                        }
                        disabled={!customerId}
                        onChange={handleProjectChange}
                        optionFilterProp="label"
                        options={filteredProjects.map((p) => ({
                            value: p.id,
                            label: p.name,
                        }))}
                    />
                </Form.Item>

                <Form.Item
                    label="Sub Project"
                    name="sub_project_id"
                    extra="Optional — leave empty to create the task directly under the project."
                >
                    <Select
                        allowClear
                        showSearch
                        placeholder={
                            projectId
                                ? 'Select sub project (optional)'
                                : 'Select a project first'
                        }
                        disabled={!projectId}
                        loading={subProjectsLoading}
                        optionFilterProp="label"
                        options={subProjects.map((s) => ({ value: s.id, label: s.name }))}
                    />
                </Form.Item>

                <Form.Item
                    label="Assignee"
                    name="assignee"
                    rules={[{ required: true, message: 'Assignee is required.' }]}
                    extra={
                        !isEditing && assignableGroups.length > 0
                            ? 'Picking a group creates one task per active group member.'
                            : undefined
                    }
                >
                    <Select
                        showSearch
                        placeholder={
                            noAssignableUsers
                                ? 'No assignable users'
                                : 'Select user or group'
                        }
                        disabled={noAssignableUsers}
                        optionFilterProp="label"
                        options={assigneeOptions}
                    />
                </Form.Item>

                <Form.Item
                    label="Task Title"
                    name="title"
                    rules={[
                        { required: true, message: 'Task title is required.' },
                        { max: 255, message: 'Max 255 characters.' },
                    ]}
                >
                    <Input maxLength={255} placeholder="Short, action-oriented task title" />
                </Form.Item>

                <Form.Item
                    label="Description"
                    name="description"
                    rules={[
                        { required: true, message: 'Description is required.' },
                        {
                            validator: (_, value) =>
                                !value || value.trim().length > 0
                                    ? Promise.resolve()
                                    : Promise.reject(
                                          new Error('Description is required.')
                                      ),
                        },
                    ]}
                >
                    <Input.TextArea
                        rows={4}
                        placeholder="Task instructions and context for the assignee"
                    />
                </Form.Item>

                <Space size="middle" style={{ display: 'flex' }}>
                    <Form.Item
                        label="Scheduled Date"
                        name="scheduled_date"
                        rules={[
                            { required: true, message: 'Scheduled date is required.' },
                        ]}
                        style={{ flex: 1 }}
                    >
                        <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
                    </Form.Item>

                    <Form.Item label="Due Date" name="due_date" style={{ flex: 1 }}>
                        <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
                    </Form.Item>
                </Space>

                <Form.Item
                    label="Priority"
                    name="priority"
                    rules={[{ required: true }]}
                >
                    <Select options={PRIORITY_OPTIONS} />
                </Form.Item>
            </Form>
        </Modal>
    )
}

export default CreateTaskModal
