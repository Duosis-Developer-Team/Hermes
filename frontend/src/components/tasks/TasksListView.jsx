/**
 * =============================================================================
 * HERMES - Tasks List View
 * =============================================================================
 * Ant Design Table view of the current task scope. Used primarily by the
 * "Assigned by Me" mode where the user wants to scan many assignees at
 * once, but works for any task list.
 *
 * Columns: Task Title · Assignee · Status · Priority · Due Date · Actions
 * Sortable on Due Date / Status / Priority. Filterable on Assignee /
 * Status (Ant Design column filter dropdowns).
 *
 * Reuses Hermes admin/Reports table styling (.ant-table overrides in
 * index.css). Action buttons mirror TaskCard hover actions so behavior
 * stays consistent across calendar and list views.
 * =============================================================================
 */

import { useMemo } from 'react'
import { Button, Checkbox, Space, Table, Tag, Tooltip } from 'antd'
import {
    DeleteOutlined,
    EditOutlined,
    EyeOutlined,
    FieldTimeOutlined,
} from '@ant-design/icons'

import { TaskDueBadge } from './TaskCard'
import {
    canDragTaskStatus, canEditTask,
} from '../../features/tasks/model/permissions'
import { typeMeta } from '../../utils/workItemType'

const PRIORITY_RANK = { low: 0, medium: 1, high: 2, urgent: 3 }

const STATUS_RANK = {
    pending: 0,
    in_progress: 1,
    completed: 2,
    cancelled: 3,
    rejected: 4,
}

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
    rejected: 'red',
}

function userLabel(id, userMap) {
    if (!id) return '—'
    const u = userMap?.[id]
    return u?.full_name || u?.email || id
}

