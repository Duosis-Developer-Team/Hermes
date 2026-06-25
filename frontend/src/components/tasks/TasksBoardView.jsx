/**
 * =============================================================================
 * HERMES - Tasks Board View (dynamic assignment kanban)
 * =============================================================================
 * Status-grouped kanban: Pending · In Progress · Completed · Rejected.
 *
 * Dynamic assignment features:
 *   1. Drag-and-drop status change — drag a card between columns. On drop
 *      the parent runs taskService.updateStatus (optimistic). Dropping
 *      into Completed also opens the Log Time modal (parent decides).
 *   2. Quick reassign — an inline assignee dropdown on each card, shown
 *      only to a user who may reassign it (admin or the task's assigner).
 *   3. Swimlanes by assignee — optional "Group by assignee" layout where
 *      each row is one assignee and dragging a card to another row
 *      reassigns it (in addition to any status change from the column).
 *
 * Permissions mirror the backend:
 *   - status change: admin OR assignee OR assigner   (card is draggable)
 *   - reassign:      admin OR assigner               (reassign control /
 *                    cross-swimlane drop)
 *
 * The board only consumes the already-filtered tasks array; scope
 * (My / Assigned by Me) and the admin user-selector are handled upstream.
 * =============================================================================
 */

import { useMemo, useState } from 'react'
import { Avatar, Button, Dropdown } from 'antd'
import { PlusOutlined, UserOutlined, DownOutlined } from '@ant-design/icons'
import {
    DndContext,
    DragOverlay,
    PointerSensor,
    KeyboardSensor,
    useSensor,
    useSensors,
    useDraggable,
    useDroppable,
    closestCorners,
} from '@dnd-kit/core'

import TaskCard from './TaskCard'
import './TasksBoardView.css'

const COLUMNS = [
    { status: 'pending', label: 'Pending' },
    { status: 'in_progress', label: 'In Progress' },
    { status: 'completed', label: 'Completed' },
    { status: 'rejected', label: 'Rejected' },
]

const VALID_STATUSES = new Set([
    'pending',
    'in_progress',
    'completed',
    'rejected',
])

// Droppable cell id encoding. Without swimlanes the id is just the
// status. With swimlanes it is `${assigneeId}__${status}`. Assignee ids
// are UUIDs (no underscores), and status tokens use single underscores
// only ("in_progress"), so splitting on the first "__" is unambiguous.
function cellId(assigneeId, status) {
    return assigneeId ? `${assigneeId}__${status}` : status
}
function parseCellId(id) {
    if (typeof id !== 'string') return null
    const sep = id.indexOf('__')
    if (sep === -1) return { assigneeId: null, status: id }
    return { assigneeId: id.slice(0, sep), status: id.slice(sep + 2) }
}

function userLabel(id, userMap) {
    const u = userMap?.[id]
    return u?.full_name || u?.email || 'Unknown'
}

// ── Draggable wrapper around a TaskCard ─────────────────────────────────
function DraggableCard({ id, disabled, children }) {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id,
        disabled,
    })
    return (
        <div
            ref={setNodeRef}
            className={`tasks-board-draggable${
                isDragging ? ' is-dragging' : ''
            }${disabled ? ' is-locked' : ''}`}
            {...(disabled ? {} : listeners)}
            {...(disabled ? {} : attributes)}
        >
            {children}
        </div>
    )
}

