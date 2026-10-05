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
    Switch,
} from 'antd'
import {
    BugOutlined, BulbOutlined, CheckSquareOutlined, PlusOutlined,
} from '@ant-design/icons'
import { ChipGroup, FormSection, ModalHead } from '../liquid'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'

import {
    authService,
    customerService,
    projectService,
    taskService,
    taskSubProjectService,
} from '../../services/api'
import { useT } from '../../i18n'
import { customerSelectRender, projectSelectRender } from '../../components/common/customerSelect'
import { selectFilter } from '../../utils/searchText'

// Oncelik listesi MODUL duzeyindeydi; ceviri bir hook'a bagli oldugu
// icin artik bilesen icinde uretilir. Degerler (low/medium/...) API
// sozlesmesidir ve CEVRILMEZ — yalnizca etiket cevrilir.
const PRIORITY_VALUES = ['low', 'medium', 'high', 'urgent']

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
    const t = useT()
    const priorityOptions = PRIORITY_VALUES.map((value) => ({
        value, label: t(`task.${value}`),
    }))
    const kind = ['task', 'issue', 'suggestion'].includes(taskType) ? taskType : 'task'
    const TYPE_HEAD = {
        task: { icon: <CheckSquareOutlined />, tone: 'blue' },
        issue: { icon: <BugOutlined />, tone: 'red' },
        suggestion: { icon: <BulbOutlined />, tone: 'amber' },
    }
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
            message.success(t('task.subProjectCreated'))
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
                label: t('task.groups'),
                options: assignableGroups.map((g) => ({
                    value: `group:${g.id}`,
                    label: `${g.name} (${g.member_count} member${
                        g.member_count === 1 ? '' : 's'
                    })`,
                })),
            },
            {
                label: t('task.users'),
                options: userOptions,
            },
        ]
    }, [mappedUsers, assignableGroups, editingTask, t])

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
                // A8: faturalanabilirlik (proje varsayilanindan miras; burada ezilir)
                is_billable: editingTask.is_billable !== false,
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
                    // A8: yalniz degistiyse gonderilir (override izi bosuna yazilmasin)
                    ...(typeof values.is_billable === 'boolean'
                        && values.is_billable !== (editingTask.is_billable !== false)
                        ? { is_billable: values.is_billable }
                        : {}),
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

    const customerName = customers.find((c) => c.id === customerId)?.name
    const projectName = filteredProjects.find((p) => p.id === projectId)?.name
    const headSub = customerName && projectName
        ? t('taskModal.addsTo', { where: `${customerName} · ${projectName}` })
        : t('taskModal.pickWhere')

    return (
        <Modal
            title={(
                <ModalHead
                    icon={TYPE_HEAD[kind].icon}
                    tone={TYPE_HEAD[kind].tone}
                    title={t(`taskModal.${isEditing ? 'edit' : 'create'}.${kind}`)}
                    subtitle={headSub}
                />
            )}
            open={open}
            onCancel={onClose}
            okText={isEditing ? t('taskModal.saveChanges') : t(`taskModal.create.${kind}`)}
            cancelText={t('common.cancel')}
            confirmLoading={loading}
            onOk={() => form.submit()}
            width={820}
            className="create-task-modal"
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
                className="lq-frm"
            >
                {!isEditing && noAssignableUsers && (
                    <Alert
                        className="lq-full"
                        type="warning"
                        message={t(`taskModal.noTargets.${kind}`)}
                        showIcon
                        style={{ marginBottom: 16 }}
                    />
                )}

                <Form.Item
                    className="lq-full"
                    label={t(`taskModal.titleLabel.${kind}`)}
                    name="title"
                    rules={[
                        {
                            required: true,
                            // Yalnizca bosluk = BOS. required tek basina
                            // "   " degerini gecerli sayiyor, payload'a
                            // trim'lenmis bos baslik gidiyordu.
                            whitespace: true,
                            message: t(`taskModal.titleRequired.${kind}`),
                        },
                        { max: 255, message: t('task.maxChars') },
                    ]}
                >
                    <Input maxLength={255} placeholder={t('taskModal.titlePlaceholder')} />
                </Form.Item>

                <FormSection>{t('taskModal.groupWhere')}</FormSection>
                <Form.Item
                    label={t('entity.customer')}
                    name="customer_id"
                    rules={[{ required: true, message: t('task.customerRequired') }]}
                >
                    <Select
                        showSearch
                        placeholder={t('task.selectCustomer')}
                        onChange={handleCustomerChange}
                        filterOption={selectFilter}
                        options={customers.map((c) => ({ value: c.id, label: c.name }))}
                        {...customerSelectRender}
                    />
                </Form.Item>

                <Form.Item
                    label={t('entity.project')}
                    name="project_id"
                    rules={[{ required: true, message: t('task.projectRequired') }]}
                >
                    <Select
                        showSearch
                        placeholder={customerId ? t('taskModal.selectProject') : t('taskModal.customerFirst')}
                        disabled={!customerId}
                        onChange={handleProjectChange}
                        filterOption={selectFilter}
                        options={filteredProjects.map((p) => ({
                            value: p.id,
                            label: p.name,
                        }))}
                        {...projectSelectRender}
                    />
                </Form.Item>

                <Form.Item
                    label={t('task.subProject')}
                    name="sub_project_id"
                    extra={t('taskModal.subProjectHint')}
                >
                    <Select
                        allowClear
                        showSearch
                        placeholder={projectId ? t('taskModal.selectSubProject') : t('taskModal.projectFirst')}
                        disabled={!projectId}
                        loading={subProjectsLoading}
                        filterOption={selectFilter}
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
                                        placeholder={t('task.newSubProject')}
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
                                    >{t('task.add')}</Button>
                                </Space.Compact>
                            </>
                        )}
                    />
                </Form.Item>

                <Form.Item
                    label={isEditing ? t('taskModal.assignee') : t('taskModal.assignees')}
                    name="assignee"
                    rules={[
                        {
                            required: true,
                            message: t('task.pickAssignee'),
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
                                ? t('taskModal.noAssignable')
                                : isEditing
                                ? t('taskModal.selectUser')
                                : t('taskModal.selectUsersGroups')
                        }
                        disabled={noAssignableUsers}
                        filterOption={selectFilter}
                        options={assigneeOptions}
                    />
                </Form.Item>

                <Form.Item
                    className="lq-full"
                    label={t('common.description')}
                    name="description"
                    rules={[
                        { required: true, message: t('task.descriptionRequired') },
                        {
                            validator: (_, value) =>
                                !value || value.trim().length > 0
                                    ? Promise.resolve()
                                    : Promise.reject(
                                          new Error(t('task.descriptionRequired'))
                                      ),
                        },
                    ]}
                >
                    <Input.TextArea rows={3} placeholder={t('taskModal.descriptionPlaceholder')} />
                </Form.Item>

                <FormSection>{t('taskModal.groupWhen')}</FormSection>
                <Form.Item
                    label={t('task.scheduledDate')}
                    name="scheduled_date"
                    rules={[
                        { required: true, message: t('task.scheduledDateRequired') },
                    ]}
                >
                    <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
                </Form.Item>

                <Form.Item label={t('task.dueDate')} name="due_date">
                    <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
                </Form.Item>

                <Form.Item
                    label={t('task.priority')}
                    name="priority"
                    rules={[{ required: true }]}
                >
                    <ChipGroup ariaLabel={t('task.priority')} options={priorityOptions} />
                </Form.Item>

                {/* A8: faturalanabilirlik yalniz duzenlemede (olusturmada proje
                    varsayilani miras alinir; sunucu override'i izler). */}
                {isEditing && (
                    <Form.Item
                        label={t('task.billable')}
                        name="is_billable"
                        valuePropName="checked"
                        extra={t('task.billableHint')}
                    >
                        <Switch />
                    </Form.Item>
                )}
            </Form>
        </Modal>
    )
}

export default CreateTaskModal
