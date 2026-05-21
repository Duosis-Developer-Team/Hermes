/**
 * =============================================================================
 * HERMES - Task Card
 * =============================================================================
 * Mirrors WorkLogCard interaction model:
 *   - Body click toggles selection for the copy/paste workflow.
 *   - Hover shows Edit (pencil) and Delete (trash) actions in the
 *     top-right corner — same placement and style as Time Entry.
 *   - Edit opens the existing CreateTaskModal in edit mode.
 *   - Delete fires a confirmation flow handled by the parent page.
 *   - The completion checkbox stays on the left.
 *
 * Receives a `userMap` prop (id → user object) populated by the parent
 * page from a single auth-service /users/lookup call.
 *
 * Variants:
 *   - default    : a normal task card on its scheduled date
 *   - completed  : green/strikethrough state, still selectable + clickable
 *   - dueMarker  : compact "Due: …" indicator shown on the due-date column
 * =============================================================================
 */

import { Checkbox, Tooltip } from 'antd'
import {
    DeleteOutlined,
    EditOutlined,
    EyeOutlined,
    FieldTimeOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import './TaskCard.css'

function userLabel(id, userMap) {
    if (!id) return '—'
    const u = userMap?.[id]
    return u?.full_name || u?.email || id
}

/**
 * Returns the due-date severity bucket for a task, or null when the
 * task does not warrant any badge. Completed/rejected tasks never
 * surface as overdue — they're done business, the due date is moot.
 *
 * Exposed for reuse by list and board views.
 */
export function taskDueState(task) {
    if (!task?.due_date) return null
    if (task.status === 'completed' || task.status === 'rejected') return null
    const today = dayjs().startOf('day')
    const due = dayjs(task.due_date).startOf('day')
    const diffDays = due.diff(today, 'day')
    if (diffDays < 0) return 'overdue'
    if (diffDays === 0) return 'due_today'
    if (diffDays <= 2) return 'due_soon'
    return null
}

const DUE_STATE_LABEL = {
    overdue: 'OVERDUE',
    due_today: 'DUE TODAY',
    due_soon: 'DUE SOON',
}

/** Badge component reused across card/list/board surfaces. */
export function TaskDueBadge({ task, compact = false }) {
    const state = taskDueState(task)
    if (!state) return null
    return (
        <span
            className={`task-due-badge task-due-badge-${state}${
                compact ? ' task-due-badge-compact' : ''
            }`}
        >
            {DUE_STATE_LABEL[state]}
        </span>
    )
}

/**
 * Compact due-date marker variant — used on a different day column than
 * the scheduled card. Click opens the same edit flow on the parent page.
 */
export function TaskDueMarker({ task, userMap = {}, currentUserId, onClick }) {
    const showAssignee = currentUserId && task.assigner_user_id === currentUserId
    return (
        <div
            className="task-due-marker"
            role="button"
            tabIndex={0}
            onClick={(e) => {
                e.stopPropagation()
                onClick?.(task)
            }}
            onKeyDown={(e) => {
                if (e.key === 'Enter') onClick?.(task)
            }}
        >
            <span className="task-due-marker-label">Due</span>
            <div className="task-due-marker-title">{task.title}</div>
            <div className="task-due-marker-meta">
                {task.customer_name || '—'}
                {task.project_name ? ` · ${task.project_name}` : ''}
                {showAssignee
                    ? ` · ${userLabel(task.assignee_user_id, userMap)}`
                    : ''}
            </div>
        </div>
    )
}

function TaskCard({
    task,
    userMap = {},
    currentUserId,
    isAdmin = false,
    /** Selection toggle — fired by body click on a non-completed task
        (Time Entry parity). On a completed task body click instead opens
        the Log Time modal via onOpenLogTime. */
    onSelect,
    /** Opens the create/edit modal in edit mode. Hover Edit icon. */
    onEdit,
    /** Hover Delete icon — parent shows the confirm modal. */
    onDelete,
    /** Hover Review icon — opens the read-only Review Task modal that
        also surfaces the Mark as Completed / Reject Task actions. */
    onOpenReview,
    /** Hover Log Time icon (completed only) and body click on completed.
        Parent opens the prefilled Log Time modal. */
    onOpenLogTime,
    onToggleCompletion,
    canToggleCompletion,
    completionLoading = false,
    isSelected = false,
}) {
    const isCompleted = task.status === 'completed'
    const assigneeIsMe = task.assignee_user_id === currentUserId
    const assignerIsMe = task.assigner_user_id === currentUserId
    const canEditCore = isAdmin || assignerIsMe
    const showAssignee = !assigneeIsMe // only show "Assignee:" if I'm not the assignee
    const dueDifferent =
        task.due_date && task.due_date !== task.scheduled_date

    const handleCheckboxClick = (event) => {
        event.stopPropagation()
        if (!canToggleCompletion || completionLoading) return
        onToggleCompletion?.(task, !isCompleted)
    }

    const handleBodyClick = (event) => {
        event.stopPropagation()
        if (isCompleted && onOpenLogTime) {
            onOpenLogTime(task)
            return
        }
        onSelect?.(task.id)
    }

    const handleLogTimeClick = (event) => {
        event.stopPropagation()
        onOpenLogTime?.(task)
    }

    const handleEditClick = (event) => {
        event.stopPropagation()
        onEdit?.(task)
    }

    const handleDeleteClick = (event) => {
        event.stopPropagation()
        onDelete?.(task)
    }

    const handleReviewClick = (event) => {
        event.stopPropagation()
        onOpenReview?.(task)
    }

    const subProjectSegment = task.sub_project_name
        ? ` · ${task.sub_project_name}`
        : ''

    // Completed tasks are not selectable for copy/paste — drop the
    // selected styling and the C badge regardless of stale state.
    const showAsSelected = isSelected && !isCompleted
    const className =
        'task-card' +
        (isCompleted ? ' task-card-completed' : '') +
        (showAsSelected ? ' task-card-selected' : '')

    return (
        <div
            className={className}
            role="button"
            tabIndex={0}
            onClick={handleBodyClick}
            onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                if (isCompleted && onOpenLogTime) {
                    onOpenLogTime(task)
                    return
                }
                onSelect?.(task.id)
            }}
        >
            <Tooltip
                title={
                    canToggleCompletion
                        ? isCompleted
                            ? 'Reopen task'
                            : task.status === 'pending'
                                ? 'Accept task (move to In Progress)'
                                : 'Mark as completed'
                        : 'Only the assignee, assigner, or admin can change completion'
                }
            >
                <Checkbox
                    className="task-card-checkbox"
                    checked={isCompleted}
                    disabled={!canToggleCompletion || completionLoading}
                    onClick={handleCheckboxClick}
                    onChange={() => {}}
                />
            </Tooltip>

            <div className="task-card-body">
                <div className="task-card-title">
                    {task.task_code && (
                        <span className="task-card-code">{task.task_code}</span>
                    )}
                    <span className="task-card-title-text">{task.title}</span>
                </div>
                <div className="task-card-meta">
                    {task.customer_name || '—'} · {task.project_name || '—'}
                    {subProjectSegment}
                </div>

                <div className="task-card-badges">
                    <span
                        className={`task-card-priority task-card-priority-${task.priority}`}
                    >
                        {task.priority}
                    </span>
                    <span
                        className={`task-card-status task-card-status-${task.status}`}
                    >
                        {task.status === 'in_progress'
                            ? 'in progress'
                            : task.status}
                    </span>
                    <TaskDueBadge task={task} />
                </div>

                {dueDifferent && (
                    <div className="task-card-due-hint">
                        Due {dayjs(task.due_date).format('DD MMM')}
                    </div>
                )}

                {showAssignee && task.assignee_user_id && (
                    <div className="task-card-assignee-hint">
                        Assignee: {userLabel(task.assignee_user_id, userMap)}
                    </div>
                )}
                {!showAssignee && task.assigner_user_id && (
                    <div className="task-card-assignee-hint">
                        Assigned by: {userLabel(task.assigner_user_id, userMap)}
                    </div>
                )}
            </div>

            {/* Hover actions — top-right, mirrors WorkLogCard exactly */}
            <div className="task-card-actions">
                {isCompleted && onOpenLogTime && (
                    <Tooltip title="Log Time">
                        <button
                            type="button"
                            className="task-card-action-btn"
                            onClick={handleLogTimeClick}
                        >
                            <FieldTimeOutlined />
                        </button>
                    </Tooltip>
                )}
                <Tooltip title="Review Task">
                    <button
                        type="button"
                        className="task-card-action-btn"
                        onClick={handleReviewClick}
                    >
                        <EyeOutlined />
                    </button>
                </Tooltip>
                {canEditCore && (
                    <>
                        <Tooltip title="Edit">
                            <button
                                type="button"
                                className="task-card-action-btn"
                                onClick={handleEditClick}
                            >
                                <EditOutlined />
                            </button>
                        </Tooltip>
                        <Tooltip title="Delete">
                            <button
                                type="button"
                                className="task-card-action-btn delete"
                                onClick={handleDeleteClick}
                            >
                                <DeleteOutlined />
                            </button>
                        </Tooltip>
                    </>
                )}
            </div>

            {showAsSelected && (
                <div
                    className="task-card-selected-badge"
                    title="Press Ctrl+C to copy"
                >
                    C
                </div>
            )}
        </div>
    )
}

export default TaskCard
