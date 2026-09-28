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

import { Link } from 'react-router-dom'
import { Tabs, Tooltip } from 'antd'
import { BellFilled, BellOutlined, CloseOutlined, EyeOutlined } from '@ant-design/icons'

import { ActivityTimeline } from '../modals/TaskReviewModal'
import TaskCommentsThread from './TaskCommentsThread'
import TaskAttachmentsTab from './TaskAttachmentsTab'
import { AssignmentRoster } from '../../features/tasks/components/AssigneeStatusBadge'
import { aggregateStatus } from '../../features/tasks/model/grouping'
import { useT } from '../../i18n'

// Ton → ortak lq-tag paleti; metin i18n'den (kartla ayni anahtarlar).
const PRIORITY_TONE = { medium: 'info', high: 'warn', urgent: 'bad' }
const STATUS_TONE = { in_progress: 'info', completed: 'ok', rejected: 'bad' }

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

/** B5: satirdaki takipciler (participants[].role === 'watcher'). */
const watchersOf = (task) =>
    Array.isArray(task?.participants)
        ? task.participants.filter((p) => p?.role === 'watcher')
        : []

function DetailsBody({ task, userMap, assignments }) {
    const t = useT()
    const watchers = watchersOf(task)
    /*
     * §12: coklu atamada detay, BUTUN assignee'leri ve her birinin
     * BIREYSEL durumunu eksiksiz gostermeli. Aggregate durum ayrica
     * gorunur — kartin hangi sutunda durdugu buradan da anlasilir.
     * Tek atamada onceki gorunum aynen korunur.
     */
    const isGrouped = Array.isArray(assignments) && assignments.length > 1
    return (
        <div className="tdp-tab-body">
            <Row label={t('entity.customer')}>{task.customer_name || '—'}</Row>
            <Row label={t('entity.project')}>{task.project_name || '—'}</Row>
            {task.sub_project_name && (
                <Row label={t('task.subProject')}>{task.sub_project_name}</Row>
            )}
            <Row label={t('review.assigner')}>
                {userLabel(task.assigner_user_id, userMap)}
            </Row>
            {isGrouped ? (
                <Row label={`${t('taskUi.assignees')} (${assignments.length})`}>
                    <AssignmentRoster assignments={assignments} />
                </Row>
            ) : (
                <Row label={t('review.assignee')}>
                    {userLabel(task.assignee_user_id, userMap)}
                </Row>
            )}
            {watchers.length > 0 && (
                <Row label={`${t('taskUi.watchers')} (${watchers.length})`}>
                    {watchers.map((w) => userLabel(w.user_id, userMap)).join(', ')}
                </Row>
            )}
            <Row label={t('review.scheduled')}>{task.scheduled_date || '—'}</Row>
            {task.due_date && <Row label={t('review.due')}>{task.due_date}</Row>}
            <Row label={t('task.priority')}>
                {task.priority ? (
                    <span className={`lq-tag tdp-tag lq-tag--${PRIORITY_TONE[task.priority] || 'muted'}`}>
                        {t(`taskCard.priority.${task.priority}`)}
                    </span>
                ) : '—'}
            </Row>
            {typeof task.is_billable === 'boolean' && (
                <Row label={t('task.billable')}>
                    {task.is_billable ? t('common.yes') : t('common.no')}
                </Row>
            )}
            {task.parent_key && (
                <Row label={t('task.parentItem')}>{task.parent_key}</Row>
            )}
            {task.origin_type === 'ticket' && task.origin_ref_id && (
                <Row label={t('task.origin')}>
                    <Link to={`/tickets?ticket=${task.origin_ref_id}`}>
                        {t('task.originTicket')}
                    </Link>
                </Row>
            )}
            {task.subtask_count > 0 && (
                <Row label={t('task.subItems')}>
                    {`${task.subtask_done_count || 0} / ${task.subtask_count}`}
                </Row>
            )}
            <Row label={isGrouped ? t('taskUi.aggregateStatus') : t('common.status')}>
                {(() => {
                    const v = isGrouped ? aggregateStatus(assignments) : task.status
                    return (
                        <span className={`lq-tag tdp-tag lq-tag--${STATUS_TONE[v] || 'muted'}`}>
                            {t(`taskCard.status.${v}`)}
                        </span>
                    )
                })()}
            </Row>
            {task.description && (
                <div className="tdp-desc">
                    <div className="tdp-desc-label">{t('common.description')}</div>
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
    /** Coklu atamali logical work item'in TUM gorunur assignment'lari. */
    assignments = null,
    /** B5: takip et / birak — verilmezse dugme cizilmez (salt okunur). */
    onToggleWatch,
    watchPending = false,
}) {
    const t = useT()
    if (!task) return null
    const isWatching = watchersOf(task).some(
        (w) => String(w.user_id) === String(currentUserId)
    )
    return (
        <aside className="task-detail-panel" aria-label={t('taskUi.taskDetails')}>
            <div className="tdp-head">
                <div className="tdp-head-titles">
                    {task.task_code && (
                        <span className="tdp-code">{task.task_code}</span>
                    )}
                    <div className="tdp-title">{task.title}</div>
                </div>
                <div className="tdp-head-actions">
                    {onToggleWatch && currentUserId && (
                        <Tooltip title={isWatching ? t('taskUi.unwatch') : t('taskUi.watch')}>
                            <button
                                type="button"
                                className={`tdp-icon-btn${isWatching ? ' is-active' : ''}`}
                                disabled={watchPending}
                                aria-pressed={isWatching}
                                onClick={() => onToggleWatch(task, {
                                    userId: currentUserId, watching: isWatching,
                                })}
                                aria-label={isWatching ? t('taskUi.unwatch') : t('taskUi.watch')}
                            >
                                {isWatching ? <BellFilled /> : <BellOutlined />}
                            </button>
                        </Tooltip>
                    )}
                    {onOpenReview && (
                        <Tooltip title={t('taskUi.openFullReview')}>
                            <button
                                type="button"
                                className="tdp-icon-btn"
                                onClick={() => onOpenReview(task)}
                                aria-label={t('taskUi.openFullReview')}
                            >
                                <EyeOutlined />
                            </button>
                        </Tooltip>
                    )}
                    <Tooltip title={t('common.close')}>
                        <button
                            type="button"
                            className="tdp-icon-btn"
                            onClick={onClose}
                            aria-label={t('taskUi.closePanel')}
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
                        label: t('review.details'),
                        children: (
                            <DetailsBody
                                task={task}
                                userMap={userMap}
                                assignments={assignments}
                            />
                        ),
                    },
                    {
                        key: 'activity',
                        label: t('review.activity'),
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
                        label: t('review.comments'),
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
                    {
                        // F1: ekler — yalniz sekme aktifken mount (tembel).
                        key: 'attachments',
                        label: t('task.attachments'),
                        children: (
                            <TaskAttachmentsTab
                                taskId={task.work_item_id || task.id}
                            />
                        ),
                    },
                ]}
            />
        </aside>
    )
}

export default TaskDetailPanel
