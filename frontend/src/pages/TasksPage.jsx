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

import { useMemo, useState } from 'react'
import {
    Avatar,
    Button,
    Card,
    Empty,
    Modal,
    Select,
    Space,
    Spin,
    Switch,
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
    CloseOutlined,
    PlayCircleOutlined,
    CheckCircleOutlined,
    UndoOutlined,
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
import TasksListView from '../components/tasks/TasksListView'
import TasksBoardView from '../components/tasks/TasksBoardView'
import TaskDetailPanel from '../components/tasks/TaskDetailPanel'
import TasksSearchBar from '../components/tasks/TasksSearchBar'
import CreateTaskModal from '../components/modals/CreateTaskModal'
import TaskReviewModal from '../components/modals/TaskReviewModal'
import LogTimeModal from '../components/modals/LogTimeModal'
import DangerConfirmModal from '../components/common/DangerConfirmModal'
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
        assignableGroupIds,
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
    // Pending checkbox-driven status change awaiting confirmation:
    // { task, nextCompleted } | null.
    const [pendingToggle, setPendingToggle] = useState(null)
    const [reviewTask, setReviewTask] = useState(null)
    // Task whose inline detail panel is docked beside the board/list.
    // Opened by clicking a card body; the card's "Review" eye button still
    // opens the full modal (reviewTask).
    const [panelTask, setPanelTask] = useState(null)
    // Task to prefill the Log Time modal with. Set on first completion
    // and on the explicit "Log Time" action; never set on reopen.
    const [logTimeTask, setLogTimeTask] = useState(null)

    // ── View switches ──────────────────────────────────────────────────────
    // Scope (primary) and Quick Filter (secondary, optional) are two
    // independent controls. Layout (List/Board) is a third independent
    // axis — none of these auto-flip each other. Board is the default
    // surface; the old Calendar (weekly) layout was removed as it was
    // not usable for task management.
    const [viewLayout, setViewLayout] = useState('board')
    // Board-only: lay tasks out in per-assignee swimlanes so dragging a
    // card to another row reassigns it. Off by default.
    const [groupByAssignee, setGroupByAssignee] = useState(false)
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
            // No quick filter — page by current week window.
            return taskService.list({
                ...base,
                start_date: weekStartStr,
                end_date: weekEndStr,
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
        // Combine the lookup result sets so selector + cards + swimlanes
        // see the same names — admins always have allActiveUsers; non-
        // admins get the set referenced by visible tasks.
        for (const u of allActiveUsers) map[u.id] = u
        for (const u of usersForTasks) map[u.id] = u
        return map
    }, [usersForTasks, allActiveUsers])

    // ── Optimistic cache helpers for drag/drop status change ──────────────
    // Patch every active ['tasks', ...] query so the card moves the instant
    // it is dropped; rollback restores the snapshot if the server rejects.
    const optimisticPatchTask = async (taskId, patch) => {
        await queryClient.cancelQueries({ queryKey: ['tasks'] })
        const prev = queryClient.getQueriesData({ queryKey: ['tasks'] })
        queryClient.setQueriesData({ queryKey: ['tasks'] }, (old) =>
            Array.isArray(old)
                ? old.map((t) => (t.id === taskId ? { ...t, ...patch } : t))
                : old
        )
        return prev
    }
    const rollbackTasks = (prev) => {
        if (!prev) return
        for (const [key, data] of prev) queryClient.setQueryData(key, data)
    }

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

    // Multi-assignee create — one task per selected user / group member.
    const createBulkMutation = useMutation({
        mutationFn: (data) => taskService.createBulk(data),
        onSuccess: (tasks) => {
            const count = Array.isArray(tasks) ? tasks.length : 0
            message.success(
                `${count} task${count === 1 ? '' : 's'} created.`
            )
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            queryClient.invalidateQueries({ queryKey: ['task-activity'] })
            setCreateOpen(false)
            setEditingTask(null)
        },
        onError: (err) => {
            message.error(
                err?.response?.data?.detail || 'Failed to create tasks.'
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

    // Accept a pending task — moves it into In Progress. This is the
    // first step of the assignee workflow: pending → (accept) →
    // in_progress → (complete) → completed.
    const acceptMutation = useMutation({
        mutationFn: (taskId) => taskService.updateStatus(taskId, 'in_progress'),
        onSuccess: (updated) => {
            message.success('Task accepted — moved to In Progress.')
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            queryClient.invalidateQueries({ queryKey: ['task-activity'] })
            if (reviewTask && reviewTask.id === updated.id) setReviewTask(updated)
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to accept task.')
        },
    })

    // ── Drag-and-drop status change (board) — optimistic. Uses the raw
    // status endpoint (no accept-first guard): a drag is explicit intent,
    // and _apply_status_change keeps completion fields consistent.
    const dndStatusMutation = useMutation({
        mutationFn: ({ id, status }) => taskService.updateStatus(id, status),
        onMutate: async ({ id, status }) => {
            const prev = await optimisticPatchTask(id, { status })
            return { prev }
        },
        onError: (err, _vars, ctx) => {
            rollbackTasks(ctx?.prev)
            message.error(
                err?.response?.data?.detail || 'Failed to update status.'
            )
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            queryClient.invalidateQueries({ queryKey: ['task-activity'] })
        },
    })

    // Board card dropped onto a status column → status change only.
    // Assignee is fixed at creation (no drag-to-reassign). Permission is
    // re-checked here as defense-in-depth even though the board gates drag.
    const handleCardDrop = async (task, { newStatus }) => {
        if (!newStatus) return
        const canStatus =
            isTaskAdmin ||
            task.assignee_user_id === user?.id ||
            task.assigner_user_id === user?.id
        if (!canStatus) {
            message.info('You are not allowed to change this task status.')
            return
        }
        try {
            await dndStatusMutation.mutateAsync({
                id: task.id,
                status: newStatus,
            })
            // Preserve the Log Time prompt the checkbox flow gives on
            // completion.
            if (newStatus === 'completed') setLogTimeTask(task)
        } catch {
            // toast already shown by the mutation
        }
    }

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
        // meta = { taskId? , isBulk? , isGroup? } — modal decides which.
        if (meta.taskId) {
            await updateMutation.mutateAsync({ id: meta.taskId, data: payload })
            return
        }
        if (meta.isBulk) {
            // Multi-select create (users and/or groups) → bulk endpoint.
            await createBulkMutation.mutateAsync(payload)
            return
        }
        if (meta.isGroup) {
            await createGroupMutation.mutateAsync(payload)
            return
        }
        await createMutation.mutateAsync(payload)
    }

    // Runs the actual status change. Callers must confirm first (the
    // card checkbox routes through a confirm modal; the review modal
    // has its own confirmation).
    const executeToggle = async (task, nextCompleted) => {
        // Workflow gate: a pending task can't be completed directly.
        // The first "complete" action accepts it (→ In Progress); the
        // assignee completes it on the next action.
        if (nextCompleted && task.status === 'pending') {
            await acceptMutation.mutateAsync(task.id)
            return
        }
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

    // Card/list checkbox entry point — opens a confirmation first so an
    // accidental click can't change the task's state.
    const handleToggleCompletion = (task, nextCompleted) => {
        setPendingToggle({ task, nextCompleted })
    }

    const handleConfirmToggle = async () => {
        if (!pendingToggle) return
        const { task, nextCompleted } = pendingToggle
        await executeToggle(task, nextCompleted)
        setPendingToggle(null)
    }

    const handleAcceptTask = async (task) => {
        await acceptMutation.mutateAsync(task.id)
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
        // Already confirmed inside the review modal — run directly.
        // Closes review, flips status, and auto-opens Log Time on success.
        setReviewTask(null)
        await executeToggle(task, true)
    }

    const handleReviewReject = async (task) => {
        await rejectMutation.mutateAsync(task.id)
    }

    const handleReviewReopen = async (task) => {
        if (task.status === 'completed') {
            // Undo an accidental completion → back to In Progress
            // (no need to re-accept your own work).
            const updated = await completionMutation.mutateAsync({
                id: task.id,
                completed: false,
            })
            if (updated?.id) setReviewTask(updated)
        } else {
            // Rejected → back to Pending (must be re-accepted).
            await reopenMutation.mutateAsync(task.id)
        }
    }

    const handleClearFilters = () => {
        setStatusFilter(null)
        setPriorityFilter(null)
        setCustomerFilter(null)
        setProjectFilter(null)
        setSubProjectFilter(null)
    }

    // Create requires assign permission AND at least one assignable
    // target (user OR group). Previously this only counted
    // assignableUserIds, which hid Create from users who could only
    // assign through a group mapping — and also hid it from anyone
    // whose direct user→user mappings had been wiped by an earlier
    // permission OFF cascade.
    const canCreateTask =
        isTaskAdmin ||
        (canAssignTasks &&
            (assignableUserIds.length > 0 || assignableGroupIds.length > 0))

    // Compute BEFORE the no-access early return below — useMemo is a
    // hook and must run in the same order on every render. Cold-load
    // of /tasks starts with canAccessTasks=false (permissions still
    // fetching) and flips to true once they resolve; hopping over a
    // hook between those two renders triggers React #310.
    const userSelectorOptions = useMemo(() => {
        if (!user?.id) return []
        const me = { value: user.id, label: user.full_name || 'Me' }
        if (!isTaskAdmin) return [me]
        const others = allActiveUsers
            .filter((u) => u.id !== user.id)
            .map((u) => ({ value: u.id, label: u.full_name || u.email }))
        return [me, ...others]
    }, [user, isTaskAdmin, allActiveUsers])

    if (!canAccessTasks) {
        return (
            <div style={{ padding: 24 }}>
                <Empty description="You do not have access to the Tasks module." />
            </div>
        )
    }

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
                    {/* Layout tabs — Board (default) and List. The
                        Calendar (weekly) layout was removed. */}
                    <div className="tasks-tabs">
                        <span
                            className={`tasks-tab-link ${
                                viewLayout === 'board' ? 'active' : ''
                            }`}
                            onClick={() => setViewLayout('board')}
                        >
                            Board
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
                    {/* Per-assignee swimlanes — only meaningful when
                        monitoring multiple assignees (Assigned by Me).
                        The slot is ALWAYS rendered (hidden via visibility
                        when not applicable) so switching Board/List or
                        scope never shifts the search box and tab links. */}
                    {(() => {
                        const showGroupBy =
                            viewLayout === 'board' &&
                            taskScope === 'assigned-by-me'
                        return (
                            <div
                                className="tasks-groupby-slot"
                                aria-hidden={!showGroupBy}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 24,
                                    visibility: showGroupBy
                                        ? 'visible'
                                        : 'hidden',
                                }}
                            >
                                <div className="tasks-tabs-divider" />
                                <label
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 8,
                                        cursor: 'pointer',
                                        color: 'var(--c-text-muted)',
                                        fontSize: 13,
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    <Switch
                                        size="small"
                                        checked={groupByAssignee}
                                        onChange={setGroupByAssignee}
                                        disabled={!showGroupBy}
                                    />
                                    Group by assignee
                                </label>
                            </div>
                        )
                    })()}
                    {/* Create lives inside the Board view toolbar
                        ("+ New Task"), wired to handleCreate. */}
                </div>
            </div>

            {/* Quick filter chip strip — secondary control, layers
                on top of the active scope. Single-select; clicking
                the active chip clears it. Independent of layout.
                A "Clear" pill appears at the end whenever a quick
                filter is active so users can drop the secondary
                filter without remembering which chip was on. The
                primary scope (My Tasks / Assigned by Me) is not a
                filter and is unaffected by Clear. */}
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
                {taskQuickFilter !== null && (
                    <button
                        type="button"
                        className="tasks-quickfilter-clear"
                        aria-label="Clear quick filter"
                        onClick={() => {
                            // Scoped to the quick-filter chip strip:
                            // only clears Due/Overdue/Completed. The
                            // My Tasks vs Assigned by Me scope is
                            // primary navigation, not a filter, and
                            // stays put. Layout and the cross-filter
                            // dropdowns are also untouched.
                            setTaskQuickFilter(null)
                        }}
                    >
                        <CloseOutlined />
                        Clear
                    </button>
                )}
            </div>

            {/* Week navigation row — applies to both Board and List.
                Without a quick filter active, the views page by this
                week window, so the pager lets users reach other weeks
                (the old Calendar layout used to own this control). */}
            {!taskQuickFilter && (
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
                        <span style={{ color: 'var(--c-text-strong)', fontWeight: 500 }}>
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
                style={{ marginBottom: 16, background: 'var(--c-surface-raised)', borderColor: 'var(--c-border)' }}
            >
                <Space wrap>
                    <FilterOutlined style={{ color: 'var(--c-text-muted)' }} />
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

            {/* View + docked detail panel sit side by side. Clicking a card
                opens the panel on the right; the board/list area shrinks. */}
            <div className="tasks-view-row">
            <div className="tasks-view-main">
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
                    onOpenPanel={(t) => setPanelTask(t)}
                    /* Status changes only in My Tasks (the assignee acts);
                       Assigned by Me is read-only monitoring. */
                    allowStatusChange={taskScope === 'my-tasks'}
                />
            ) : (
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
                    onCreate={handleCreate}
                    /* Creating a task = assigning it to someone, which only
                       makes sense in the "Assigned by Me" scope. In "My
                       Tasks" you view work assigned TO you, so the create
                       button is hidden there. */
                    canCreate={canCreateTask && taskScope === 'assigned-by-me'}
                    /* Swimlanes only matter when viewing many assignees
                       (Assigned by Me); in My Tasks it's always one lane. */
                    groupByAssignee={
                        groupByAssignee && taskScope === 'assigned-by-me'
                    }
                    /* Status changes belong to the assignee in their own
                       My Tasks view. Assigned by Me is read-only monitoring. */
                    allowStatusDrag={taskScope === 'my-tasks'}
                    onCardDrop={handleCardDrop}
                    onOpenPanel={(t) => setPanelTask(t)}
                />
            )}
            </div>
            {panelTask && (
                <TaskDetailPanel
                    task={panelTask}
                    userMap={userMap}
                    currentUserId={user?.id}
                    isAdmin={isTaskAdmin}
                    onClose={() => setPanelTask(null)}
                    onOpenReview={(t) => {
                        setPanelTask(null)
                        handleOpenReview(t)
                    }}
                />
            )}
            </div>

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
                    createGroupMutation.isPending ||
                    createBulkMutation.isPending
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
                    // Status actions live in My Tasks (the assignee acts on
                    // their own work). In Assigned by Me the assigner only
                    // monitors progress — the modal is read-only there.
                    taskScope === 'my-tasks' &&
                    (isTaskAdmin ||
                        reviewTask.assignee_user_id === user?.id ||
                        reviewTask.assigner_user_id === user?.id)
                }
                onAccept={handleAcceptTask}
                onMarkCompleted={handleReviewMarkCompleted}
                onReject={handleReviewReject}
                onReopen={handleReviewReopen}
                actionLoading={
                    rejectMutation.isPending ||
                    reopenMutation.isPending ||
                    completionMutation.isPending ||
                    acceptMutation.isPending
                }
                currentUserId={user?.id}
                isAdmin={isTaskAdmin}
            />

            {/* Confirmation for checkbox-driven status changes (accept /
                complete / reopen) — same dialog pattern as delete so an
                accidental click can't silently change a task's state. */}
            {(() => {
                if (!pendingToggle) return null
                const { task, nextCompleted } = pendingToggle
                const isAccept = nextCompleted && task.status === 'pending'
                const cfg = isAccept
                    ? {
                          title: 'Accept this task?',
                          body: 'The task will move to In Progress so you can start working on it.',
                          confirmLabel: 'Accept Task',
                          icon: <PlayCircleOutlined />,
                      }
                    : nextCompleted
                    ? {
                          title: 'Mark task as completed?',
                          body: 'This marks the task as completed. You can reopen it afterwards if needed.',
                          confirmLabel: 'Mark as Completed',
                          icon: <CheckCircleOutlined />,
                      }
                    : {
                          title: 'Reopen this task?',
                          body: 'The task will move back to In Progress so it can be worked on again.',
                          confirmLabel: 'Reopen',
                          icon: <UndoOutlined />,
                      }
                return (
                    <DangerConfirmModal
                        open={!!pendingToggle}
                        tone="primary"
                        badgeIcon={cfg.icon}
                        confirmIcon={cfg.icon}
                        title={cfg.title}
                        body={cfg.body}
                        itemName={task.title}
                        itemSubtitle={
                            [task.customer_name, task.project_name]
                                .filter(Boolean)
                                .join(' · ') || undefined
                        }
                        confirmLabel={cfg.confirmLabel}
                        onCancel={() => setPendingToggle(null)}
                        onConfirm={handleConfirmToggle}
                        loading={
                            completionMutation.isPending ||
                            acceptMutation.isPending
                        }
                    />
                )
            })()}

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
                        background: 'var(--c-surface-2)',
                        border: '1px solid var(--c-border)',
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
                            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--c-text-strong)' }}>
                                Delete Task
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--c-text-muted)', marginTop: 2 }}>
                                The task will be archived and removed from the calendar.
                            </div>
                        </div>
                    </div>

                    {deletingTask && (
                        <div
                            style={{
                                background: 'var(--c-border)',
                                border: '1px solid var(--c-border-strong)',
                                borderRadius: 8,
                                padding: '10px 14px',
                            }}
                        >
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>
                                {deletingTask.title}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--c-text-muted)', marginTop: 3 }}>
                                {deletingTask.customer_name || '—'}
                                {deletingTask.project_name
                                    ? ` · ${deletingTask.project_name}`
                                    : ''}
                            </div>
                        </div>
                    )}

                    <p style={{ margin: 0, color: 'var(--c-text-muted)', fontSize: 14, lineHeight: 1.6 }}>
                        Are you sure you want to delete this task?
                    </p>

                    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                        <Button
                            onClick={() => setDeletingTask(null)}
                            style={{
                                background: 'transparent',
                                borderColor: 'var(--c-border-strong)',
                                color: 'var(--c-text)',
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
