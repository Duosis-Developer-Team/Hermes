/**
 * =============================================================================
 * HERMES - Tasks Weekly View
 * =============================================================================
 * Mirrors the Time Entry weekly grid (WeeklyListView + DayColumn). Reuses
 * the existing CSS classes (.weekly-list-view, .weekly-list-columns,
 * .day-column, .day-column-*) for visual parity.
 *
 * Per day:
 *   - Tasks scheduled on that day
 *   - Compact "Due" markers for tasks scheduled earlier in the visible
 *     week whose due date falls on that day (so the user can see what's
 *     coming due).
 *
 * Copy/paste integration mirrors the Time Entry pattern:
 *   - Selected card shows a blue border + "C" badge.
 *   - Targeted day column shows the same `day-column-targeted` highlight
 *     and pulse animation as Time Entry.
 *   - Top banner is shown while a task is in the clipboard, with the
 *     same wording / Ctrl+V hint as Time Entry.
 * =============================================================================
 */

import { useMemo } from 'react'
import { PlusOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

import TaskCard, { TaskDueMarker } from './TaskCard'
import '../time-entry/DayColumn.css'
import '../time-entry/WeeklyListView.css'

function TaskDayColumn({
    date,
    tasks,
    dueMarkers,
    isToday,
    isWeekend,
    isTargeted,
    hasCopiedTask,
    selectedTaskId,
    currentUserId,
    isAdmin,
    userMap,
    onEditTask,
    onDeleteTask,
    onSelectTask,
    onSelectDay,
    onToggleCompletion,
    canCreate,
    onCreate,
    completionLoading,
}) {
    const dateKey = dayjs(date).format('YYYY-MM-DD')
    const dayName = dayjs(date).format('ddd')
    const dayNumber = dayjs(date).format('DD')

    const handleDayClick = () => {
        if (hasCopiedTask) {
            onSelectDay?.(dateKey)
        }
    }

    const className =
        'day-column' +
        (isWeekend ? ' day-column-weekend' : '') +
        (isToday ? ' day-column-today' : '') +
        (isTargeted ? ' day-column-targeted' : '')

    return (
        <div className={className} onClick={handleDayClick}>
            {/* Header */}
            <div className="day-column-header">
                <div className="day-column-name">
                    <span className="day-name">{dayName}</span>
                    <span className="day-number">{dayNumber}</span>
                </div>
                <div className="day-column-hours">
                    {tasks.length} task{tasks.length === 1 ? '' : 's'}
                </div>
            </div>

            {/* Add Task button */}
            {canCreate && (
                <button
                    className="day-column-add-btn"
                    onClick={(e) => {
                        e.stopPropagation()
                        onCreate?.(date)
                    }}
                >
                    <PlusOutlined />
                </button>
            )}

            {/* Tasks section */}
            <div className="day-column-section-title">TASKS</div>
            <div className="day-column-logs">
                {tasks.length === 0 && dueMarkers.length === 0 ? (
                    <div
                        className={`day-column-empty${
                            hasCopiedTask ? ' day-column-empty-paste' : ''
                        }`}
                    >
                        {hasCopiedTask
                            ? '↓ Click here or press Ctrl+V'
                            : 'No tasks'}
                    </div>
                ) : (
                    <>
                        {tasks.map((t) => {
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
                                    onSelect={onSelectTask}
                                    onEdit={onEditTask}
                                    onDelete={onDeleteTask}
                                    onToggleCompletion={onToggleCompletion}
                                    canToggleCompletion={canToggle}
                                    completionLoading={completionLoading}
                                    isSelected={selectedTaskId === t.id}
                                />
                            )
                        })}
                        {dueMarkers.map((t) => (
                            <TaskDueMarker
                                key={`due-${t.id}`}
                                task={t}
                                userMap={userMap}
                                currentUserId={currentUserId}
                                onClick={onEditTask}
                            />
                        ))}

                        {/* Bottom paste hint (Time Entry parity) */}
                        {hasCopiedTask && (
                            <div className="day-column-paste-hint">
                                + Paste here (Ctrl+V)
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}

function TasksWeeklyView({
    weekStart,
    tasks = [],
    userMap = {},
    currentUserId,
    isAdmin,
    onEditTask,
    onDeleteTask,
    onToggleCompletion,
    onCreate,
    canCreate,
    completionLoading,
    /** Copy/paste props */
    selectedTaskId,
    copiedTask,
    targetDate,
    onSelectTask,
    onSelectDay,
    onClearClipboard,
}) {
    const weekDays = useMemo(() => {
        const days = []
        for (let i = 0; i < 7; i++) days.push(dayjs(weekStart).add(i, 'day'))
        return days
    }, [weekStart])

    const tasksByDate = useMemo(() => {
        const grouped = {}
        for (const d of weekDays) {
            grouped[d.format('YYYY-MM-DD')] = []
        }
        for (const t of tasks) {
            const key = t.scheduled_date
            if (key in grouped) grouped[key].push(t)
        }
        return grouped
    }, [tasks, weekDays])

    const dueMarkersByDate = useMemo(() => {
        const grouped = {}
        const weekKeys = new Set(weekDays.map((d) => d.format('YYYY-MM-DD')))
        for (const d of weekDays) grouped[d.format('YYYY-MM-DD')] = []
        for (const t of tasks) {
            if (!t.due_date) continue
            if (t.due_date === t.scheduled_date) continue
            if (!weekKeys.has(t.due_date)) continue
            if (t.status === 'completed') continue
            grouped[t.due_date].push(t)
        }
        return grouped
    }, [tasks, weekDays])

    const today = dayjs().format('YYYY-MM-DD')

    return (
        <div className="weekly-list-view">
            {/* Clipboard banner — Time Entry parity */}
            {copiedTask && (
                <div className="weekly-clipboard-banner">
                    <span className="clipboard-banner-icon">📋</span>
                    <span className="clipboard-banner-text">
                        <strong>{copiedTask.title || 'Task'}</strong> copied —
                        click a target day, then press <kbd>Ctrl+V</kbd> to paste
                    </span>
                    <button
                        type="button"
                        className="clipboard-close-btn"
                        onClick={onClearClipboard}
                        title="Clear (Esc)"
                    >
                        ✕
                    </button>
                </div>
            )}

            <div className="weekly-list-summary">
                <span>Week:</span>
                <strong>
                    {tasks.length} task{tasks.length === 1 ? '' : 's'}
                </strong>
            </div>

            <div className="weekly-list-columns">
                {weekDays.map((day) => {
                    const key = day.format('YYYY-MM-DD')
                    const dow = day.day()
                    return (
                        <TaskDayColumn
                            key={key}
                            date={day}
                            tasks={tasksByDate[key] || []}
                            dueMarkers={dueMarkersByDate[key] || []}
                            isToday={key === today}
                            isWeekend={dow === 0 || dow === 6}
                            isTargeted={key === targetDate}
                            hasCopiedTask={!!copiedTask}
                            selectedTaskId={selectedTaskId}
                            currentUserId={currentUserId}
                            isAdmin={isAdmin}
                            userMap={userMap}
                            onEditTask={onEditTask}
                            onDeleteTask={onDeleteTask}
                            onSelectTask={onSelectTask}
                            onSelectDay={onSelectDay}
                            onToggleCompletion={onToggleCompletion}
                            canCreate={canCreate}
                            onCreate={onCreate}
                            completionLoading={completionLoading}
                        />
                    )
                })}
            </div>
        </div>
    )
}

export default TasksWeeklyView
