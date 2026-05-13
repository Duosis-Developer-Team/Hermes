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
import TasksBoardView from '../components/tasks/TasksBoardView'
import TasksSearchBar from '../components/tasks/TasksSearchBar'
import CreateTaskModal from '../components/modals/CreateTaskModal'
import TaskReviewModal from '../components/modals/TaskReviewModal'
import LogTimeModal from '../components/modals/LogTimeModal'
import './TasksPage.css'

dayjs.extend(isoWeek)

const STATUS_OPTIONS = [
    { value: 'pending', label: 'Pending' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'rejected', label: 'Rejected' },
]

// Scope (primary) — which pool of tasks we're looking at. Single-
// select. "Assigned by Me" stays hidden from users without assign
// permission (same gate as the legacy pill).
const TASK_SCOPES = [
    { value: 'my-tasks', label: 'My Tasks' },
    { value: 'assigned-by-me', label: 'Assigned by Me', assignerOnly: true },
]

// Quick filters (secondary) — optional single-select chip on top of
// the scope. Clicking the active chip clears it.
const TASK_QUICK_FILTERS = [
    { value: 'due-this-week', label: 'Due This Week' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'completed-this-week', label: 'Completed This Week' },
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
    const [reviewTask, setReviewTask] = useState(null)
    // Task to prefill the Log Time modal with. Set on first completion
    // and on the explicit "Log Time" action; never set on reopen.
    const [logTimeTask, setLogTimeTask] = useState(null)

    // ── View switches ──────────────────────────────────────────────────────
    // Scope (primary) and Quick Filter (secondary, optional) are two
    // independent controls now. Layout (Calendar/List/Board) is a
    // third independent axis — none of these auto-flip each other.
    const [viewLayout, setViewLayout] = useState('calendar')
    const [taskScope, setTaskScope] = useState('my-tasks')
    const [taskQuickFilter, setTaskQuickFilter] = useState(null)
    // Admin-only user selector (Time Entry parity). null → current user.
    const [selectedUserId, setSelectedUserId] = useState(null)

    // "Assigned by Me" requires task-assign permission or admin.
    const canViewAssignedByMe = isTaskAdmin || canAssignTasks
    // If permission is revoked while the page is open and the user is on
    // the Assigned-by-Me scope, fall back to My Tasks.
    if (taskScope === 'assigned-by-me' && !canViewAssignedByMe) {
        setTaskScope('my-tasks')
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

    // Translate the active view into list-endpoint params. Every view
    // declares its own scope (assignee_user_id vs assigner_user_id),
    // and the date-range views drop the scheduled-date window so
    // history and future are reachable from the same screen.
    const todayStr = dayjs().format('YYYY-MM-DD')
    const yesterdayStr = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
    const weekStartStr = weekStart.format('YYYY-MM-DD')
    const weekEndStr = weekEnd.format('YYYY-MM-DD')

    // Scope → backend assignee_user_id / assigner_user_id.
    const effectiveScopeParams = useMemo(() => {
        if (!viewedUserId) return {}
        return taskScope === 'assigned-by-me'
            ? { assigner_user_id: viewedUserId }
            : { assignee_user_id: viewedUserId }
    }, [taskScope, viewedUserId])

    // Quick filter → additional backend filter params. When set, the
    // scheduled-date week window is intentionally dropped so the
    // filter can match tasks scheduled in other weeks (e.g. an
    // "Overdue" task scheduled three weeks ago).
    const quickFilterParams = useMemo(() => {
        switch (taskQuickFilter) {
            case 'due-this-week':
                return {
                    due_from: weekStartStr,
                    due_to: weekEndStr,
                    status_exclude: ['completed', 'rejected'],
                }
            case 'overdue':
                return {
                    due_to: yesterdayStr,
                    status_exclude: ['completed', 'rejected'],
                }
            case 'completed-this-week':
                return {
                    statuses: ['completed'],
                    completed_from: weekStartStr,
                    completed_to: weekEndStr,
                }
            default:
                return null
        }
    }, [taskQuickFilter, weekStartStr, weekEndStr, yesterdayStr])

    const viewIsDateRange = !!quickFilterParams

    const { data: tasks = [], isLoading } = useQuery({
        queryKey: [
            'tasks',
            taskScope,
            taskQuickFilter,
            viewedUserId,
            weekStartStr,
            statusFilter,
            priorityFilter,
            customerFilter,
            projectFilter,
            subProjectFilter,
            // Calendar widens the date window with an OR on due_date so
            // due markers render even when the task is scheduled in a
            // different week. List/Board keep the strict scheduled-date
            // semantics. Key on viewLayout so we don't share cache.
            viewLayout,
            todayStr,
        ],
        queryFn: () => {
            const base = {
                status: statusFilter || undefined,
                priority: priorityFilter || undefined,
                customer_id: customerFilter || undefined,
                project_id: projectFilter || undefined,
                sub_project_id: subProjectFilter || undefined,
                ...effectiveScopeParams,
            }
            if (quickFilterParams) {
                // Quick filter active — drop the scheduled-date window
                // so "Overdue" reaches older weeks and "Completed This
                // Week" finds rows scheduled outside this week. Works
                // with either scope (My Tasks or Assigned by Me).
                return taskService.list({
                    ...base,
                    ...quickFilterParams,
                })
            }
            // No quick filter — page by current week. Calendar asks
            // the backend to also include tasks whose due_date falls
            // in [weekStart, weekEnd] so the due-marker column lights
            // up for tasks scheduled in a different week.
            return taskService.list({
                ...base,
                start_date: weekStartStr,
                end_date: weekEndStr,
                include_due_in_range:
                    viewLayout === 'calendar' ? true : undefined,
            })
        },
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
            queryClient.invalidateQueries({ queryKey: ['task-activity'] })
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
            queryClient.invalidateQueries({ queryKey: ['task-activity'] })
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
            queryClient.invalidateQueries({ queryKey: ['task-activity'] })
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
            queryClient.invalidateQueries({ queryKey: ['task-activity'] })
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to update status.')
        },
    })

    const workLogMutation = useMutation({
        // Route the log to the task's *assignee* — that's whose work it
        // was. Backend (POST /work-logs) honours target_user_id only
        // when the caller is admin; for a non-admin assignee logging
        // their own task this collapses to "log for self" anyway. The
        // page-level `selectedUserId` (admin view-as override) is
        // deliberately NOT passed here — the task itself dictates the
        // owner, not the viewing context.
        mutationFn: ({ data, assigneeUserId }) =>
            workLogService.create(data, assigneeUserId || null),
        onSuccess: (_created, variables) => {
            const dateStr = variables?.data?.date_worked
            message.success(
                dateStr ? `Time logged for ${dateStr}.` : 'Time logged.'
            )
            setLogTimeTask(null)
            // The work log is created in core_db just like a Time
            // Entry — must invalidate the same caches Time Entry uses
            // so the new row shows up when the user navigates there
            // (without this, React Query serves stale data within its
            // staleTime window and the user thinks the log vanished).
            queryClient.invalidateQueries({ queryKey: ['workLogs'] })
            queryClient.invalidateQueries({ queryKey: ['periodStatus'] })
            queryClient.invalidateQueries({ queryKey: ['task-activity'] })
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
            queryClient.invalidateQueries({ queryKey: ['task-activity'] })
            setDeletingTask(null)
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to delete task.')
            setDeletingTask(null)
        },
    })

    const rejectMutation = useMutation({
        mutationFn: (taskId) => taskService.reject(taskId),
        onSuccess: (updated) => {
            message.success('Task rejected.')
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            queryClient.invalidateQueries({ queryKey: ['task-activity'] })
            // Refresh the modal so it shows the rejected banner before
            // the user closes it. Same pattern as the legacy note modal.
            if (reviewTask && reviewTask.id === updated.id) setReviewTask(updated)
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to reject task.')
        },
    })

    const reopenMutation = useMutation({
        mutationFn: (taskId) => taskService.updateStatus(taskId, 'pending'),
        onSuccess: (updated) => {
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            queryClient.invalidateQueries({ queryKey: ['task-activity'] })
            if (reviewTask && reviewTask.id === updated.id) setReviewTask(updated)
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to reopen task.')
        },
    })

    // ── Paste mutation — separate from createMutation so it doesn't show
    // the generic "Task created successfully" toast (paste has its own).
    const pasteMutation = useMutation({
        mutationFn: (data) => taskService.create(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            queryClient.invalidateQueries({ queryKey: ['task-activity'] })
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
            setReviewTask(null)
            setLogTimeTask(task)
        }
    }

    const handleOpenLogTime = (task) => {
        setLogTimeTask(task)
    }

    const handleLogTimeSubmit = async (data) => {
        // Carry the task_id so the backend can link work_logs.task_id
        // and emit the log_time_created activity event.
        const payload = { ...data, task_id: logTimeTask?.id || null }
        await workLogMutation.mutateAsync({
            data: payload,
            assigneeUserId: logTimeTask?.assignee_user_id || null,
        })
    }

    const handleOpenReview = (task) => {
        setReviewTask(task)
    }

    const handleReviewMarkCompleted = async (task) => {
        // Closes review, flips status, and the existing toggle handler
        // auto-opens the Log Time modal on success.
        setReviewTask(null)
        await handleToggleCompletion(task, true)
    }

    const handleReviewReject = async (task) => {
        await rejectMutation.mutateAsync(task.id)
    }

    const handleReviewReopen = async (task) => {
        await reopenMutation.mutateAsync(task.id)
    }

    const handleClearFilters = () => {
        setStatusFilter(null)
        setPriorityFilter(null)
        setCustomerFilter(null)
        setProjectFilter(null)
        setSubProjectFilter(null)
    }

    // ── Copy/paste handlers — Time Entry parity ────────────────────────────
    // The "completed tasks can't be copied" rule is enforced at three
    // points only:
    //   1. TaskCard body click → never routes to onSelect when completed.
    //   2. Ctrl+C handler below — refuses if the selected task is completed.
    //   3. Ctrl+V handler below — refuses if the copied task is completed.
    // We deliberately do NOT auto-clear copiedTask from a tasks-query
    // effect: an over-aggressive auto-clear was racing the paste flow
    // and silently dropping the clipboard.

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
            // Store a *frozen snapshot* of the task instead of the live
            // object reference. tasks-query invalidation after create /
            // paste / edit replaces the array contents; if we held the
            // live reference, later renders could mutate it (status,
            // dates) and break paste. The snapshot is everything we
            // need to rebuild a create payload.
            if (isMod && e.key === 'c') {
                if (selectedTaskId) {
                    const task = tasks.find((t) => t.id === selectedTaskId)
                    if (task) {
                        if (task.status === 'completed') {
                            message.info('Completed tasks cannot be copied.')
                            e.preventDefault()
                            return
                        }
                        const snapshot = {
                            id: task.id,
                            customer_id: task.customer_id,
                            project_id: task.project_id,
                            sub_project_id: task.sub_project_id || null,
                            assignee_user_id: task.assignee_user_id,
                            title: task.title || 'Task',
                            description: task.description || '',
                            original_scheduled_date: task.scheduled_date,
                            original_due_date: task.due_date || null,
                            priority: task.priority || 'medium',
                        }
                        setCopiedTask(snapshot)
                        message.info(
                            `"${snapshot.title}" copied — select a target day, then Ctrl+V`
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

                // Preserve the original due-date offset relative to the
                // original scheduled date; both fields live on the
                // snapshot the Ctrl+C handler captured.
                let newDueDate = null
                if (
                    copiedTask.original_due_date &&
                    copiedTask.original_scheduled_date
                ) {
                    const offsetDays = dayjs(copiedTask.original_due_date).diff(
                        dayjs(copiedTask.original_scheduled_date),
                        'day'
                    )
                    newDueDate = dayjs(targetDate)
                        .add(offsetDays, 'day')
                        .format('YYYY-MM-DD')
                }

                // Description is required by the backend (min_length=1).
                // The snapshot may have an empty description for legacy
                // tasks; fall back to the title.
                const safeDescription =
                    (copiedTask.description && copiedTask.description.trim()) ||
                    copiedTask.title ||
                    'Task'
                const payload = {
                    customer_id: copiedTask.customer_id,
                    project_id: copiedTask.project_id,
                    sub_project_id: copiedTask.sub_project_id || null,
                    assignee_user_id: copiedTask.assignee_user_id,
                    title: copiedTask.title,
                    description: safeDescription,
                    scheduled_date: targetDate,
                    due_date: newDueDate,
                    priority: copiedTask.priority || 'medium',
                    // status, assignee_note, completed_* intentionally omitted —
                    // backend defaults handle them (status=pending, others null).
                }

                try {
                    await pasteMutation.mutateAsync(payload)
                    const formattedDate = dayjs(targetDate).format('DD MMM')
                    message.success(
                        `"${copiedTask.title}" pasted to ${formattedDate} ✓`
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
                    {/* Free-text task search — visibility enforced server-side */}
                    <TasksSearchBar
                        userMap={userMap}
                        onSelect={handleOpenReview}
                    />
                    <div className="tasks-tabs-divider" />
                    {/* Views — sole scope+filter controller. The
                        previous standalone My/Assigned-by-Me pills are
                        now folded into this segmented control. */}
                    <div
                        className="tasks-views"
                        role="tablist"
                        aria-label="Task scope"
                    >
                        {TASK_SCOPES.filter(
                            (s) => !s.assignerOnly || canViewAssignedByMe
                        ).map((s) => {
                            const isActive = taskScope === s.value
                            return (
                                <button
                                    key={s.value}
                                    type="button"
                                    role="tab"
                                    aria-selected={isActive}
                                    className={`tasks-views-pill${
                                        isActive
                                            ? ' tasks-views-pill-active'
                                            : ''
                                    }`}
                                    onClick={() => {
                                        if (isActive) return
                                        // Scope only changes which pool
                                        // of tasks we view. Quick
                                        // filter and Calendar/List/
                                        // Board layout stay as-is.
                                        setTaskScope(s.value)
                                    }}
                                >
                                    {s.label}
                                </button>
                            )
                        })}
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
                        <span
                            className={`tasks-tab-link ${
                                viewLayout === 'board' ? 'active' : ''
                            }`}
                            onClick={() => setViewLayout('board')}
                        >
                            Board
                        </span>
                    </div>
                    {/* Task creation lives on the day-column "+" buttons
                        in Calendar, mirroring Time Entry. No large
                        always-on Create button here. */}
                </div>
            </div>

            {/* Quick filter chip strip — secondary control, layers
                on top of the active scope. Single-select; clicking
                the active chip clears it. Independent of layout. */}
            <div
                className="tasks-quickfilters"
                role="toolbar"
                aria-label="Quick task filters"
            >
                {TASK_QUICK_FILTERS.map((f) => {
                    const isActive = taskQuickFilter === f.value
                    return (
                        <button
                            key={f.value}
                            type="button"
                            aria-pressed={isActive}
                            className={`tasks-quickfilter-chip${
                                isActive
                                    ? ' tasks-quickfilter-chip-active'
                                    : ''
                            }`}
                            onClick={() => {
                                // Toggle: clicking the active chip
                                // clears the filter back to none.
                                setTaskQuickFilter(
                                    isActive ? null : f.value
                                )
                            }}
                        >
                            {f.label}
                        </button>
                    )
                })}
            </div>

            {/* Week navigation row — only for calendar layout. Tight
                vertical padding so the grid sits close to the header,
                matching Time Entry's visual rhythm now that the large
                Create button has been removed from the header. */}
            {viewLayout === 'calendar' && (
                <div
                    className="tasks-body"
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 12,
                        paddingTop: 10,
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
                    onOpenReview={handleOpenReview}
                    onToggleCompletion={handleToggleCompletion}
                    completionLoading={completionMutation.isPending}
                    onOpenLogTime={handleOpenLogTime}
                />
            ) : viewLayout === 'board' ? (
                <TasksBoardView
                    tasks={tasks}
                    userMap={userMap}
                    currentUserId={user?.id}
                    isAdmin={isTaskAdmin}
                    onEditTask={handleEdit}
                    onDeleteTask={(t) => setDeletingTask(t)}
                    onOpenReview={handleOpenReview}
                    onOpenLogTime={handleOpenLogTime}
                    onToggleCompletion={handleToggleCompletion}
                    completionLoading={completionMutation.isPending}
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
                    groupByAssignee={taskScope === 'assigned-by-me'}
                    onEditTask={handleEdit}
                    onDeleteTask={(t) => setDeletingTask(t)}
                    onOpenReview={handleOpenReview}
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

            {/* Review modal — read-only details + decision actions.
                Same canAct gate the backend enforces (admin, assignee,
                assigner). Marking completed auto-opens the Log Time
                flow via handleToggleCompletion. */}
            <TaskReviewModal
                open={!!reviewTask}
                task={reviewTask}
                userMap={userMap}
                onClose={() => setReviewTask(null)}
                canAct={
                    !!reviewTask &&
                    (isTaskAdmin ||
                        reviewTask.assignee_user_id === user?.id ||
                        reviewTask.assigner_user_id === user?.id)
                }
                onMarkCompleted={handleReviewMarkCompleted}
                onReject={handleReviewReject}
                onReopen={handleReviewReopen}
                actionLoading={
                    rejectMutation.isPending ||
                    reopenMutation.isPending ||
                    completionMutation.isPending
                }
                currentUserId={user?.id}
                isAdmin={isTaskAdmin}
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