function TasksListView({
    tasks = [],
    userMap = {},
    currentUserId,
    isAdmin = false,
    taskType = 'task',
    onEditTask,
    onDeleteTask,
    onOpenReview,
    onToggleCompletion,
    completionLoading = false,
    onOpenLogTime,
    // Open the docked detail panel (parity with the board card click).
    onOpenPanel,
    // Status changes belong to the assignee in their own My Tasks view;
    // the assigner's "Assigned by Me" list is read-only monitoring.
    allowStatusChange = true,
}) {
    const assigneeFilters = useMemo(() => {
        const seen = new Set()
        const out = []
        for (const t of tasks) {
            if (!t.assignee_user_id || seen.has(t.assignee_user_id)) continue
            seen.add(t.assignee_user_id)
            out.push({
                text: userLabel(t.assignee_user_id, userMap),
                value: t.assignee_user_id,
            })
        }
        return out.sort((a, b) => a.text.localeCompare(b.text))
    }, [tasks, userMap])

    const statusFilters = [
        { text: 'Pending', value: 'pending' },
        { text: 'In Progress', value: 'in_progress' },
        { text: 'Completed', value: 'completed' },
        { text: 'Cancelled', value: 'cancelled' },
        { text: 'Rejected', value: 'rejected' },
    ]

    const columns = [
        {
            title: 'Done',
            key: 'completed',
            width: 64,
            align: 'center',
            render: (_, record) => {
                const isCompleted = record.status === 'completed'
                // Board ile AYNI kural, ayni kaynaktan (permissions).
                const canToggle = canDragTaskStatus({
                    allowStatusDrag: allowStatusChange,
                    task: record,
                    currentUserId,
                    isTaskAdmin: isAdmin,
                })
                return (
                    <Tooltip
                        title={
                            canToggle
                                ? isCompleted
                                    ? `Reopen ${typeMeta(record.task_type).lower}`
                                    : record.status === 'pending'
                                        ? `Accept ${typeMeta(record.task_type).lower} (move to In Progress)`
                                        : 'Mark as completed'
                                : `Only the assignee can change ${typeMeta(record.task_type).lower} status — from their My ${typeMeta(record.task_type).plural} view`
                        }
                    >
                        <Checkbox
                            checked={isCompleted}
                            disabled={!canToggle || completionLoading}
                            onChange={() =>
                                onToggleCompletion?.(record, !isCompleted)
                            }
                        />
                    </Tooltip>
                )
            },
        },
        {
            title: 'Code',
            dataIndex: 'task_code',
            key: 'task_code',
            width: 92,
            sorter: (a, b) => (a.task_number || 0) - (b.task_number || 0),
            render: (val) => (
                <span
                    style={{
                        color: 'var(--c-text-muted)',
                        fontWeight: 600,
                        fontSize: 12,
                        letterSpacing: '0.04em',
                    }}
                >
                    {val || '—'}
                </span>
            ),
        },
        {
            title: 'Task Title',
            dataIndex: 'title',
            key: 'title',
            sorter: (a, b) => (a.title || '').localeCompare(b.title || ''),
            render: (val, row) => (
                <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenPanel?.(row)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') onOpenPanel?.(row)
                    }}
                    style={{ cursor: onOpenPanel ? 'pointer' : 'default' }}
                    title="View details"
                >
                    <div style={{ color: 'var(--c-text-strong)', fontWeight: 600 }}>{val}</div>
                    <div style={{ color: 'var(--c-text-muted)', fontSize: 12, marginTop: 2 }}>
                        {row.customer_name || '—'}
                        {row.project_name ? ` · ${row.project_name}` : ''}
                        {row.sub_project_name ? ` · ${row.sub_project_name}` : ''}
                    </div>
                </div>
            ),
        },
        {
            title: 'Assignee',
            dataIndex: 'assignee_user_id',
            key: 'assignee',
            filters: assigneeFilters,
            onFilter: (value, record) => record.assignee_user_id === value,
            render: (val) => userLabel(val, userMap),
        },
        {
            title: 'Status',
            dataIndex: 'status',
            key: 'status',
            filters: statusFilters,
            onFilter: (value, record) => record.status === value,
            sorter: (a, b) =>
                (STATUS_RANK[a.status] ?? 99) - (STATUS_RANK[b.status] ?? 99),
            render: (val) => (
                <Tag color={STATUS_COLOR[val] || 'default'}>
                    {val === 'in_progress' ? 'in progress' : val}
                </Tag>
            ),
        },
        {
            title: 'Priority',
            dataIndex: 'priority',
            key: 'priority',
            sorter: (a, b) =>
                (PRIORITY_RANK[a.priority] ?? -1) -
                (PRIORITY_RANK[b.priority] ?? -1),
            render: (val) => (
                <Tag color={PRIORITY_COLOR[val] || 'default'}>{val}</Tag>
            ),
        },
        {
            title: 'Scheduled',
            dataIndex: 'scheduled_date',
            key: 'scheduled_date',
            sorter: (a, b) =>
                (a.scheduled_date || '').localeCompare(b.scheduled_date || ''),
            render: (val) => val || '—',
        },
        {
            title: 'Due Date',
            dataIndex: 'due_date',
            key: 'due_date',
            defaultSortOrder: 'ascend',
            sorter: (a, b) =>
                (a.due_date || '9999-12-31').localeCompare(
                    b.due_date || '9999-12-31'
                ),
            render: (val, record) =>
                val ? (
                    <Space size={6} wrap>
                        <span>{val}</span>
                        <TaskDueBadge task={record} />
                    </Space>
                ) : (
                    <span style={{ color: 'var(--c-text-muted)' }}>—</span>
                ),
        },
        {
            title: 'Actions',
            key: 'actions',
            width: 180,
            render: (_, record) => {
                const canEdit = canEditTask({
                    task: record, currentUserId, isTaskAdmin: isAdmin,
                })
                const isCompleted = record.status === 'completed'
                return (
                    /* Aksiyon adlari Board'daki TaskCard ile BIREBIR ayni
                       kaliptadir — ayni gorev iki gorunumde ayni
                       erisilebilir ada sahiptir (§8 ikon-only kurali). */
                    <Space>
                        {isCompleted && onOpenLogTime && (
                            <Tooltip title="Log Time">
                                <Button
                                    size="small"
                                    icon={<FieldTimeOutlined />}
                                    aria-label={`Log time — ${record.title}`}
                                    onClick={() => onOpenLogTime(record)}
                                />
                            </Tooltip>
                        )}
                        <Tooltip title={`Review ${typeMeta(record.task_type).singular}`}>
                            <Button
                                size="small"
                                icon={<EyeOutlined />}
                                aria-label={`Review ${typeMeta(record.task_type).singular} — ${record.title}`}
                                onClick={() => onOpenReview?.(record)}
                            />
                        </Tooltip>
                        {canEdit && (
                            <>
                                <Tooltip title="Edit">
                                    <Button
                                        size="small"
                                        icon={<EditOutlined />}
                                        aria-label={`Edit — ${record.title}`}
                                        onClick={() => onEditTask?.(record)}
                                    />
                                </Tooltip>
                                <Tooltip title="Delete">
                                    <Button
                                        size="small"
                                        danger
                                        icon={<DeleteOutlined />}
                                        aria-label={`Delete — ${record.title}`}
                                        onClick={() => onDeleteTask?.(record)}
                                    />
                                </Tooltip>
                            </>
                        )}
                    </Space>
                )
            },
        },
    ]

    return (
        <Table
            rowKey="id"
            columns={columns}
            dataSource={tasks}
            rowClassName={(record) =>
                record.status === 'completed' ? 'task-row-completed' : ''
            }
            /* Columns keep a sane minimum width and pan horizontally
               inside the table on narrow screens (mobile); no visual
               effect on desktop where the table is wider than 900px. */
            scroll={{ x: 900 }}
            pagination={{ pageSize: 20 }}
            locale={{
                emptyText: `No ${typeMeta(taskType).lowerPlural} for the selected filters.`,
            }}
        />
    )
}

export default TasksListView
