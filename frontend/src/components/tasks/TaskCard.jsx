/**
 * =============================================================================
 * HERMES - Task Card
 * =============================================================================
 * Renders a single task row on the Tasks page. Reuses Hermes Ant Design
 * styling so the card visually matches WorkLogCard / Time Entry list rows.
 * =============================================================================
 */

import { Tag, Tooltip, Checkbox } from 'antd'
import {
    ClockCircleOutlined,
    UserOutlined,
    CalendarOutlined,
} from '@ant-design/icons'

const PRIORITY_COLOR = {
    low: 'default',
    medium: 'blue',
    high: 'orange',
    urgent: 'red',
}

const STATUS_COLOR = {
    pending: 'default',
    in_progress: 'blue',
    completed: 'green',
    cancelled: 'magenta',
}

function formatMinutes(min) {
    if (!min || min <= 0) return null
    const h = Math.floor(min / 60)
    const m = min % 60
    if (h && m) return `${h}h ${m}m`
    if (h) return `${h}h`
    return `${m}m`
}

function TaskCard({
    task,
    currentUserId,
    onClick,
    onToggleCompletion,
    canToggleCompletion,
    completionLoading = false,
}) {
    const isCompleted = task.status === 'completed'
    const assigneeIsMe = task.assignee_user?.id === currentUserId
    const showAssignedBy = assigneeIsMe
    const otherUser = showAssignedBy ? task.assigner_user : task.assignee_user
    const otherLabel = showAssignedBy ? 'Assigned by' : 'Assignee'
    const duration = formatMinutes(task.estimated_duration_minutes)

    const handleCheckboxClick = (event) => {
        event.stopPropagation()
        if (!canToggleCompletion || completionLoading) return
        onToggleCompletion?.(task, !isCompleted)
    }

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => onClick?.(task)}
            onKeyDown={(e) => {
                if (e.key === 'Enter') onClick?.(task)
            }}
            style={{
                background: '#1f1f1f',
                border: '1px solid #303030',
                borderRadius: 8,
                padding: '10px 12px',
                marginBottom: 8,
                cursor: 'pointer',
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
                transition: 'border-color 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#434343')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#303030')}
        >
            <Tooltip
                title={
                    canToggleCompletion
                        ? isCompleted
                            ? 'Reopen task'
                            : 'Mark as completed'
                        : 'Only the assignee or admin can change completion'
                }
            >
                <Checkbox
                    checked={isCompleted}
                    disabled={!canToggleCompletion || completionLoading}
                    onClick={handleCheckboxClick}
                    onChange={() => {}}
                />
            </Tooltip>

            <div style={{ flex: 1, minWidth: 0 }}>
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 8,
                    }}
                >
                    <span
                        style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: isCompleted ? '#888' : '#fff',
                            textDecoration: isCompleted ? 'line-through' : 'none',
                            wordBreak: 'break-word',
                        }}
                    >
                        {task.title}
                    </span>
                    <Tag color={PRIORITY_COLOR[task.priority] || 'default'}>
                        {task.priority}
                    </Tag>
                    <Tag color={STATUS_COLOR[task.status] || 'default'}>
                        {task.status.replace('_', ' ')}
                    </Tag>
                </div>

                <div
                    style={{
                        marginTop: 4,
                        fontSize: 12,
                        color: '#9b9b9b',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 12,
                    }}
                >
                    <span>
                        {task.customer_name || '—'} ·{' '}
                        {task.project_name || '—'}
                        {task.sub_project_name
                            ? ` · ${task.sub_project_name}`
                            : ''}
                    </span>
                    {duration && (
                        <span>
                            <ClockCircleOutlined style={{ marginRight: 4 }} />
                            {duration}
                        </span>
                    )}
                    {task.due_date && task.due_date !== task.scheduled_date && (
                        <span>
                            <CalendarOutlined style={{ marginRight: 4 }} />
                            Due {task.due_date}
                        </span>
                    )}
                    {otherUser && (
                        <span>
                            <UserOutlined style={{ marginRight: 4 }} />
                            {otherLabel}: {otherUser.full_name || otherUser.email || '—'}
                        </span>
                    )}
                </div>
            </div>
        </div>
    )
}

export default TaskCard
