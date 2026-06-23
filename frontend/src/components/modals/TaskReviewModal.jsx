/**
 * =============================================================================
 * HERMES - Task Review Modal
 * =============================================================================
 * Read-only task detail view + completion/rejection decision actions.
 * Replaces the legacy TaskNoteModal — assignee notes are no longer part
 * of the Tasks flow.
 *
 * Action visibility:
 *   - status pending / in_progress + canAct → Mark as Completed (primary)
 *                                              + Reject Task (danger)
 *   - status completed                     → read-only details +
 *                                              completion banner
 *   - status rejected                      → read-only details + rejected
 *                                              banner + Reopen (canAct)
 *
 * `canAct` = assignee, assigner, or admin (same gate the backend
 * enforces). Unrelated viewers see only the details.
 * =============================================================================
 */

import { useState } from 'react'
import { Alert, Button, Modal, Space, Spin, Tabs, Tag, Typography } from 'antd'
import {
    CheckCircleOutlined,
    CloseCircleOutlined,
    UndoOutlined,
    PlayCircleOutlined,
    ExclamationCircleOutlined,
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'

import DangerConfirmModal from '../common/DangerConfirmModal'
import { taskService } from '../../services/api'
import TaskCommentsThread from '../tasks/TaskCommentsThread'
import './TaskReviewModal.css'

const { Text, Paragraph } = Typography

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
    rejected: 'magenta',
}

const STATUS_LABEL = {
    pending: 'Pending',
    in_progress: 'In Progress',
    completed: 'Completed',
    cancelled: 'Cancelled',
    rejected: 'Rejected',
}

function userLabel(id, userMap) {
    if (!id) return '—'
    const u = userMap?.[id]
    return u?.full_name || u?.email || id
}

/**
 * Compact "x ago" formatter — keeps us off the optional dayjs
 * relativeTime plugin so the bundle stays the same size.
 */
function relativeTimeShort(iso) {
    if (!iso) return ''
    const then = dayjs(iso)
    const now = dayjs()
    const diffSec = now.diff(then, 'second')
    if (diffSec < 60) return 'just now'
    const diffMin = now.diff(then, 'minute')
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHr = now.diff(then, 'hour')
    if (diffHr < 24) return `${diffHr}h ago`
    const diffDay = now.diff(then, 'day')
    if (diffDay < 7) return `${diffDay}d ago`
    return then.format('YYYY-MM-DD HH:mm')
}

const STATUS_HUMAN = {
    pending: 'pending',
    in_progress: 'in progress',
    completed: 'completed',
    rejected: 'rejected',
    cancelled: 'cancelled',
}

function describeActivityEvent(event) {
    const t = event?.event_type
    const d = event?.event_data || {}
    switch (t) {
        case 'task_created':
            return 'created the task'
        case 'task_updated':
            return 'updated the task'
        case 'task_completed':
            return 'marked the task as completed'
        case 'task_rejected':
            return 'rejected the task'
        case 'task_reopened':
            return 'reopened the task'
        case 'task_deleted':
            return 'deleted the task'
        case 'task_status_changed':
            return `changed status to ${STATUS_HUMAN[d.to] || d.to || 'unknown'}`
        case 'comment_added':
            return 'added a comment'
        case 'comment_updated':
            return 'updated a comment'
        case 'comment_deleted':
            return 'deleted a comment'
        case 'log_time_created': {
            const hours = d.duration_hours
            const label =
                hours != null ? `logged ${Number(hours).toFixed(2)} h` : 'logged time'
            const date = d.date_worked ? ` for ${d.date_worked}` : ''
            return `${label}${date}`
        }
        default:
            // Defensive fallback for any future event type we forget
            // to map: humanize by replacing underscores with spaces.
            // We never want raw snake_case keys to surface in the UI.
            return (t || 'activity').replace(/_/g, ' ')
    }
}

