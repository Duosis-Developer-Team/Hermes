/**
 * =============================================================================
 * HERMES - Tasks Board View
 * =============================================================================
 * Status-grouped read-only board: Pending · In Progress · Completed
 * · Rejected. Cards are compact TaskCard reuses so look, hover
 * actions, due-badges, and selection styling all stay consistent with
 * the calendar/list surfaces.
 *
 * Status changes happen via the existing Review Task modal (card
 * click on a non-completed task opens it; the modal exposes Mark as
 * Completed / Reject / Reopen). A future commit can layer drag-and-
 * drop on top — the parent page already owns mutations for every
 * status transition we'd need.
 *
 * Respects the page's view scope (My / Assigned by Me) and admin
 * user-selector implicitly — the board just consumes the tasks
 * array the parent already filtered.
 * =============================================================================
 */

import { useMemo } from 'react'
import { Button } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import TaskCard from './TaskCard'
import './TasksBoardView.css'

const COLUMNS = [
    { status: 'pending', label: 'Pending' },
    { status: 'in_progress', label: 'In Progress' },
    { status: 'completed', label: 'Completed' },
    { status: 'rejected', label: 'Rejected' },
]

function TasksBoardView({
    tasks = [],
    userMap = {},
    currentUserId,
    isAdmin = false,
    onEditTask,
    onDeleteTask,
    onOpenReview,
    onOpenLogTime,
    onToggleCompletion,
    completionLoading = false,
    onCreate,
    canCreate = false,
}) {
    const buckets = useMemo(() => {
        const map = { pending: [], in_progress: [], completed: [], rejected: [] }
        for (const t of tasks) {
            if (map[t.status]) map[t.status].push(t)
        }
        return map
    }, [tasks])

    return (
        <div className="tasks-board-wrap">
            {/* Board toolbar — hosts the primary create action. With the
                Calendar view removed, the per-day "+" buttons are gone, so
                this is now the main entry point for creating a task. Gated
                by the same canCreate permission the page computes. */}
            {canCreate && (
                <div className="tasks-board-toolbar">
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        className="tasks-board-new-btn"
                        onClick={() => onCreate?.()}
                    >
                        New Task
                    </Button>
                </div>
            )}

            <div className="tasks-board">
            {COLUMNS.map(({ status, label }) => {
                const list = buckets[status] || []
                return (
                    <div
                        key={status}
                        className={`tasks-board-column tasks-board-column-${status}`}
                    >
                        <div className="tasks-board-column-header">
                            <span className="tasks-board-column-label">
                                {label}
                            </span>
                            <span className="tasks-board-column-count">
                                {list.length}
                            </span>
                        </div>
                        <div className="tasks-board-column-body">
                            {list.length === 0 ? (
                                <div className="tasks-board-column-empty">
                                    No tasks
                                </div>
                            ) : (
                                list.map((t) => {
                                    const canToggle =
                                        isAdmin ||
                                        t.assignee_user_id === currentUserId ||
                                        t.assigner_user_id === currentUserId
                                    return (
                                        <TaskCard
                                            key={t.id}
                                            task={t}
                                            userMap={userMap}
                                            currentUserId={currentUserId}
                                            isAdmin={isAdmin}
                                            onSelect={() =>
                                                onOpenReview?.(t)
                                            }
                                            onEdit={onEditTask}
                                            onDelete={onDeleteTask}
                                            onOpenReview={onOpenReview}
                                            onOpenLogTime={onOpenLogTime}
                                            onToggleCompletion={
                                                onToggleCompletion
                                            }
                                            canToggleCompletion={canToggle}
                                            completionLoading={
                                                completionLoading
                                            }
                                        />
                                    )
                                })
                            )}
                        </div>
                    </div>
                )
            })}
            </div>
        </div>
    )
}

export default TasksBoardView
