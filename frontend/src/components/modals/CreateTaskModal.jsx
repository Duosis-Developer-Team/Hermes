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

import HoursMinutesPicker from '../common/HoursMinutesPicker'
import {
    authService,
    customerService,
    projectService,
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

    const assigneeOptions = useMemo(() => {
        const list = isAdmin ? allActiveUsers : mappedUsers
        return list.map((u) => ({
            value: u.id,
            label: u.full_name || u.email,
        }))
    }, [isAdmin, allActiveUsers, mappedUsers])

    useEffect(() => {
        if (!open) return
        if (editingTask) {
            form.setFieldsValue({
                customer_id: editingTask.customer_id,
                project_id: editingTask.project_id,
                sub_project_id: editingTask.sub_project_id || undefined,
                assignee_user_id: editingTask.assignee_user_id,
                title: editingTask.title,
                description: editingTask.description || '',
                scheduled_date: editingTask.scheduled_date
                    ? dayjs(editingTask.scheduled_date)
                    : null,
                due_date: editingTask.due_date ? dayjs(editingTask.due_date) : null,
                duration_hours_decimal: editingTask.estimated_duration_minutes
                    ? editingTask.estimated_duration_minutes / 60
                    : 0,
                priority: editingTask.priority || 'medium',
            })
        } else {
            form.resetFields()
            const baseValues = { priority: 'medium', duration_hours_decimal: 0 }
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
        const decimalHours = parseFloat(values.duration_hours_decimal) || 0
        const minutes = Math.round(decimalHours * 60)
        const payload = {
            customer_id: values.customer_id,
            project_id: values.project_id,
            sub_project_id: subProjectId,
            assignee_user_id: values.assignee_user_id,
            title: values.title?.trim(),
            description,
            scheduled_date: scheduled,
            due_date: due,
            estimated_duration_minutes: minutes > 0 ? minutes : null,
            priority: values.priority || 'medium',
        }
        // For edits, signal explicit clear if user removed the sub project.
        if (isEditing) {
            payload.clear_sub_project =
                !!editingTask.sub_project_id && !subProjectId
        }
        await onSubmit(payload, editingTask?.id)
    }

    const noAssignableUsers = assigneeOptions.length === 0

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
                    name="assignee_user_id"
                    rules={[{ required: true, message: 'Assignee is required.' }]}
                >
                    <Select
                        showSearch
                        placeholder={
                            noAssignableUsers
                                ? 'No assignable users'
                                : 'Select assignee'
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

                <Space size="middle" style={{ display: 'flex' }}>
                    <Form.Item
                        label="Estimated Duration"
                        name="duration_hours_decimal"
                        style={{ flex: 1 }}
                        extra="Minutes step 15. Same input as Time Entry."
                    >
                        <HoursMinutesPicker />
                    </Form.Item>

                    <Form.Item
                        label="Priority"
                        name="priority"
                        rules={[{ required: true }]}
                        style={{ flex: 1 }}
                    >
                        <Select options={PRIORITY_OPTIONS} />
                    </Form.Item>
                </Space>
            </Form>
        </Modal>
    )
}

export default CreateTaskModal