export function ActivityTimeline({ taskId, userMap }) {
    const { data: events = [], isLoading } = useQuery({
        queryKey: ['task-activity', taskId],
        queryFn: () => taskService.listActivity(taskId),
        enabled: !!taskId,
        staleTime: 30 * 1000,
    })

    if (isLoading) {
        return (
            <div style={{ textAlign: 'center', padding: 12 }}>
                <Spin size="small" />
            </div>
        )
    }
    if (events.length === 0) {
        return (
            <div style={{ color: 'var(--c-text-muted)', fontSize: 12, padding: '4px 0' }}>
                No activity yet.
            </div>
        )
    }
    return (
        <div className="task-activity-timeline">
            {events.map((e) => (
                <div key={e.id} className="task-activity-event">
                    <div className="task-activity-dot" />
                    <div className="task-activity-body">
                        <div className="task-activity-line">
                            <span className="task-activity-actor">
                                {userLabel(e.actor_user_id, userMap)}
                            </span>{' '}
                            <span className="task-activity-text">
                                {describeActivityEvent(e)}
                            </span>
                        </div>
                        <div
                            className="task-activity-time"
                            title={dayjs(e.created_at).format(
                                'YYYY-MM-DD HH:mm:ss'
                            )}
                        >
                            {relativeTimeShort(e.created_at)}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    )
}

function Row({ label, children }) {
    return (
        <div style={{ display: 'flex', gap: 12, padding: '6px 0' }}>
            <Text style={{ width: 130, color: 'var(--c-text-muted)' }}>{label}</Text>
            <div style={{ flex: 1, color: 'var(--c-text-strong)' }}>{children}</div>
        </div>
    )
}

function TaskReviewModal({
    open,
    task,
    userMap = {},
    onClose,
    canAct = false,
    onAccept,
    onMarkCompleted,
    onReject,
    onReopen,
    actionLoading = false,
    currentUserId,
    isAdmin = false,
}) {
    // Which action is awaiting confirmation: 'accept' | 'complete' |
    // 'reject' | 'reopen' | null. Every state-changing action routes
    // through a confirmation dialog (same pattern as delete).
    const [confirmType, setConfirmType] = useState(null)

    if (!task) return null

    const status = task.status
    const isCompleted = status === 'completed'
    const isRejected = status === 'rejected'
    const isPending = status === 'pending'
    const isInProgress = status === 'in_progress'
    const isOpenStatus = isPending || isInProgress

    const CONFIRM = {
        accept: {
            tone: 'primary',
            badgeIcon: <PlayCircleOutlined />,
            confirmIcon: <PlayCircleOutlined />,
            title: 'Accept this task?',
            body: 'The task will move to In Progress so you can start working on it.',
            confirmLabel: 'Accept Task',
            action: onAccept,
        },
        complete: {
            tone: 'primary',
            badgeIcon: <CheckCircleOutlined />,
            confirmIcon: <CheckCircleOutlined />,
            title: 'Mark task as completed?',
            body: 'This marks the task as completed. You can reopen it afterwards if needed.',
            confirmLabel: 'Mark as Completed',
            action: onMarkCompleted,
        },
        reject: {
            tone: 'danger',
            badgeIcon: <ExclamationCircleOutlined />,
            confirmIcon: <CloseCircleOutlined />,
            title: 'Reject task?',
            body: 'This will mark the task as not completed. Are you sure you want to continue?',
            confirmLabel: 'Reject Task',
            action: onReject,
        },
        reopen: {
            tone: 'primary',
            badgeIcon: <UndoOutlined />,
            confirmIcon: <UndoOutlined />,
            title: 'Reopen this task?',
            body: isCompleted
                ? 'The task will move back to In Progress so it can be worked on again.'
                : 'The task will move back to Pending so it can be re-accepted.',
            confirmLabel: 'Reopen',
            action: onReopen,
        },
    }
    const activeConfirm = confirmType ? CONFIRM[confirmType] : null

    const handleConfirm = async () => {
        const cfg = CONFIRM[confirmType]
        if (cfg?.action) await cfg.action(task)
        setConfirmType(null)
    }

    return (
        <>
            <Modal
                title={
                    task.task_code
                        ? `${task.task_code} · ${task.title}`
                        : `Review Task · ${task.title}`
                }
                open={open}
                onCancel={onClose}
                footer={null}
                width={560}
                className="task-review-modal"
                destroyOnClose
            >
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    {isCompleted && (
                        <Alert
                            type="success"
                            showIcon
                            icon={<CheckCircleOutlined />}
                            message={
                                <span>
                                    <Tag color="green" style={{ marginRight: 8 }}>
                                        COMPLETED
                                    </Tag>
                                    {task.completed_at
                                        ? `on ${dayjs(task.completed_at).format(
                                              'YYYY-MM-DD HH:mm'
                                          )}`
                                        : null}
                                    {task.completed_by_user_id
                                        ? ` by ${userLabel(
                                              task.completed_by_user_id,
                                              userMap
                                          )}`
                                        : null}
                                </span>
                            }
                        />
                    )}
                    {isRejected && (
                        <Alert
                            type="error"
                            showIcon
                            icon={<CloseCircleOutlined />}
                            message={
                                <Tag color="magenta" style={{ marginRight: 8 }}>
                                    REJECTED
                                </Tag>
                            }
                        />
                    )}

                    <Tabs
                        defaultActiveKey="details"
                        items={[
                            {
                                key: 'details',
                                label: 'Details',
                                children: (
                                    <div className="task-review-tab-body">
                                        <Row label="Customer">
                                            {task.customer_name || '—'}
                                        </Row>
                                        <Row label="Project">
                                            {task.project_name || '—'}
                                        </Row>
                                        {task.sub_project_name && (
                                            <Row label="Sub Project">
                                                {task.sub_project_name}
                                            </Row>
                                        )}
                                        <Row label="Assigner">
                                            {userLabel(
                                                task.assigner_user_id,
                                                userMap
                                            )}
                                        </Row>
                                        <Row label="Assignee">
                                            {userLabel(
                                                task.assignee_user_id,
                                                userMap
                                            )}
                                        </Row>
                                        <Row label="Scheduled">
                                            {task.scheduled_date || '—'}
                                        </Row>
                                        {task.due_date && (
                                            <Row label="Due">
                                                {task.due_date}
                                            </Row>
                                        )}
                                        <Row label="Priority">
                                            <Tag
                                                color={
                                                    PRIORITY_COLOR[
                                                        task.priority
                                                    ] || 'default'
                                                }
                                            >
                                                {task.priority}
                                            </Tag>
                                        </Row>
                                        <Row label="Status">
                                            <Tag
                                                color={
                                                    STATUS_COLOR[status] ||
                                                    'default'
                                                }
                                            >
                                                {STATUS_LABEL[status] || status}
                                            </Tag>
                                        </Row>
                                        {task.description && (
                                            <div style={{ marginTop: 10 }}>
                                                <Text style={{ color: 'var(--c-text-muted)' }}>
                                                    Description
                                                </Text>
                                                <Paragraph
                                                    style={{
                                                        color: 'var(--c-text-strong)',
                                                        background: 'var(--c-surface-raised)',
                                                        border:
                                                            '1px solid var(--c-border)',
                                                        borderRadius: 6,
                                                        padding: 10,
                                                        marginTop: 4,
                                                        whiteSpace: 'pre-wrap',
                                                    }}
                                                >
                                                    {task.description}
                                                </Paragraph>
                                            </div>
                                        )}
                                    </div>
                                ),
                            },
                            {
                                key: 'activity',
                                label: 'Activity',
                                children: (
                                    <div className="task-review-tab-body">
                                        <ActivityTimeline
                                            taskId={task.id}
                                            userMap={userMap}
                                        />
                                    </div>
                                ),
                            },
                            {
                                key: 'comments',
                                label: 'Comments',
                                children: (
                                    <div className="task-review-tab-body">
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

                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 8,
                            flexWrap: 'wrap',
                            paddingTop: 4,
                        }}
                    >
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {canAct && isOpenStatus && (
                                <>
                                    {isPending ? (
                                        <Button
                                            type="primary"
                                            icon={<PlayCircleOutlined />}
                                            disabled={actionLoading}
                                            onClick={() => setConfirmType('accept')}
                                        >
                                            Accept Task
                                        </Button>
                                    ) : (
                                        <Button
                                            type="primary"
                                            icon={<CheckCircleOutlined />}
                                            disabled={actionLoading}
                                            onClick={() => setConfirmType('complete')}
                                        >
                                            Mark as Completed
                                        </Button>
                                    )}
                                    <Button
                                        danger
                                        icon={<CloseCircleOutlined />}
                                        disabled={actionLoading}
                                        onClick={() => setConfirmType('reject')}
                                    >
                                        Reject Task
                                    </Button>
                                </>
                            )}
                            {canAct && (isRejected || isCompleted) && onReopen && (
                                <Button
                                    icon={<UndoOutlined />}
                                    disabled={actionLoading}
                                    onClick={() => setConfirmType('reopen')}
                                >
                                    Reopen
                                </Button>
                            )}
                        </div>
                        <Button onClick={onClose}>Close</Button>
                    </div>
                </Space>
            </Modal>

            <DangerConfirmModal
                open={!!activeConfirm}
                tone={activeConfirm?.tone}
                badgeIcon={activeConfirm?.badgeIcon}
                confirmIcon={activeConfirm?.confirmIcon}
                title={activeConfirm?.title}
                body={activeConfirm?.body}
                itemName={task.title}
                itemSubtitle={
                    [task.customer_name, task.project_name]
                        .filter(Boolean)
                        .join(' · ') || undefined
                }
                confirmLabel={activeConfirm?.confirmLabel}
                onCancel={() => setConfirmType(null)}
                onConfirm={handleConfirm}
                loading={actionLoading}
            />
        </>
    )
}

export default TaskReviewModal
