/**
 * =============================================================================
 * HERMES - Tasks Page
 * =============================================================================
 * Calendar / list view of tasks scoped to the current user's visibility.
 * Layout matches the Time Entry page (weekly columns, Hermes Ant Design).
 *
 * After fetching tasks, this page calls auth-service /users/lookup once to
 * resolve assigner / assignee names, then passes the resulting userMap to
 * the card and detail modal.
 * =============================================================================
 */

import { useEffect, useMemo, useState } from 'react'
import {
    Button,
    Card,
    Empty,
    Modal,
    Segmented,
    Select,
    Space,
    Spin,
    Tooltip,
    message,
} from 'antd'
import {
    LeftOutlined,
    RightOutlined,
    PlusOutlined,
    FilterOutlined,
    ExclamationCircleOutlined,
    DeleteOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'

import {
    authService,
    customerService,
    projectService,
    taskService,
    taskSubProjectService,
} from '../services/api'
import { useAuthStore } from '../stores/authStore'
import { useTaskPermissions } from '../hooks/useTaskPermissions'
import TasksWeeklyView from '../components/tasks/TasksWeeklyView'
import TasksListView from '../components/tasks/TasksListView'
import CreateTaskModal from '../components/modals/CreateTaskModal'
import TaskNoteModal from '../components/modals/TaskNoteModal'

dayjs.extend(isoWeek)

const STATUS_OPTIONS = [
    { value: 'pending', label: 'Pending' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
]

const PRIORITY_OPTIONS = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'urgent', label: 'Urgent' },
]

