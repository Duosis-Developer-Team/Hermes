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
    Avatar,
    Button,
    Card,
    Empty,
    Modal,
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
    UserOutlined,
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
    workLogService,
} from '../services/api'
import { useAuthStore } from '../stores/authStore'
import { useTaskPermissions } from '../hooks/useTaskPermissions'
import TasksWeeklyView from '../components/tasks/TasksWeeklyView'
import TasksListView from '../components/tasks/TasksListView'
import CreateTaskModal from '../components/modals/CreateTaskModal'
import TaskNoteModal from '../components/modals/TaskNoteModal'
import LogTimeModal from '../components/modals/LogTimeModal'
import './TasksPage.css'

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
    // Task to prefill the Log Time modal with. Set on first completion
    // and on the explicit "Log Time" action; never set on reopen.
    const [logTimeTask, setLogTimeTask] = useState(null)

    // ── View switches ──────────────────────────────────────────────────────
    // Scope: 'my' = tasks assigned to viewed user; 'assigned' = tasks
    // assigned by viewed user. For admins the "viewed user" comes from the
    // user selector below; for non-admins it is always themselves.
    const [viewScope, setViewScope] = useState('my')
    // Layout: 'calendar' or 'list'.
    const [viewLayout, setViewLayout] = useState('calendar')
    // Admin-only user selector (Time Entry parity). null → current user.
    const [selectedUserId, setSelectedUserId] = useState(null)

    // "Assigned by Me" requires task-assign permission or admin.
    const canViewAssignedByMe = isTaskAdmin || canAssignTasks
    // If a non-assigner ends up with viewScope='assigned' (e.g. permission
    // was revoked while the page is open), force back to 'my'.
    if (viewScope === 'assigned' && !canViewAssignedByMe) {
        setViewScope('my')
    }

    // Effective viewed user. Non-admin path always resolves to current user
    // regardless of the selector — backend also coerces, defense in depth.
    const viewedUserId = isTaskAdmin ? selectedUserId || user?.id : user?.id

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
    //  - 'my'       → assignee_user_id = viewed user
    //  - 'assigned' → assigner_user_id = viewed user
    // For non-admins, viewedUserId is always the current user (and the
    // backend enforces this anyway). Admins drive viewedUserId via the
    // user selector to inspect any teammate's calendar.
    const scopeParams = useMemo(() => {
        if (!viewedUserId) return {}
        return viewScope === 'assigned'
            ? { assigner_user_id: viewedUserId }
            : { assignee_user_id: viewedUserId }
    }, [viewScope, viewedUserId])

    const { data: tasks = [], isLoading } = useQuery({
        queryKey: [
            'tasks',
            viewScope,
            viewedUserId,
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

    // Admin user-selector: full active user list (Time Entry parity).
    const { data: allActiveUsers = [] } = useQuery({
        queryKey: ['auth-users-lookup', { include_inactive: false }],
        queryFn: () => authService.lookupUsers(),
        enabled: canAccessTasks && isTaskAdmin,
        staleTime: 60 * 1000,
    })

    const userMap = useMemo(() => {
        const map = {}
        // Combine the two lookup result sets so both selector + cards see
        // the same names — admins always have allActiveUsers; non-admins
        // get the small set referenced by visible tasks.
        for (const u of allActiveUsers) map[u.id] = u
        for (const u of usersForTasks) map[u.id] = u
        return map
    }, [usersForTasks, allActiveUsers])

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

    const createGroupMutation = useMutation({
        mutationFn: (data) => taskService.createForGroup(data),
        onSuccess: (res) => {
            const count = Array.isArray(res?.tasks) ? res.tasks.length : 0
            message.success(
                `${count} task${count === 1 ? '' : 's'} created for the group.`
            )
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            setCreateOpen(false)
            setEditingTask(null)
        },
        onError: (err) => {
            message.error(
                err?.response?.data?.detail || 'Failed to create group tasks.'
            )
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

    const workLogMutation = useMutation({
        mutationFn: (data) => workLogService.create(data),
        onSuccess: () => {
            message.success('Time logged.')
            setLogTimeTask(null)
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to log time.')
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

    const handleSubmitTask = async (payload, meta = {}) => {
        // meta = { taskId? , isGroup? } — modal decides which one.
        if (meta.taskId) {
            await updateMutation.mutateAsync({ id: meta.taskId, data: payload })
            return
        }
        if (meta.isGroup) {
            await createGroupMutation.mutateAsync(payload)
            return
        }
        await createMutation.mutateAsync(payload)
    }

    const handleToggleCompletion = async (task, nextCompleted) => {
        try {
            await completionMutation.mutateAsync({
                id: task.id,
                completed: nextCompleted,
            })
        } catch {
            return
        }
        if (nextCompleted) {
            // Auto-open Log Time only on first transition to completed.
            // Reopen (completed → pending) intentionally does nothing.
            setNoteTask(null)
            setLogTimeTask(task)
        }
    }

    const handleOpenLogTime = (task) => {
        setLogTimeTask(task)
    }

    const handleLogTimeSubmit = async (data) => {
        await workLogMutation.mutateAsync(data)
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

    const userSelectorOptions = useMemo(() => {
        if (!user?.id) return []
        const me = { value: user.id, label: user.full_name || 'Me' }
        if (!isTaskAdmin) return [me]
        const others = allActiveUsers
            .filter((u) => u.id !== user.id)
            .map((u) => ({ value: u.id, label: u.full_name || u.email }))
        return [me, ...others]
    }, [user, isTaskAdmin, allActiveUsers])

    return (
        <div className="tasks-page">
            {/* User header — same shape as Time Entry: avatar + identity / admin selector left,
                tab links + week nav + Create on the right. */}
            <div className="tasks-user-header">
                <div className="tasks-user-header-left">
                    <Avatar
                        size={40}
                        icon={<UserOutlined />}
                        className="tasks-user-avatar"
                    />
                    {isTaskAdmin ? (
                        <Select
                            value={selectedUserId || user?.id}
                            onChange={setSelectedUserId}
                            style={{
                                width: 220,
                                fontSize: '1.2rem',
                                fontWeight: 600,
                            }}
                            bordered={false}
                            loading={!allActiveUsers.length}
                            options={userSelectorOptions}
                            showSearch
                            filterOption={(input, option) =>
                                (option?.label ?? '')
                                    .toLowerCase()
                                    .includes(input.toLowerCase())
                            }
                        />
                    ) : (
                        <h1 className="tasks-user-name">
                            {user?.full_name || 'User'}
                        </h1>
                    )}
                </div>

                <div className="tasks-user-header-right">
                    {/* Scope tabs */}
                    <div className="tasks-tabs">
                        <span
                            className={`tasks-tab-link ${
                                viewScope === 'my' ? 'active' : ''
                            }`}
                            onClick={() => setViewScope('my')}
                        >
                            My Tasks
                        </span>
                        {canViewAssignedByMe && (
                            <span
                                className={`tasks-tab-link ${
                                    viewScope === 'assigned' ? 'active' : ''
                                }`}
                                onClick={() => setViewScope('assigned')}
                            >
                                Assigned by Me
                            </span>
                        )}
                    </div>
                    <div className="tasks-tabs-divider" />
                    {/* Layout tabs */}
                    <div className="tasks-tabs">
                        <span
                            className={`tasks-tab-link ${
                                viewLayout === 'calendar' ? 'active' : ''
                            }`}
                            onClick={() => setViewLayout('calendar')}
                        >
                            Calendar
                        </span>
                        <span
                            className={`tasks-tab-link ${
                                viewLayout === 'list' ? 'active' : ''
                            }`}
                            onClick={() => setViewLayout('list')}
                        >
                            List
                        </span>
                    </div>
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
                </div>
            </div>

            {/* Week navigation row — only for calendar layout */}
            {viewLayout === 'calendar' && (
                <div
                    className="tasks-body"
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 12,
                        paddingBottom: 0,
                    }}
                >
                    <Space>
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
                    </Space>
                </div>
            )}

            <div className="tasks-body">

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
                    onToggleCompletion={handleToggleCompletion}
                    completionLoading={completionMutation.isPending}
                    onOpenLogTime={handleOpenLogTime}
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
                    onOpenLogTime={handleOpenLogTime}
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

            </div>

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
                loading={
                    createMutation.isPending ||
                    updateMutation.isPending ||
                    createGroupMutation.isPending
                }
            />

            {/* Note modal — assignee/admin can edit, assigner read-only.
                Completion toggle is wider: assignee, assigner, or admin. */}
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
                canToggleCompletion={
                    !!noteTask &&
                    (isTaskAdmin ||
                        noteTask.assignee_user_id === user?.id ||
                        noteTask.assigner_user_id === user?.id)
                }
                onToggleCompletion={handleToggleCompletion}
                completionLoading={completionMutation.isPending}
                userMap={userMap}
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

            {/* Log Time modal — opens automatically after a task is
                completed for the first time, and on the explicit
                "Log Time" action for a completed task. */}
            <LogTimeModal
                open={!!logTimeTask}
                onClose={() => setLogTimeTask(null)}
                onSubmit={handleLogTimeSubmit}
                prefillTask={logTimeTask}
                initialDate={logTimeTask?.scheduled_date || null}
                loading={workLogMutation.isPending}
            />
        </div>
    )
}

export default TasksPage
