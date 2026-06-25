/**
 * =============================================================================
 * HERMES - Tasks Search Bar
 * =============================================================================
 * Debounced free-text search backed by GET /tasks/search. Visibility
 * is enforced server-side; this component only renders what the API
 * returns, so a non-admin cannot accidentally discover tasks they
 * couldn't otherwise see.
 *
 * Clicking a result calls `onSelect(task)` so the parent page can
 * open the Review Task modal.
 * =============================================================================
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Input, Spin, Tag } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'

import { taskService } from '../../services/api'
import { TaskDueBadge } from './TaskCard'
import { typeMeta } from '../../utils/workItemType'
import './TasksSearchBar.css'

function userLabel(id, userMap) {
    if (!id) return ''
    const u = userMap?.[id]
    return u?.full_name || u?.email || ''
}

function TasksSearchBar({ userMap = {}, onSelect, style, taskType = 'task' }) {
    const [text, setText] = useState('')
    const [debounced, setDebounced] = useState('')
    const [open, setOpen] = useState(false)
    const wrapperRef = useRef(null)

    useEffect(() => {
        const handle = setTimeout(() => setDebounced(text.trim()), 220)
        return () => clearTimeout(handle)
    }, [text])

    const { data: results = [], isFetching } = useQuery({
        // Scope search to the active work-item type so results match the
        // board/list filter (searching Issues won't surface Tasks).
        queryKey: ['task-search', debounced, taskType],
        queryFn: () =>
            taskService.search({
                q: debounced || undefined,
                task_type: taskType,
                limit: 20,
            }),
        enabled: debounced.length >= 1,
        staleTime: 10 * 1000,
    })

    // Close the dropdown on outside click. Avoids leaving a stale
    // panel hovering on top of the calendar/board.
    useEffect(() => {
        if (!open) return
        const handler = (e) => {
            if (
                wrapperRef.current &&
                !wrapperRef.current.contains(e.target)
            ) {
                setOpen(false)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [open])

    const showPanel = open && debounced.length >= 1

    const empty = useMemo(
        () =>
            !isFetching && debounced.length >= 1 && results.length === 0,
        [isFetching, debounced, results]
    )

    const handlePick = (task) => {
        onSelect?.(task)
        setOpen(false)
        // keep the text so the user can pick a different result; clear
        // only when they actively refocus.
    }

    return (
        <div className="tasks-search-wrapper" ref={wrapperRef} style={style}>
            <Input
                size="small"
                allowClear
                prefix={<SearchOutlined style={{ color: 'var(--c-text-muted)' }} />}
                placeholder={`Search ${typeMeta(taskType).lowerPlural}...`}
                value={text}
                onFocus={() => setOpen(true)}
                onChange={(e) => {
                    setText(e.target.value)
                    setOpen(true)
                }}
            />
            {showPanel && (
                <div className="tasks-search-panel">
                    {isFetching && results.length === 0 && (
                        <div className="tasks-search-status">
                            <Spin size="small" /> Searching…
                        </div>
                    )}
                    {empty && (
                        <div className="tasks-search-status">
                            No matching tasks found
                        </div>
                    )}
                    {results.map((t) => (
                        <button
                            key={t.id}
                            type="button"
                            className="tasks-search-result"
                            onClick={() => handlePick(t)}
                        >
                            <div className="tasks-search-result-top">
                                {t.task_code && (
                                    <span className="tasks-search-code">
                                        {t.task_code}
                                    </span>
                                )}
                                <span className="tasks-search-title">
                                    {t.title}
                                </span>
                                <TaskDueBadge task={t} compact />
                            </div>
                            <div className="tasks-search-result-meta">
                                <span>
                                    {t.customer_name || '—'}
                                    {t.project_name
                                        ? ` · ${t.project_name}`
                                        : ''}
                                </span>
                                {t.assignee_user_id && (
                                    <span>
                                        ·{' '}
                                        {userLabel(
                                            t.assignee_user_id,
                                            userMap
                                        )}
                                    </span>
                                )}
                                <Tag
                                    color={
                                        t.status === 'completed'
                                            ? 'green'
                                            : t.status === 'rejected'
                                            ? 'red'
                                            : t.status === 'in_progress'
                                            ? 'blue'
                                            : 'default'
                                    }
                                    style={{ marginLeft: 'auto' }}
                                >
                                    {t.status === 'in_progress'
                                        ? 'in progress'
                                        : t.status}
                                </Tag>
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

export default TasksSearchBar