// ── Droppable status column (optionally scoped to one swimlane) ──────────
function DroppableColumn({ id, children }) {
    const { setNodeRef, isOver } = useDroppable({ id })
    return (
        <div
            ref={setNodeRef}
            className={`tasks-board-column-body${isOver ? ' is-over' : ''}`}
        >
            {children}
        </div>
    )
}

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
    // Swimlanes (group by assignee) are a read-only monitoring layout used
    // in "Assigned by Me". allowStatusDrag enables drag-to-change-status —
    // only the assignee's own "My Tasks" view sets it true; the assigner's
    // monitoring view leaves it false (read-only).
    groupByAssignee = false,
    allowStatusDrag = false,
    onCardDrop,
    // Card body click → open the docked detail panel. The Review (eye)
    // hover button still opens the full modal via onOpenReview.
    onOpenPanel,
}) {
    const sensors = useSensors(
        // 6px activation distance so a plain click still opens the Review
        // modal (TaskCard's body click) instead of starting a drag.
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(KeyboardSensor)
    )

    const [activeId, setActiveId] = useState(null)

    const tasksById = useMemo(() => {
        const m = {}
        for (const t of tasks) m[t.id] = t
        return m
    }, [tasks])

    // A card is drag-movable only when status drag is allowed for this
    // view AND the viewer may change this task's status.
    const canDragStatus = (t) =>
        allowStatusDrag &&
        (isAdmin ||
            t.assignee_user_id === currentUserId ||
            t.assigner_user_id === currentUserId)

    // Status buckets (flat board).
    const buckets = useMemo(() => {
        const map = { pending: [], in_progress: [], completed: [], rejected: [] }
        for (const t of tasks) if (map[t.status]) map[t.status].push(t)
        return map
    }, [tasks])

    // Swimlane rows — one per distinct assignee present in the current
    // task set, sorted by display name. Each row keeps its own status
    // buckets so a card lands in the right (assignee, status) cell.
    const swimlanes = useMemo(() => {
        if (!groupByAssignee) return []
        const byAssignee = new Map()
        for (const t of tasks) {
            const key = t.assignee_user_id
            if (!byAssignee.has(key)) {
                byAssignee.set(key, {
                    pending: [],
                    in_progress: [],
                    completed: [],
                    rejected: [],
                })
            }
            const b = byAssignee.get(key)
            if (b[t.status]) b[t.status].push(t)
        }
        return Array.from(byAssignee.entries())
            .map(([assigneeId, b]) => ({
                assigneeId,
                label: userLabel(assigneeId, userMap),
                buckets: b,
            }))
            .sort((a, b) => a.label.localeCompare(b.label))
    }, [groupByAssignee, tasks, userMap])

    const activeTask = activeId ? tasksById[activeId] : null

    const handleDragStart = (event) => setActiveId(event.active.id)
    const handleDragCancel = () => setActiveId(null)

    const handleDragEnd = (event) => {
        const { active, over } = event
        setActiveId(null)
        if (!over) return
        const task = tasksById[active.id]
        if (!task) return
        const target = parseCellId(over.id)
        if (!target) return
        // Guard against a malformed/unexpected droppable id reaching the
        // mutation layer — only the four known columns are valid targets.
        if (target.status && !VALID_STATUSES.has(target.status)) return

        // Status-change only — moving a card between columns sets status.
        // (Assignee is fixed at creation; there is no drag-to-reassign.)
        const statusChanged =
            target.status && target.status !== task.status
        if (!statusChanged) return

        onCardDrop?.(task, { newStatus: target.status })
    }

    const renderCard = (t) => {
        const canToggle = canDragStatus(t)
        return (
            <DraggableCard key={t.id} id={t.id} disabled={!canToggle}>
                <TaskCard
                    task={t}
                    userMap={userMap}
                    currentUserId={currentUserId}
                    isAdmin={isAdmin}
                    onSelect={() => onOpenPanel?.(t)}
                    onEdit={onEditTask}
                    onDelete={onDeleteTask}
                    onOpenReview={onOpenReview}
                    onOpenLogTime={onOpenLogTime}
                    onToggleCompletion={onToggleCompletion}
                    canToggleCompletion={canToggle}
                    completionLoading={completionLoading}
                />
            </DraggableCard>
        )
    }

    const renderColumnHeader = (label, count) => (
        <div className="tasks-board-column-header">
            <span className="tasks-board-column-label">{label}</span>
            <span className="tasks-board-column-count">{count}</span>
        </div>
    )

    return (
        <div className="tasks-board-wrap">
            {canCreate && (
                <div className="tasks-board-toolbar">
                    <Dropdown
                        trigger={['click']}
                        menu={{
                            items: [
                                { key: 'task', label: 'New Task' },
                                { key: 'issue', label: 'New Issue' },
                                {
                                    key: 'suggestion',
                                    label: 'New Suggestion',
                                },
                            ],
                            onClick: ({ key }) => onCreate?.(key),
                        }}
                    >
                        <Button
                            type="primary"
                            icon={<PlusOutlined />}
                            className="tasks-board-new-btn"
                        >
                            New <DownOutlined />
                        </Button>
                    </Dropdown>
                </div>
            )}

            <DndContext
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragCancel={handleDragCancel}
            >
                {groupByAssignee ? (
                    <div className="tasks-board-swimlanes" role="table">
                        {swimlanes.length === 0 ? (
                            <div className="tasks-board-column-empty">
                                No tasks
                            </div>
                        ) : (
                            <>
                                {/* Column titles header strip — only with rows */}
                                <div
                                    className="tasks-board-swimlane-cols-head"
                                    role="row"
                                >
                                    <div className="tasks-board-swimlane-rowhead" />
                                    {COLUMNS.map(({ status, label }) => (
                                        <div
                                            key={status}
                                            className="tasks-board-swimlane-colhead"
                                            role="columnheader"
                                        >
                                            {label}
                                        </div>
                                    ))}
                                </div>

                                {swimlanes.map((lane) => (
                                <div
                                    key={lane.assigneeId}
                                    className="tasks-board-swimlane"
                                    role="row"
                                >
                                    <div
                                        className="tasks-board-swimlane-rowhead"
                                        role="rowheader"
                                    >
                                        <Avatar
                                            size={26}
                                            icon={<UserOutlined />}
                                        />
                                        <span className="tasks-board-swimlane-name">
                                            {lane.label}
                                        </span>
                                    </div>
                                    {COLUMNS.map(({ status }) => {
                                        const list = lane.buckets[status] || []
                                        return (
                                            <div
                                                key={status}
                                                className={`tasks-board-column tasks-board-column-${status} tasks-board-swimlane-cell`}
                                            >
                                                <DroppableColumn
                                                    id={cellId(
                                                        lane.assigneeId,
                                                        status
                                                    )}
                                                >
                                                    {list.length === 0 ? (
                                                        <div className="tasks-board-cell-empty" />
                                                    ) : (
                                                        list.map(renderCard)
                                                    )}
                                                </DroppableColumn>
                                            </div>
                                        )
                                    })}
                                </div>
                                ))}
                            </>
                        )}
                    </div>
                ) : (
                    <div className="tasks-board">
                        {COLUMNS.map(({ status, label }) => {
                            const list = buckets[status] || []
                            return (
                                <div
                                    key={status}
                                    className={`tasks-board-column tasks-board-column-${status}`}
                                >
                                    {renderColumnHeader(label, list.length)}
                                    <DroppableColumn id={status}>
                                        {list.length === 0 ? (
                                            <div className="tasks-board-column-empty">
                                                No tasks
                                            </div>
                                        ) : (
                                            list.map(renderCard)
                                        )}
                                    </DroppableColumn>
                                </div>
                            )
                        })}
                    </div>
                )}

                <DragOverlay dropAnimation={null}>
                    {activeTask ? (
                        <div className="tasks-board-drag-overlay">
                            <TaskCard
                                task={activeTask}
                                userMap={userMap}
                                currentUserId={currentUserId}
                                isAdmin={isAdmin}
                                canToggleCompletion={false}
                            />
                        </div>
                    ) : null}
                </DragOverlay>
            </DndContext>
        </div>
    )
}

export default TasksBoardView
