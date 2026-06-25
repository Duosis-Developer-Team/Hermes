/**
 * =============================================================================
 * HERMES - Task Detail Side Panel
 * =============================================================================
 * Docked panel shown beside the board/list when a task card is clicked
 * (NOT a modal). Surfaces Details / Activity / Comments inline so the user
 * can read a task without losing the board context. The card's "Review"
 * (eye) button still opens the full modal with the decision actions.
 *
 * Reuses ActivityTimeline (from TaskReviewModal) and TaskCommentsThread so
 * there is a single source of truth for those surfaces.
 * =============================================================================
 */

import { Tabs, Tag, Tooltip } from 'antd'
import { CloseOutlined, EyeOutlined } from '@ant-design/icons'

import { ActivityTimeline } from '../modals/TaskReviewModal'
import TaskCommentsThread from './TaskCommentsThread'

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
    rejected: 'red',
    cancelled: 'default',
}
const STATUS_LABEL = {
    pending: 'Pending',
    in_progress: 'In Progress',
    completed: 'Completed',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
}

function userLabel(id, userMap) {
    if (!id) return '—'
    const u = userMap?.[id]
    return u?.full_name || u?.email || '—'
}

function Row({ label, children }) {
    return (
        <div className="tdp-row">
            <span className="tdp-row-label">{label}</span>
            <span className="tdp-row-value">{children}</span>
        </div>
    )
}

function DetailsBody({ task, userMap }) {
    return (
        <div className="tdp-tab-body">
            <Row label="Customer">{task.customer_name || '—'}</Row>
            <Row label="Project">{task.project_name || '—'}</Row>
            {task.sub_project_name && (
                <Row label="Sub Project">{task.sub_project_name}</Row>
            )}
            <Row label="Assigner">
                {userLabel(task.assigner_user_id, userMap)}
            </Row>
            <Row label="Assignee">
                {userLabel(task.assignee_user_id, userMap)}
            </Row>
            <Row label="Scheduled">{task.scheduled_date || '—'}</Row>
            {task.due_date && <Row label="Due">{task.due_date}</Row>}
            <Row label="Priority">
                <Tag color={PRIORITY_COLOR[task.priority] || 'default'}>
                    {task.priority}
                </Tag>
            </Row>
            <Row label="Status">
                <Tag color={STATUS_COLOR[task.status] || 'default'}>
                    {STATUS_LABEL[task.status] || task.status}
                </Tag>
            </Row>
            {task.description && (
                <div className="tdp-desc">
                    <div className="tdp-desc-label">Description</div>
                    <div className="tdp-desc-body">{task.description}</div>
                </div>
            )}
        </div>
    )
}

function TaskDetailPanel({
    task,
    userMap = {},
    currentUserId,
    isAdmin = false,
    onClose,
    onOpenReview,
}) {
    if (!task) return null
    return (
        <aside className="task-detail-panel" aria-label="Task details">
            <div className="tdp-head">
                <div className="tdp-head-titles">
                    {task.task_code && (
                        <span className="tdp-code">{task.task_code}</span>
                    )}
                    <div className="tdp-title">{task.title}</div>
                </div>
                <div className="tdp-head-actions">
                    {onOpenReview && (
                        <Tooltip title="Open full review">
                            <button
                                type="button"
                                className="tdp-icon-btn"
                                onClick={() => onOpenReview(task)}
                                aria-label="Open full review"
                            >
                                <EyeOutlined />
                            </button>
                        </Tooltip>
                    )}
                    <Tooltip title="Close">
                        <button
                            type="button"
                            className="tdp-icon-btn"
                            onClick={onClose}
                            aria-label="Close panel"
                        >
                            <CloseOutlined />
                        </button>
                    </Tooltip>
                </div>
            </div>

            <Tabs
                // Key by task so switching tasks resets to the Details tab
                // and re-mounts the live Activity/Comments queries cleanly.
                key={task.id}
                defaultActiveKey="details"
                className="tdp-tabs"
                items={[
                    {
                        key: 'details',
                        label: 'Details',
                        children: <DetailsBody task={task} userMap={userMap} />,
                    },
                    {
                        key: 'activity',
                        label: 'Activity',
                        children: (
                            <div className="tdp-tab-body">
                                <ActivityTimeline
                                    taskId={task.id}
                                    taskType={task.task_type}
                                    userMap={userMap}
                                />
                            </div>
                        ),
                    },
                    {
                        key: 'comments',
                        label: 'Comments',
                        children: (
                            <div className="tdp-tab-body">
                                <TaskCommentsThread
                                    taskId={task.id}
                                    currentUserId={currentUserId}
                                    isAdmin={isAdmin}
                                    userMap={userMap}
                                />
                            </div>
                        ),
                    },
                ]}
            />
        </aside>
    )
}

export default TaskDetailPanel
