/**
 * =============================================================================
 * HERMES - Task Access by Group (Admin → Task Management → Task Access)
 * =============================================================================
 * Replaces the old per-user toggle UI with a group-driven view. The group
 * itself (name, members, etc.) is owned by Users → Groups; this tab only
 * configures task-specific permissions for those groups.
 *
 * Each group row exposes:
 *   - Default Can Access Tasks  (per-group)
 *   - Default Can Assign Tasks  (per-group)
 *   - Expandable member list with effective contribution + tri-state
 *     overrides per member
 *
 * Whole-row click expands the group; action toggles stopPropagation.
 * No CRUD on groups or membership — a "Manage Groups" button links
 * back to Users → Groups.
 * =============================================================================
 */

import { useMemo, useState } from 'react'
import {
    Button,
    Select,
    Space,
    Switch,
    Table,
    Tag,
    Tooltip,
    message,
} from 'antd'
import { TeamOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import {
    authService,
    taskGroupPermissionService,
    userGroupService,
} from '../../services/api'

const OVERRIDE_OPTIONS = [
    { value: 'inherit', label: 'Inherit from group' },
    { value: 'enabled', label: 'Force enabled' },
    { value: 'disabled', label: 'Force disabled' },
]

function overrideToValue(override) {
    if (override === true) return 'enabled'
    if (override === false) return 'disabled'
    return 'inherit'
}

function valueToPayload(value, currentOverride, fieldName, clearFieldName) {
    if (value === 'enabled') return { [fieldName]: true }
    if (value === 'disabled') return { [fieldName]: false }
    if (currentOverride !== null && currentOverride !== undefined) {
        return { [clearFieldName]: true }
    }
    return {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Member overrides panel — rendered inside each group's expanded row
// ─────────────────────────────────────────────────────────────────────────────

function GroupMemberOverridesPanel({ group, allUsersById }) {
    const queryClient = useQueryClient()

    const { data: members = [], isLoading: membersLoading } = useQuery({
        queryKey: ['admin-user-group-members', group.id],
        queryFn: () => userGroupService.listMembers(group.id),
    })

    const { data: overrides = [], isLoading: overridesLoading } = useQuery({
        queryKey: ['admin-task-group-member-overrides', group.id],
        queryFn: () => taskGroupPermissionService.listMemberOverrides(group.id),
    })

    const overrideByUserId = useMemo(() => {
        const map = {}
        for (const o of overrides) map[o.user_id] = o
        return map
    }, [overrides])

    const upsertMutation = useMutation({
        mutationFn: ({ userId, data }) =>
            taskGroupPermissionService.upsertMemberOverride(group.id, userId, data),
        onSuccess: () => {
            message.success('Override saved.')
            queryClient.invalidateQueries({
                queryKey: ['admin-task-group-member-overrides', group.id],
            })
            queryClient.invalidateQueries({ queryKey: ['task-permissions'] })
        },
        onError: (err) => {
            message.error(
                err?.response?.data?.detail || 'Failed to save override.'
            )
        },
    })

    const handleOverrideChange = (member, kind, value) => {
        const current = overrideByUserId[member.user_id] || null
        const payload = valueToPayload(
            value,
            current
                ? kind === 'access'
                    ? current.can_access_tasks_override
                    : current.can_assign_tasks_override
                : null,
            kind === 'access'
                ? 'can_access_tasks_override'
                : 'can_assign_tasks_override',
            kind === 'access' ? 'clear_access_override' : 'clear_assign_override'
        )
        if (Object.keys(payload).length === 0) return // nothing to send
        upsertMutation.mutate({ userId: member.user_id, data: payload })
    }

    const rows = useMemo(
        () =>
            members.map((m) => {
                const o = overrideByUserId[m.user_id]
                return {
                    ...m,
                    access_choice: overrideToValue(o?.can_access_tasks_override),
                    assign_choice: overrideToValue(o?.can_assign_tasks_override),
                    effective_access_in_group: o?.effective_access_in_group ?? null,
                    effective_assign_in_group: o?.effective_assign_in_group ?? null,
                }
            }),
        [members, overrideByUserId]
    )

    const columns = [
        {
            title: 'User',
            dataIndex: 'user_id',
            render: (uid) => {
                const u = allUsersById[uid]
                return u?.full_name || u?.email || uid
            },
        },
        {
            title: 'Email',
            dataIndex: 'user_id',
            key: 'email',
            render: (uid) => allUsersById[uid]?.email || '—',
        },
        {
            title: 'Member Title',
            dataIndex: 'title',
            render: (val) => val || <span style={{ color: '#888' }}>—</span>,
        },
        {
            title: 'Access Override',
            dataIndex: 'access_choice',
            width: 200,
            render: (val, record) => (
                <Select
                    size="small"
                    value={val}
                    style={{ width: '100%' }}
                    options={OVERRIDE_OPTIONS}
                    onChange={(next) =>
                        handleOverrideChange(record, 'access', next)
                    }
                    disabled={upsertMutation.isPending}
                    onClick={(e) => e.stopPropagation()}
                />
            ),
        },
        {
            title: 'Assign Override',
            dataIndex: 'assign_choice',
            width: 200,
            render: (val, record) => (
                <Select
                    size="small"
                    value={val}
                    style={{ width: '100%' }}
                    options={OVERRIDE_OPTIONS}
                    onChange={(next) =>
                        handleOverrideChange(record, 'assign', next)
                    }
                    disabled={upsertMutation.isPending}
                    onClick={(e) => e.stopPropagation()}
                />
            ),
        },
    ]

    return (
        <div style={{ padding: '8px 0' }}>
            <div style={{ marginBottom: 8, color: '#9b9b9b', fontSize: 12 }}>
                Members are managed in Users → Groups. Use the override pickers
                to grant or suppress each member's contribution to this group.
            </div>
            <Table
                rowKey="id"
                size="small"
                columns={columns}
                dataSource={rows}
                loading={membersLoading || overridesLoading}
                pagination={false}
                locale={{ emptyText: 'No members in this group.' }}
            />
        </div>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab
// ─────────────────────────────────────────────────────────────────────────────

function TaskAccessByGroupTab() {
    const queryClient = useQueryClient()
    const navigate = useNavigate()

    const { data: users = [] } = useQuery({
        queryKey: ['auth-users-lookup', { include_inactive: true }],
        queryFn: () => authService.lookupUsers({ include_inactive: true }),
        staleTime: 60 * 1000,
    })

    const allUsersById = useMemo(() => {
        const map = {}
        for (const u of users) map[u.id] = u
        return map
    }, [users])

    const { data: groups = [], isLoading: groupsLoading } = useQuery({
        queryKey: ['admin-user-groups'],
        queryFn: () => userGroupService.list(),
    })

    const { data: permissions = [], isLoading: permsLoading } = useQuery({
        queryKey: ['admin-task-group-permissions'],
        queryFn: () => taskGroupPermissionService.list(),
    })

    const permByGroupId = useMemo(() => {
        const map = {}
        for (const p of permissions) map[p.group_id] = p
        return map
    }, [permissions])

    const upsertPermMutation = useMutation({
        mutationFn: ({ groupId, data }) =>
            taskGroupPermissionService.upsertGroupDefaults(groupId, data),
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: ['admin-task-group-permissions'],
            })
            queryClient.invalidateQueries({ queryKey: ['task-permissions'] })
        },
        onError: (err) => {
            message.error(
                err?.response?.data?.detail || 'Failed to update group default.'
            )
        },
    })

    const handleDefaultToggle = (group, kind, checked) => {
        const current = permByGroupId[group.id]
        const data = {
            can_access_tasks_default:
                kind === 'access' ? checked : !!current?.can_access_tasks_default,
            can_assign_tasks_default:
                kind === 'assign' ? checked : !!current?.can_assign_tasks_default,
        }
        upsertPermMutation.mutate({ groupId: group.id, data })
    }

    const rows = useMemo(
        () =>
            groups.map((g) => {
                const perm = permByGroupId[g.id]
                return {
                    ...g,
                    can_access_tasks_default: !!perm?.can_access_tasks_default,
                    can_assign_tasks_default: !!perm?.can_assign_tasks_default,
                }
            }),
        [groups, permByGroupId]
    )

    const columns = [
        {
            title: 'Group',
            dataIndex: 'name',
            render: (val) => <strong>{val}</strong>,
        },
        {
            title: 'Description',
            dataIndex: 'description',
            render: (val) => val || <span style={{ color: '#888' }}>—</span>,
        },
        {
            title: 'Members',
            dataIndex: 'member_count',
            width: 100,
            align: 'center',
        },
        {
            title: 'Default Can Access Tasks',
            dataIndex: 'can_access_tasks_default',
            width: 180,
            render: (val, row) => (
                <Switch
                    checked={!!val}
                    disabled={upsertPermMutation.isPending}
                    onClick={(_, e) => e?.stopPropagation?.()}
                    onChange={(checked) =>
                        handleDefaultToggle(row, 'access', checked)
                    }
                />
            ),
        },
        {
            title: 'Default Can Assign Tasks',
            dataIndex: 'can_assign_tasks_default',
            width: 180,
            render: (val, row) => (
                <Switch
                    checked={!!val}
                    disabled={upsertPermMutation.isPending}
                    onClick={(_, e) => e?.stopPropagation?.()}
                    onChange={(checked) =>
                        handleDefaultToggle(row, 'assign', checked)
                    }
                />
            ),
        },
    ]

    return (
        <>
            <div
                style={{
                    marginBottom: 12,
                    display: 'flex',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 8,
                }}
            >
                <Tooltip title="Group + member management lives here">
                    <Button
                        icon={<TeamOutlined />}
                        onClick={() => navigate('/users')}
                    >
                        Manage Groups
                    </Button>
                </Tooltip>
                <Space>
                    <Tag color="default">
                        Tip: expand a group to set per-member overrides.
                    </Tag>
                </Space>
            </div>

            <Table
                rowKey="id"
                columns={columns}
                dataSource={rows}
                loading={groupsLoading || permsLoading}
                pagination={{ pageSize: 20 }}
                locale={{
                    emptyText:
                        'No groups yet. Create groups in Users → Groups, then come back here to set task permissions.',
                }}
                expandable={{
                    expandRowByClick: true,
                    expandedRowRender: (group) => (
                        <GroupMemberOverridesPanel
                            group={group}
                            allUsersById={allUsersById}
                        />
                    ),
                    rowExpandable: () => true,
                }}
            />
        </>
    )
}

export default TaskAccessByGroupTab
