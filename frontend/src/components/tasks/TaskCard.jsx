/**
 * =============================================================================
 * HERMES - Task Card
 * =============================================================================
 * Mirrors the WorkLogCard look so Tasks reads as a sibling of Time Entry.
 * Receives a `userMap` prop (id → user object) populated by the parent
 * page from a single auth-service /users/lookup call.
 *
 * Variants:
 *   - default    : a normal task card on its scheduled date
 *   - completed  : green/strikethrough state, still clickable
 *   - dueMarker  : compact "Due: …" indicator shown on the due-date column
 * =============================================================================
 */

import { Checkbox, Tooltip } from 'antd'
import { ClockCircleOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import './TaskCard.css'

function formatMinutes(min) {
    if (!min || min <= 0) return null
    const h = Math.floor(min / 60)
    const m = min % 60
    if (h && m) return `${h}h ${m}m`
    if (h) return `${h}h`
    return `${m}m`
}

function userLabel(id, userMap) {
    if (!id) return '—'
    const u = userMap?.[id]
    return u?.full_name || u?.email || id
}

/**
 * Compact due-date marker variant — used on a different day column than
 * the scheduled card.
 */
export function TaskDueMarker({ task, userMap = {}, currentUserId, onClick }) {
    const showAssignee = currentUserId && task.assigner_user_id === currentUserId
    return (
        <div
            className="task-due-marker"
            role="button"
            tabIndex={0}
            onClick={() => onClick?.(task)}
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
    onClick,
    onToggleCompletion,
    canToggleCompletion,
    completionLoading = false,
}) {
    const isCompleted = task.status === 'completed'
    const assigneeIsMe = task.assignee_user_id === currentUserId
    const assignerIsMe = task.assigner_user_id === currentUserId
    const showAssignee = !assigneeIsMe // only show "Assignee:" if I'm not the assignee
    const duration = formatMinutes(task.estimated_duration_minutes)
    const dueDifferent =
        task.due_date && task.due_date !== task.scheduled_date

    const handleCheckboxClick = (event) => {
        event.stopPropagation()
        if (!canToggleCompletion || completionLoading) return
        onToggleCompletion?.(task, !isCompleted)
    }

    const subProjectSegment = task.sub_project_name
        ? ` · ${task.sub_project_name}`
        : ''

    return (
        <div
            className={`task-card${isCompleted ? ' task-card-completed' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => onClick?.(task)}
            onKeyDown={(e) => {
                if (e.key === 'Enter') onClick?.(task)
            }}
        >
            <Tooltip
                title={
                    canToggleCompletion
                        ? isCompleted
                            ? 'Reopen task'
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
                <div className="task-card-title">{task.title}</div>
                <div className="task-card-meta">
                    {task.customer_name || '—'} · {task.project_name || '—'}
                    {subProjectSegment}
                </div>

                <div className="task-card-footer">
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
                    </div>
                    {duration && (
                        <span className="task-card-duration">
                            <ClockCircleOutlined style={{ marginRight: 4 }} />
                            {duration}
                        </span>
                    )}
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
        </div>
    )
}

export default TaskCard
