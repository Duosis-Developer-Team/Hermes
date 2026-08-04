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

import { useEffect, useMemo, useState } from 'react'
import {
    Modal,
    Form,
    Input,
    Select,
    DatePicker,
    Alert,
    Space,
    Button,
    Divider,
    message,
} from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
    // Work item kind being created: task | issue | suggestion. Same form
    // for all three — only the title label + stored type differ.
    taskType = 'task',
    assignableUserIds = [],
    loading = false,
}) {
    const TYPE_LABEL = { task: 'Task', issue: 'Issue', suggestion: 'Suggestion' }
    const typeLabel = TYPE_LABEL[taskType] || 'Task'
    // Form value for assignee is a prefixed string:
    //   "user:<uuid>"  → single-user task
    //   "group:<uuid>" → fan-out per active group member (only on create)
    // Edit mode is single-user only (each task row is per assignee).
    const [form] = Form.useForm()
    const queryClient = useQueryClient()
    const isEditing = !!editingTask

    // Inline "create sub project" — name typed inside the Sub Project
    // dropdown footer. Lets an assigner add a missing sub project without
    // an admin round-trip; the customer/project are taken from the form.
    const [newSubName, setNewSubName] = useState('')

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

    const createSubMutation = useMutation({
        mutationFn: (name) =>
            taskSubProjectService.createInline({
                customer_id: customerId,
                project_id: projectId,
                name,
            }),
        onSuccess: (created) => {
            message.success('Sub project created.')
            setNewSubName('')
            // Synchronously add it to THIS query's cache so the option
            // exists immediately — otherwise the auto-select below points
            // at an id not yet in the (stale) options list until a refetch.
            if (created?.id) {
                queryClient.setQueryData(
                    ['task-sub-projects', customerId, projectId],
                    (old) =>
                        Array.isArray(old) ? [...old, created] : [created]
                )
            }
            // Keep other consumers (admin list) fresh.
            queryClient.invalidateQueries({
                queryKey: ['admin-task-sub-projects'],
            })
            // Auto-select the freshly created sub project on the task.
            if (created?.id) {
                form.setFieldsValue({ sub_project_id: created.id })
            }
        },
        onError: (err) => {
            message.error(
                err?.response?.data?.detail || 'Failed to create sub project.'
            )
        },
    })

    const handleAddSubProject = () => {
        const name = newSubName.trim()
        if (!name || !customerId || !projectId || createSubMutation.isPending) {
            return
        }
        createSubMutation.mutate(name)
    }

    // Resolve assignee user list:
    // - Admin: fetch all active users directly from auth-service.
    // - Non-admin: backend gave us assignable user IDs; resolve names via lookup.
    // Assignee options are hierarchy-driven for EVERYONE (admins included):
    // resolve names for the user IDs mapped to the caller in this scope. In
    // edit mode, also include the task's current assignee so its name shows
    // even if it now sits outside the caller's mappings.
    const lookupUserIds = useMemo(() => {
        const ids = new Set((assignableUserIds || []).map(String))
        if (editingTask?.assignee_user_id) {
            ids.add(String(editingTask.assignee_user_id))
        }
        return Array.from(ids)
    }, [assignableUserIds, editingTask])

    const { data: mappedUsers = [] } = useQuery({
        queryKey: ['auth-users-lookup', { ids: lookupUserIds }],
        queryFn: () => authService.lookupUsers({ ids: lookupUserIds }),
        enabled: open && lookupUserIds.length > 0,
        staleTime: 60 * 1000,
    })

    // Issues + suggestions share the 'issue' assignment scope.
    const permScope = taskType === 'task' ? 'task' : 'issue'
    const { data: assignableGroups = [] } = useQuery({
        queryKey: ['tasks-assignable-groups', permScope],
        queryFn: () => taskService.listAssignableGroups(permScope),
        enabled: open,
        staleTime: 60 * 1000,
    })

    // Build the grouped option list for the assignee dropdown.
    // - Edit mode: single-user only (no group rows).
    // - Create mode: Groups section (if any) + Users section.
    const assigneeOptions = useMemo(() => {
        const userOptions = mappedUsers.map((u) => ({
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
    }, [mappedUsers, assignableGroups, editingTask])

    useEffect(() => {
        // Clear the inline "new sub project" draft whenever the modal
        // opens/closes so it never leaks across tasks.
        setNewSubName('')
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
            // Scheduled date defaults to the given day, or today when the
            // modal is opened without one (the board "+ New Task" button).
            // Due date stays empty for the user to choose.
            form.setFieldsValue({
                priority: 'medium',
                scheduled_date: initialDate ? dayjs(initialDate) : dayjs(),
            })
        }
    }, [open, editingTask, initialDate, form])

    const handleCustomerChange = () => {
        form.setFieldsValue({ project_id: undefined, sub_project_id: undefined })
    }

    const handleProjectChange = () => {
        form.setFieldsValue({ sub_project_id: undefined })
    }

    const handleFinish = async (values) => {
        // Cift gonderim kilidi KAYNAKTA: OK butonunun loading durumu bir
        // render gecikmesiyle olusuyor ve o pencerede ikinci tiklama
        // ikinci mutation aciyordu. Guard'i form seviyesine almak yarisi
        // tamamen kapatir.
        if (loading) return
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
        const basePayload = {
            customer_id: values.customer_id,
            project_id: values.project_id,
            sub_project_id: subProjectId,
            title: values.title?.trim(),
            description,
            scheduled_date: scheduled,
            due_date: due,
            priority: values.priority || 'medium',
            task_type: taskType,
        }

        // Edit mode: a single task row, single-select assignee (string).
        if (isEditing) {
            const raw = values.assignee || ''
            const assigneeId = raw.includes(':') ? raw.split(':')[1] : raw
            await onSubmit(
                {
                    ...basePayload,
                    assignee_user_id: assigneeId,
                    clear_sub_project:
                        !!editingTask.sub_project_id && !subProjectId,
                },
                { taskId: editingTask.id }
            )
            return
        }

        // Create mode: multi-select — assignee is an array of
        // "user:<id>" / "group:<id>" tokens. Split them and let the bulk
        // endpoint create one task per person (groups expanded to members,
        // assigner excluded, duplicates collapsed).
        const selected = Array.isArray(values.assignee)
            ? values.assignee
            : values.assignee
            ? [values.assignee]
            : []
        const assigneeUserIds = []
        const assigneeGroupIds = []
        for (const v of selected) {
            const [kind, id] = v.includes(':') ? v.split(':') : ['user', v]
            if (kind === 'group') assigneeGroupIds.push(id)
            else assigneeUserIds.push(id)
        }
        await onSubmit(
            {
                ...basePayload,
                assignee_user_ids: assigneeUserIds,
                assignee_group_ids: assigneeGroupIds,
            },
            { isBulk: true }
        )
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
            title={isEditing ? `Edit ${typeLabel}` : `Create ${typeLabel}`}
            open={open}
            onCancel={onClose}
            okText={isEditing ? 'Save Changes' : `Create ${typeLabel}`}
            cancelText="Cancel"
            confirmLoading={loading}
            onOk={() => form.submit()}
            width={880}
            /* Pending'te kapanma kilidi (§7): kayit sunucuya giderken
               mask/Escape/X ile cikip yarim durum birakilamaz. */
            closable={!loading}
            maskClosable={!loading}
            keyboard={!loading}
            /* AntD 5.x: destroyOnClose deprecated → destroyOnHidden.
               Eski ad her render'da console.error uretiyordu. */
            destroyOnHidden
        >
            <Form
                form={form}
                layout="vertical"
                requiredMark
                onFinish={handleFinish}
                initialValues={{ priority: 'medium' }}
            >
                {!isEditing && noAssignableUsers && (
                    <Alert
                        type="warning"
                        message={`No assignable targets for ${typeLabel.toLowerCase()}s. Add them to your assignment hierarchy in PM Configurations (or ask an administrator).`}
                        showIcon
                        style={{ marginBottom: 16 }}
                    />
                )}

                {/* Customer | Project: eslenmis satir (bkz. .h-modal-row) */}
                <div className="h-modal-row">
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

                </div>

                {/* Sub Project | Assignees */}
                <div className="h-modal-row">
                <Form.Item
                    label="Sub Project"
                    name="sub_project_id"
                    extra={`Optional — leave empty to create the ${typeLabel.toLowerCase()} directly under the project.`}
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
                        /* AntD 5.x: dropdownRender deprecated → popupRender. */
                        popupRender={(menu) => (
                            <>
                                {menu}
                                <Divider style={{ margin: '8px 0' }} />
                                <Space.Compact
                                    style={{ display: 'flex', padding: '0 8px 4px' }}
                                >
                                    <Input
                                        size="small"
                                        placeholder="New sub project name"
                                        value={newSubName}
                                        maxLength={255}
                                        onChange={(e) => setNewSubName(e.target.value)}
                                        // Keep keystrokes (incl. Enter/space) from
                                        // reaching the Select's own search/keyboard
                                        // handling while typing the new name.
                                        onKeyDown={(e) => {
                                            e.stopPropagation()
                                            if (e.key === 'Enter') {
                                                e.preventDefault()
                                                handleAddSubProject()
                                            }
                                        }}
                                    />
                                    <Button
                                        size="small"
                                        type="primary"
                                        icon={<PlusOutlined />}
                                        loading={createSubMutation.isPending}
                                        disabled={
                                            !newSubName.trim() ||
                                            createSubMutation.isPending
                                        }
                                        onClick={handleAddSubProject}
                                    >
                                        Add
                                    </Button>
                                </Space.Compact>
                            </>
                        )}
                    />
                </Form.Item>

                <Form.Item
                    label={isEditing ? 'Assignee' : 'Assignees'}
                    name="assignee"
                    rules={[
                        {
                            required: true,
                            message: 'Pick at least one assignee.',
                        },
                    ]}
                >
                    <Select
                        mode={isEditing ? undefined : 'multiple'}
                        showSearch
                        allowClear={!isEditing}
                        maxTagCount="responsive"
                        placeholder={
                            noAssignableUsers
                                ? 'No assignable users'
                                : isEditing
                                ? 'Select user'
                                : 'Select users or groups'
                        }
                        disabled={noAssignableUsers}
                        optionFilterProp="label"
                        options={assigneeOptions}
                    />
                </Form.Item>

                </div>

                <Form.Item
                    label={`${typeLabel} Title`}
                    name="title"
                    rules={[
                        {
                            required: true,
                            // Yalnizca bosluk = BOS. required tek basina
                            // "   " degerini gecerli sayiyor, payload'a
                            // trim'lenmis bos baslik gidiyordu.
                            whitespace: true,
                            message: `${typeLabel} title is required.`,
                        },
                        { max: 255, message: 'Max 255 characters.' },
                    ]}
                >
                    <Input
                        maxLength={255}
                        placeholder={`Short, action-oriented ${typeLabel.toLowerCase()} title`}
                    />
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
                        rows={3}
                        placeholder={`${typeLabel} instructions and context for the assignee`}
                    />
                </Form.Item>

                {/* wrap: on narrow phones the two date pickers stack
                    instead of overflowing; no effect on desktop where
                    both fit side by side. */}
                <div className="h-modal-row h-modal-row--3">
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

                    <Form.Item
                        label="Priority"
                        name="priority"
                        rules={[{ required: true }]}
                    >
                        <Select options={PRIORITY_OPTIONS} />
                    </Form.Item>
                </div>
            </Form>
        </Modal>
    )
}

export default CreateTaskModal
