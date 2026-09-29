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
import { Button, Modal, Spin, Tabs } from 'antd'
import {
    BugOutlined,
    BulbOutlined,
    CheckCircleOutlined,
    CheckSquareOutlined,
    CloseCircleOutlined,
    ExclamationCircleOutlined,
    PlayCircleOutlined,
    UndoOutlined,
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'

import DangerConfirmModal from '../common/DangerConfirmModal'
import { taskService } from '../../services/api'
import { typeMeta } from '../../utils/workItemType'
import TaskCommentsThread from '../tasks/TaskCommentsThread'
import { BrandLogos, ModalHead } from '../liquid'
import './TaskReviewModal.css'
import { useT } from '../../i18n'

// Ton → ortak lq-tag paleti; metin i18n'den (kart/panel ile ayni anahtarlar).
const PRIORITY_TONE = { medium: 'info', high: 'warn', urgent: 'bad' }
const STATUS_TONE = { in_progress: 'info', completed: 'ok', rejected: 'bad' }
const TYPE_ICON = {
    task: [<CheckSquareOutlined key="i" />, 'blue'],
    issue: [<BugOutlined key="i" />, 'red'],
    suggestion: [<BulbOutlined key="i" />, 'amber'],
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

function describeActivityEvent(event, noun = 'task') {
    const t = event?.event_type
    const d = event?.event_data || {}
    switch (t) {
        case 'task_created':
            return `created the ${noun}`
        case 'task_updated':
            return `updated the ${noun}`
        case 'task_completed':
            return `marked the ${noun} as completed`
        case 'task_rejected':
            return `rejected the ${noun}`
        case 'task_reopened':
            return `reopened the ${noun}`
        case 'task_deleted':
            return `deleted the ${noun}`
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

export function ActivityTimeline({ taskId, userMap, taskType = 'task' }) {
    const t = useT()
    const noun = typeMeta(taskType).lower
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
            <div style={{ color: 'var(--c-text-muted)', fontSize: 12, padding: '4px 0' }}>{t('review.noActivity')}</div>
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
                                {describeActivityEvent(e, noun)}
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
        <>
            <dt>{label}</dt>
            <dd>{children}</dd>
        </>
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
    const t = useT()
    // Which action is awaiting confirmation: 'accept' | 'complete' |
    // 'reject' | 'reopen' | null. Every state-changing action routes
    // through a confirmation dialog (same pattern as delete).
    const [confirmType, setConfirmType] = useState(null)

    if (!task) return null

    // Ture duyarli adlar ("Issue"/"Oneri"); metinler i18n'den.
    const kind = typeMeta(task.task_type).lower in TYPE_ICON ? typeMeta(task.task_type).lower : 'task'
    const noun = { noun: t(`review.noun.${kind}`), Noun: t(`review.nounCap.${kind}`) }

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
            title: t('review.confirm.acceptTitle', noun),
            body: t('review.confirm.acceptBody', noun),
            confirmLabel: t('review.accept', noun),
            action: onAccept,
        },
        complete: {
            tone: 'primary',
            badgeIcon: <CheckCircleOutlined />,
            confirmIcon: <CheckCircleOutlined />,
            title: t('review.confirm.completeTitle', noun),
            body: t('review.confirm.completeBody', noun),
            confirmLabel: t('review.markCompleted'),
            action: onMarkCompleted,
        },
        reject: {
            tone: 'danger',
            badgeIcon: <ExclamationCircleOutlined />,
            confirmIcon: <CloseCircleOutlined />,
            title: t('review.confirm.rejectTitle', noun),
            body: t('review.confirm.rejectBody', noun),
            confirmLabel: t('review.reject', noun),
            action: onReject,
        },
        reopen: {
            tone: 'primary',
            badgeIcon: <UndoOutlined />,
            confirmIcon: <UndoOutlined />,
            title: t('review.confirm.reopenTitle', noun),
            body: isCompleted
                ? t('review.confirm.reopenBodyCompleted', noun)
                : t('review.confirm.reopenBodyRejected', noun),
            confirmLabel: t('review.reopen'),
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
                title={(
                    <ModalHead
                        icon={TYPE_ICON[kind][0]}
                        tone={TYPE_ICON[kind][1]}
                        /* Sol ust: musteri + proje logosu; hic yoksa tur ikonu. */
                        media={(
                            <BrandLogos
                                customerId={task.customer_id}
                                customerName={task.customer_name}
                                projectId={task.project_id}
                                projectName={task.project_name}
                                size={48}
                                fallback={<span className={`lq-mico lq-mico--${TYPE_ICON[kind][1]}`} aria-hidden="true">{TYPE_ICON[kind][0]}</span>}
                            />
                        )}
                        title={task.title}
                        subtitle={[task.task_code, task.customer_name, task.project_name].filter(Boolean).join(' · ')}
                    />
                )}
                open={open}
                onCancel={onClose}
                footer={null}
                width={640}
                className="task-review-modal"
                /* AntD 5.x: destroyOnClose deprecated → destroyOnHidden. */
                destroyOnHidden
            >
                {isCompleted && (
                    <p className="lq-note lq-note--ok" role="status">
                        <CheckCircleOutlined aria-hidden="true" />
                        {task.completed_at
                            ? t('review.completedOn', { date: dayjs(task.completed_at).format('D MMM YYYY HH:mm') })
                            : t('taskCard.status.completed')}
                        {task.completed_by_user_id
                            ? t('review.completedBy', { name: userLabel(task.completed_by_user_id, userMap) })
                            : null}
                    </p>
                )}
                {isRejected && (
                    <p className="lq-note lq-note--bad" role="status">
                        <CloseCircleOutlined aria-hidden="true" /> {t('taskCard.status.rejected')}
                    </p>
                )}

                <Tabs
                    className="task-review-tabs"
                    defaultActiveKey="details"
                    items={[
                        {
                            key: 'details',
                            label: t('review.details'),
                            children: (
                                <div className="task-review-tab-body">
                                    <dl className="lq-kv">
                                        <Row label={t('entity.customer')}>{task.customer_name || '—'}</Row>
                                        <Row label={t('entity.project')}>{task.project_name || '—'}</Row>
                                        {task.sub_project_name && (
                                            <Row label={t('task.subProject')}>{task.sub_project_name}</Row>
                                        )}
                                        <Row label={t('review.assigner')}>{userLabel(task.assigner_user_id, userMap)}</Row>
                                        <Row label={t('review.assignee')}>{userLabel(task.assignee_user_id, userMap)}</Row>
                                        <Row label={t('review.scheduled')}>{task.scheduled_date || '—'}</Row>
                                        {task.due_date && <Row label={t('review.due')}>{task.due_date}</Row>}
                                        <Row label={t('task.priority')}>
                                            {task.priority ? (
                                                <span className={`lq-tag lq-tag--${PRIORITY_TONE[task.priority] || 'muted'}`}>
                                                    {t(`taskCard.priority.${task.priority}`)}
                                                </span>
                                            ) : '—'}
                                        </Row>
                                        <Row label={t('common.status')}>
                                            <span className={`lq-tag lq-tag--${STATUS_TONE[status] || 'muted'}`}>
                                                {t(`taskCard.status.${status}`)}
                                            </span>
                                        </Row>
                                    </dl>
                                    {task.description && (
                                        <>
                                            <h3 className="lq-grp">{t('common.description')}</h3>
                                            <p className="task-review-desc">{task.description}</p>
                                        </>
                                    )}
                                </div>
                            ),
                        },
                        {
                            key: 'activity',
                            label: t('review.activity'),
                            children: (
                                <div className="task-review-tab-body">
                                    <ActivityTimeline
                                        taskId={task.id}
                                        userMap={userMap}
                                        taskType={task.task_type}
                                    />
                                </div>
                            ),
                        },
                        {
                            key: 'comments',
                            label: t('review.comments'),
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

                <div className="lq-mf">
                    <span className="lq-mf__left">
                        {canAct && isOpenStatus && (
                            <Button
                                danger
                                icon={<CloseCircleOutlined />}
                                disabled={actionLoading}
                                onClick={() => setConfirmType('reject')}
                            >{t('review.reject', noun)}</Button>
                        )}
                        {canAct && (isRejected || isCompleted) && onReopen && (
                            <Button
                                icon={<UndoOutlined />}
                                disabled={actionLoading}
                                onClick={() => setConfirmType('reopen')}
                            >{t('review.reopen')}</Button>
                        )}
                    </span>
                    <Button onClick={onClose}>{t('common.close')}</Button>
                    {canAct && isOpenStatus && (isPending ? (
                        <Button
                            type="primary"
                            icon={<PlayCircleOutlined />}
                            disabled={actionLoading}
                            onClick={() => setConfirmType('accept')}
                        >{t('review.accept', noun)}</Button>
                    ) : (
                        <Button
                            type="primary"
                            icon={<CheckCircleOutlined />}
                            disabled={actionLoading}
                            onClick={() => setConfirmType('complete')}
                        >{t('review.markCompleted')}</Button>
                    ))}
                </div>
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