function TasksPage() {
    const { user } = useAuthStore()
    const queryClient = useQueryClient()
    const {
        canAccessTasks,
        canAssignTasks,
        isTaskAdmin,
        assignableUserIds,
    } = useTaskPermissions()

    const [weekStart, setWeekStart] = useState(() => dayjs().startOf('isoWeek'))
    const [statusFilter, setStatusFilter] = useState(null)
    const [priorityFilter, setPriorityFilter] = useState(null)
    const [customerFilter, setCustomerFilter] = useState(null)
    const [projectFilter, setProjectFilter] = useState(null)
    const [subProjectFilter, setSubProjectFilter] = useState(null)

    const [createOpen, setCreateOpen] = useState(false)
    const [editingTask, setEditingTask] = useState(null)
    const [initialDate, setInitialDate] = useState(null)
    const [deletingTask, setDeletingTask] = useState(null)
    const [noteTask, setNoteTask] = useState(null)

    // ── View switches ──────────────────────────────────────────────────────
    // Scope: 'my' = tasks assigned to me; 'assigned' = tasks I assigned.
    const [viewScope, setViewScope] = useState('my')
    // Layout: 'calendar' or 'list'.
    const [viewLayout, setViewLayout] = useState('calendar')

    // "Assigned by Me" requires task-assign permission or admin.
    const canViewAssignedByMe = isTaskAdmin || canAssignTasks
    // If a non-assigner ends up with viewScope='assigned' (e.g. permission
    // was revoked while the page is open), force back to 'my'.
    if (viewScope === 'assigned' && !canViewAssignedByMe) {
        // Setting state during render is fine because it's idempotent here.
        setViewScope('my')
    }

    // ── Copy/paste state — Time Entry parity ──────────────────────────────
    const [selectedTaskId, setSelectedTaskId] = useState(null)
    const [copiedTask, setCopiedTask] = useState(null)
    const [targetDate, setTargetDate] = useState(null)

    const weekEnd = weekStart.endOf('isoWeek')

    // Filter selectors data
    const { data: customers = [] } = useQuery({
        queryKey: ['customers'],
        queryFn: () => customerService.getAll(),
        enabled: canAccessTasks,
    })
    const { data: projects = [] } = useQuery({
        queryKey: ['projects'],
        queryFn: () => projectService.getAll(),
        enabled: canAccessTasks,
    })
    const filteredProjects = useMemo(() => {
        if (!customerFilter) return projects
        return projects.filter((p) => p.customer_id === customerFilter)
    }, [projects, customerFilter])

    const { data: subProjects = [] } = useQuery({
        queryKey: ['task-sub-projects', customerFilter, projectFilter],
        queryFn: () =>
            taskSubProjectService.list({
                customer_id: customerFilter || undefined,
                project_id: projectFilter || undefined,
            }),
        enabled: canAccessTasks,
    })

    // Scope filter:
    //  - 'my'       → assignee_user_id = current user
    //  - 'assigned' → assigner_user_id = current user
    // Backend enforces visibility independently; these filters narrow the
    // result set so each scope is unambiguous.
    const scopeParams = useMemo(() => {
        if (!user?.id) return {}
        return viewScope === 'assigned'
            ? { assigner_user_id: user.id }
            : { assignee_user_id: user.id }
    }, [viewScope, user?.id])

    const { data: tasks = [], isLoading } = useQuery({
        queryKey: [
            'tasks',
            viewScope,
            weekStart.format('YYYY-MM-DD'),
            statusFilter,
            priorityFilter,
            customerFilter,
            projectFilter,
            subProjectFilter,
        ],
        queryFn: () =>
            taskService.list({
                start_date: weekStart.format('YYYY-MM-DD'),
                end_date: weekEnd.format('YYYY-MM-DD'),
                status: statusFilter || undefined,
                priority: priorityFilter || undefined,
                customer_id: customerFilter || undefined,
                project_id: projectFilter || undefined,
                sub_project_id: subProjectFilter || undefined,
                ...scopeParams,
            }),
        enabled: canAccessTasks,
    })

    // Collect every user id referenced by the current task list and resolve
    // names with a single auth-service /users/lookup call.
    const referencedUserIds = useMemo(() => {
        const ids = new Set()
        for (const t of tasks) {
            if (t.assignee_user_id) ids.add(t.assignee_user_id)
            if (t.assigner_user_id) ids.add(t.assigner_user_id)
            if (t.completed_by_user_id) ids.add(t.completed_by_user_id)
        }
        return Array.from(ids)
    }, [tasks])

    const { data: usersForTasks = [] } = useQuery({
        queryKey: ['auth-users-lookup', { ids: referencedUserIds }],
        queryFn: () => authService.lookupUsers({ ids: referencedUserIds }),
        enabled: canAccessTasks && referencedUserIds.length > 0,
        staleTime: 60 * 1000,
    })

    const userMap = useMemo(() => {
        const map = {}
        for (const u of usersForTasks) map[u.id] = u
        return map
    }, [usersForTasks])

    // Mutations
    const createMutation = useMutation({
        mutationFn: (data) => taskService.create(data),
        onSuccess: () => {
            message.success('Task created successfully.')
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            setCreateOpen(false)
            setEditingTask(null)
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to create task.')
        },
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => taskService.update(id, data),
        onSuccess: () => {
            message.success('Task updated.')
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            setCreateOpen(false)
            setEditingTask(null)
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to update task.')
        },
    })

    const completionMutation = useMutation({
        mutationFn: ({ id, completed }) => taskService.setCompleted(id, completed),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to update status.')
        },
    })

    const deleteMutation = useMutation({
        mutationFn: (taskId) => taskService.delete(taskId),
        onSuccess: () => {
            message.success('Task deleted.')
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            setDeletingTask(null)
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to delete task.')
            setDeletingTask(null)
        },
    })

    const noteMutation = useMutation({
        mutationFn: ({ id, note }) => taskService.updateNote(id, note),
        onSuccess: (updated) => {
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            // If the modal is still showing this task, refresh its data.
            if (noteTask && noteTask.id === updated.id) setNoteTask(updated)
        },
    })

    // ── Paste mutation — separate from createMutation so it doesn't show
    // the generic "Task created successfully" toast (paste has its own).
    const pasteMutation = useMutation({
        mutationFn: (data) => taskService.create(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Paste failed.')
        },
    })

    const handleCreate = (date) => {
        setEditingTask(null)
        setInitialDate(date ? date.format('YYYY-MM-DD') : null)
        setCreateOpen(true)
    }

    const handleEdit = (task) => {
        setEditingTask(task)
        setInitialDate(task.scheduled_date)
        setCreateOpen(true)
    }

    const handleSubmitTask = async (payload, taskId) => {
        if (taskId) {
            await updateMutation.mutateAsync({ id: taskId, data: payload })
        } else {
            await createMutation.mutateAsync(payload)
        }
    }

    const handleToggleCompletion = (task, nextCompleted) => {
        completionMutation.mutate({ id: task.id, completed: nextCompleted })
    }

    const handleSaveNote = async (task, note) => {
        await noteMutation.mutateAsync({ id: task.id, note })
    }

    const handleClearFilters = () => {
        setStatusFilter(null)
        setPriorityFilter(null)
        setCustomerFilter(null)
        setProjectFilter(null)
        setSubProjectFilter(null)
    }

    // ── Copy/paste handlers — Time Entry parity ────────────────────────────
    const handleSelectTask = (taskId) => {
        setSelectedTaskId((prev) => (prev === taskId ? null : taskId))
        // Starting a new selection clears any pending paste target.
        setTargetDate(null)
    }

    const handleSelectDay = (dateStr) => {
        setTargetDate((prev) => (prev === dateStr ? null : dateStr))
    }

    const handleClearClipboard = () => {
        setSelectedTaskId(null)
        setCopiedTask(null)
        setTargetDate(null)
    }

    // Keyboard shortcuts — Ctrl/Cmd + C/V/Escape (Time Entry parity)
    useEffect(() => {
        const handleKeyDown = async (e) => {
            // Don't intercept while typing in a form field.
            const tag = document.activeElement?.tagName?.toUpperCase()
            const isEditable =
                tag === 'INPUT' ||
                tag === 'TEXTAREA' ||
                tag === 'SELECT' ||
                document.activeElement?.isContentEditable === true
            if (isEditable) return

            const isMod = e.ctrlKey || e.metaKey

            // ── Ctrl/Cmd+C — copy selected task ─────────────────────────────
            if (isMod && e.key === 'c') {
                if (selectedTaskId) {
                    const task = tasks.find((t) => t.id === selectedTaskId)
                    if (task) {
                        setCopiedTask(task)
                        const label = task.title || 'Task'
                        message.info(
                            `"${label}" copied — select a target day, then Ctrl+V`
                        )
                        e.preventDefault()
                    }
                }
                return
            }

            // ── Ctrl/Cmd+V — paste to target day ────────────────────────────
            if (isMod && e.key === 'v') {
                if (!copiedTask) return // nothing in clipboard, let browser handle
                e.preventDefault()

                if (!targetDate) {
                    message.warning('Select a target day first, then paste')
                    return
                }
                if (pasteMutation.isPending) return // debounce double-paste

                // Preserve the original due-date offset, if any.
                let newDueDate = null
                if (copiedTask.due_date && copiedTask.scheduled_date) {
                    const offsetDays = dayjs(copiedTask.due_date).diff(
                        dayjs(copiedTask.scheduled_date),
                        'day'
                    )
                    newDueDate = dayjs(targetDate)
                        .add(offsetDays, 'day')
                        .format('YYYY-MM-DD')
                }

                const payload = {
                    customer_id: copiedTask.customer_id,
                    project_id: copiedTask.project_id,
                    sub_project_id: copiedTask.sub_project_id || null,
                    assignee_user_id: copiedTask.assignee_user_id,
                    title: copiedTask.title,
                    description: copiedTask.description,
                    scheduled_date: targetDate,
                    due_date: newDueDate,
                    estimated_duration_minutes:
                        copiedTask.estimated_duration_minutes || null,
                    priority: copiedTask.priority || 'medium',
                    // status, assignee_note, completed_* intentionally omitted —
                    // backend defaults handle them (status=pending, others null).
                }

                try {
                    await pasteMutation.mutateAsync(payload)
                    const formattedDate = dayjs(targetDate).format('DD MMM')
                    message.success(
                        `"${copiedTask.title || 'Task'}" pasted to ${formattedDate} ✓`
                    )
                    // Clear target only — keep copiedTask for repeated pastes.
                    setTargetDate(null)
                } catch {
                    // pasteMutation.onError already showed an error toast.
                }
                return
            }

            // ── Escape — clear clipboard & selection ────────────────────────
            if (e.key === 'Escape') {
                setSelectedTaskId(null)
                setCopiedTask(null)
                setTargetDate(null)
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [selectedTaskId, copiedTask, targetDate, tasks, pasteMutation])

    const canCreateTask =
        isTaskAdmin || (canAssignTasks && (isTaskAdmin || assignableUserIds.length > 0))

    if (!canAccessTasks) {
        return (
            <div style={{ padding: 24 }}>
                <Empty description="You do not have access to the Tasks module." />
            </div>
        )
    }

    return (
        <div style={{ padding: 24 }}>
            {/* Header */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 16,
                    flexWrap: 'wrap',
                    gap: 12,
                }}
            >
                <div>
                    <h1 style={{ margin: 0, color: '#fff' }}>Tasks</h1>
                    <div style={{ color: '#9b9b9b', fontSize: 13, marginTop: 2 }}>
                        Manage assigned technical work
                    </div>
                </div>
                <Space wrap>
                    {/* Scope: My Tasks / Assigned by Me */}
                    <Segmented
                        value={viewScope}
                        onChange={setViewScope}
                        options={
                            canViewAssignedByMe
                                ? [
                                      { label: 'My Tasks', value: 'my' },
                                      { label: 'Assigned by Me', value: 'assigned' },
                                  ]
                                : [{ label: 'My Tasks', value: 'my' }]
                        }
                    />
                    {/* Layout: Calendar / List */}
                    <Segmented
                        value={viewLayout}
                        onChange={setViewLayout}
                        options={[
                            { label: 'Calendar', value: 'calendar' },
                            { label: 'List', value: 'list' },
                        ]}
                    />
                    {viewLayout === 'calendar' && (
                        <>
                            <Button
                                icon={<LeftOutlined />}
                                onClick={() =>
                                    setWeekStart((prev) => prev.subtract(1, 'week'))
                                }
                            />
                            <Button
                                onClick={() =>
                                    setWeekStart(dayjs().startOf('isoWeek'))
                                }
                            >
                                Today
                            </Button>
                            <Button
                                icon={<RightOutlined />}
                                onClick={() =>
                                    setWeekStart((prev) => prev.add(1, 'week'))
                                }
                            />
                            <span style={{ color: '#fff', fontWeight: 500 }}>
                                {weekStart.format('DD MMM')} –{' '}
                                {weekEnd.format('DD MMM, YYYY')}
                            </span>
                        </>
                    )}
                    {(canAssignTasks || isTaskAdmin) && (
                        <Tooltip
                            title={
                                !isTaskAdmin && assignableUserIds.length === 0
                                    ? 'You have no assignable users.'
                                    : 'Create a new task'
                            }
                        >
                            <Button
                                type="primary"
                                icon={<PlusOutlined />}
                                disabled={!canCreateTask}
                                onClick={() => handleCreate(dayjs())}
                            >
                                Create Task
                            </Button>
                        </Tooltip>
                    )}
                </Space>
            </div>

            {/* Filters */}
            <Card
                size="small"
                style={{ marginBottom: 16, background: '#1a1a1a', borderColor: '#303030' }}
            >
                <Space wrap>
                    <FilterOutlined style={{ color: '#9b9b9b' }} />
                    <Select
                        allowClear
                        placeholder="Status"
                        style={{ width: 140 }}
                        value={statusFilter}
                        onChange={setStatusFilter}
                        options={STATUS_OPTIONS}
                    />
                    <Select
                        allowClear
                        placeholder="Priority"
                        style={{ width: 140 }}
                        value={priorityFilter}
                        onChange={setPriorityFilter}
                        options={PRIORITY_OPTIONS}
                    />
                    <Select
                        allowClear
                        showSearch
                        placeholder="Customer"
                        style={{ width: 200 }}
                        value={customerFilter}
                        onChange={(v) => {
                            setCustomerFilter(v)
                            setProjectFilter(null)
                            setSubProjectFilter(null)
                        }}
                        optionFilterProp="label"
                        options={customers.map((c) => ({ value: c.id, label: c.name }))}
                    />
                    <Select
                        allowClear
                        showSearch
                        placeholder="Project"
                        style={{ width: 200 }}
                        value={projectFilter}
                        disabled={!customerFilter}
                        onChange={(v) => {
                            setProjectFilter(v)
                            setSubProjectFilter(null)
                        }}
                        optionFilterProp="label"
                        options={filteredProjects.map((p) => ({
                            value: p.id,
                            label: p.name,
                        }))}
                    />
                    <Select
                        allowClear
                        showSearch
                        placeholder="Sub Project"
                        style={{ width: 200 }}
                        value={subProjectFilter}
                        disabled={!projectFilter}
                        onChange={setSubProjectFilter}
                        optionFilterProp="label"
                        options={subProjects.map((s) => ({ value: s.id, label: s.name }))}
                    />
                    <Button onClick={handleClearFilters}>Clear</Button>
                </Space>
            </Card>

            {/* Calendar — always visible (full weekly grid even when empty) */}
            {isLoading ? (
                <div style={{ textAlign: 'center', padding: 48 }}>
                    <Spin />
                </div>
            ) : viewLayout === 'list' ? (
                <TasksListView
                    tasks={tasks}
                    userMap={userMap}
                    currentUserId={user?.id}
                    isAdmin={isTaskAdmin}
                    onEditTask={handleEdit}
                    onDeleteTask={(t) => setDeletingTask(t)}
                    onOpenNote={(t) => setNoteTask(t)}
                />
            ) : (
                <TasksWeeklyView
                    weekStart={weekStart}
                    tasks={tasks}
                    userMap={userMap}
                    currentUserId={user?.id}
                    isAdmin={isTaskAdmin}
                    /* In Assigned by Me mode each day shows tasks grouped
                       by assignee — admins/assigners scan teams quickly. */
                    groupByAssignee={viewScope === 'assigned'}
                    onEditTask={handleEdit}
                    onDeleteTask={(t) => setDeletingTask(t)}
                    onOpenNote={(t) => setNoteTask(t)}
                    onToggleCompletion={handleToggleCompletion}
                    onCreate={handleCreate}
                    canCreate={canCreateTask}
                    completionLoading={completionMutation.isPending}
                    selectedTaskId={selectedTaskId}
                    copiedTask={copiedTask}
                    targetDate={targetDate}
                    onSelectTask={handleSelectTask}
                    onSelectDay={handleSelectDay}
                    onClearClipboard={handleClearClipboard}
                />
            )}

            {/* Create / Edit modal — same Hermes Time Entry pattern */}
            <CreateTaskModal
                open={createOpen}
                onClose={() => {
                    setCreateOpen(false)
                    setEditingTask(null)
                }}
                onSubmit={handleSubmitTask}
                initialDate={initialDate}
                editingTask={editingTask}
                assignableUserIds={assignableUserIds}
                isAdmin={isTaskAdmin}
                loading={createMutation.isPending || updateMutation.isPending}
            />

            {/* Note modal — assignee/admin can edit, assigner read-only */}
            <TaskNoteModal
                open={!!noteTask}
                task={noteTask}
                onClose={() => setNoteTask(null)}
                onSave={handleSaveNote}
                saving={noteMutation.isPending}
                canEdit={
                    isTaskAdmin ||
                    (noteTask && noteTask.assignee_user_id === user?.id)
                }
            />

            {/* Delete confirmation — mirrors Time Entry's delete modal */}
            <Modal
                open={!!deletingTask}
                onCancel={() => setDeletingTask(null)}
                footer={null}
                width={420}
                centered
                closable={false}
                styles={{
                    content: {
                        background: '#1e1e1e',
                        border: '1px solid #303030',
                        borderRadius: 12,
                        padding: '28px 28px 24px',
                    },
                }}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div
                            style={{
                                width: 40,
                                height: 40,
                                borderRadius: 10,
                                background: 'rgba(239,68,68,0.15)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                            }}
                        >
                            <ExclamationCircleOutlined
                                style={{ color: '#ef4444', fontSize: 20 }}
                            />
                        </div>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: 16, color: '#fff' }}>
                                Delete Task
                            </div>
                            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                                The task will be archived and removed from the calendar.
                            </div>
                        </div>
                    </div>

                    {deletingTask && (
                        <div
                            style={{
                                background: '#2a2a2a',
                                border: '1px solid #383838',
                                borderRadius: 8,
                                padding: '10px 14px',
                            }}
                        >
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0' }}>
                                {deletingTask.title}
                            </div>
                            <div style={{ fontSize: 12, color: '#888', marginTop: 3 }}>
                                {deletingTask.customer_name || '—'}
                                {deletingTask.project_name
                                    ? ` · ${deletingTask.project_name}`
                                    : ''}
                            </div>
                        </div>
                    )}

                    <p style={{ margin: 0, color: '#aaa', fontSize: 14, lineHeight: 1.6 }}>
                        Are you sure you want to delete this task?
                    </p>

                    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                        <Button
                            onClick={() => setDeletingTask(null)}
                            style={{
                                background: 'transparent',
                                borderColor: '#444',
                                color: '#ccc',
                                borderRadius: 8,
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="primary"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() =>
                                deletingTask && deleteMutation.mutate(deletingTask.id)
                            }
                            loading={deleteMutation.isPending}
                            style={{ borderRadius: 8 }}
                        >
                            Delete
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    )
}

export default TasksPage
