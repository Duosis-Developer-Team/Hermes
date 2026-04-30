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
    Button,
    Card,
    Empty,
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
import CreateTaskModal from '../components/modals/CreateTaskModal'
import TaskDetailModal from '../components/modals/TaskDetailModal'

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
    const [detailTask, setDetailTask] = useState(null)
    const [initialDate, setInitialDate] = useState(null)

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

    const { data: tasks = [], isLoading } = useQuery({
        queryKey: [
            'tasks',
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
        onSuccess: (updated) => {
            message.success('Task updated.')
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            setCreateOpen(false)
            setEditingTask(null)
            setDetailTask(updated)
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to update task.')
        },
    })

    const noteMutation = useMutation({
        mutationFn: ({ id, note }) => taskService.updateNote(id, note),
        onSuccess: (updated) => {
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            setDetailTask(updated)
        },
    })

    const completionMutation = useMutation({
        mutationFn: ({ id, completed }) => taskService.setCompleted(id, completed),
        onSuccess: (updated) => {
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            if (detailTask && detailTask.id === updated.id) {
                setDetailTask(updated)
            }
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to update status.')
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
                <Space>
                    <Button
                        icon={<LeftOutlined />}
                        onClick={() =>
                            setWeekStart((prev) => prev.subtract(1, 'week'))
                        }
                    />
                    <Button onClick={() => setWeekStart(dayjs().startOf('isoWeek'))}>
                        Today
                    </Button>
                    <Button
                        icon={<RightOutlined />}
                        onClick={() => setWeekStart((prev) => prev.add(1, 'week'))}
                    />
                    <span style={{ color: '#fff', fontWeight: 500 }}>
                        {weekStart.format('DD MMM')} – {weekEnd.format('DD MMM, YYYY')}
                    </span>
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
            ) : (
                <TasksWeeklyView
                    weekStart={weekStart}
                    tasks={tasks}
                    userMap={userMap}
                    currentUserId={user?.id}
                    isAdmin={isTaskAdmin}
                    onClickTask={(t) => setDetailTask(t)}
                    onToggleCompletion={handleToggleCompletion}
                    onCreate={handleCreate}
                    canCreate={canCreateTask}
                    completionLoading={completionMutation.isPending}
                />
            )}

            {/* Modals */}
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

            <TaskDetailModal
                open={!!detailTask}
                task={detailTask}
                userMap={userMap}
                currentUserId={user?.id}
                isAdmin={isTaskAdmin}
                onClose={() => setDetailTask(null)}
                onEdit={(t) => {
                    setDetailTask(null)
                    handleEdit(t)
                }}
                onSaveNote={handleSaveNote}
                onToggleComplete={handleToggleCompletion}
                noteSaving={noteMutation.isPending}
                completionSaving={completionMutation.isPending}
            />
        </div>
    )
}

export default TasksPage
