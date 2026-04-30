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
 * =============================================================================
 */

import { useMemo } from 'react'
import { Dropdown } from 'antd'
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
    currentUserId,
    isAdmin,
    userMap,
    onClickTask,
    onToggleCompletion,
    canCreate,
    onCreate,
    completionLoading,
}) {
    const dayName = dayjs(date).format('ddd')
    const dayNumber = dayjs(date).format('DD')

    return (
        <div
            className={`day-column${isWeekend ? ' day-column-weekend' : ''}${isToday ? ' day-column-today' : ''}`}
        >
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
                    <div className="day-column-empty">No tasks</div>
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
                                    onClick={onClickTask}
                                    onToggleCompletion={onToggleCompletion}
                                    canToggleCompletion={canToggle}
                                    completionLoading={completionLoading}
                                />
                            )
                        })}
                        {dueMarkers.map((t) => (
                            <TaskDueMarker
                                key={`due-${t.id}`}
                                task={t}
                                userMap={userMap}
                                currentUserId={currentUserId}
                                onClick={onClickTask}
                            />
                        ))}
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
    onClickTask,
    onToggleCompletion,
    onCreate,
    canCreate,
    completionLoading,
}) {
    const weekDays = useMemo(() => {
        const days = []
        for (let i = 0; i < 7; i++) days.push(dayjs(weekStart).add(i, 'day'))
        return days
    }, [weekStart])

    // Tasks grouped by scheduled_date.
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

    // Due markers: task whose due_date is in the visible week AND differs
    // from its scheduled_date AND is not yet completed (completed tasks
    // already convey their own status, no need to clutter).
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
            <div className="weekly-list-summary">
                <span>Week:</span>
                <strong>{tasks.length} task{tasks.length === 1 ? '' : 's'}</strong>
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
                            currentUserId={currentUserId}
                            isAdmin={isAdmin}
                            userMap={userMap}
                            onClickTask={onClickTask}
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
