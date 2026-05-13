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
    Space,
    Switch,
    Table,
    Tooltip,
    message,
} from 'antd'
import { TeamOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import {
    authService,
    taskGroupPermissionService,
    taskPermissionService,
    userGroupService,
} from '../../services/api'

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
            queryClient.invalidateQueries({
                queryKey: ['admin-task-permissions-effective'],
            })
            queryClient.invalidateQueries({ queryKey: ['task-permissions'] })
        },
        onError: (err) => {
            message.error(
                err?.response?.data?.detail || 'Failed to save override.'
            )
        },
    })

    // Simple binary toggle: ON = explicit TRUE override, OFF = explicit
    // FALSE override. The "inherit-from-default" tri-state is gone in v1
    // for a cleaner UX; the underlying nullable column is preserved on
    // the backend so old NULL rows still resolve to the group default.
    const handleMemberToggle = (member, kind, checked) => {
        const fieldName =
            kind === 'access'
                ? 'can_access_tasks_override'
                : 'can_assign_tasks_override'
        upsertMutation.mutate({
            userId: member.user_id,
            data: { [fieldName]: !!checked },
        })
    }

    const rows = useMemo(
        () =>
            members.map((m) => {
                const o = overrideByUserId[m.user_id]
                // The toggle state mirrors the *effective* contribution
                // — explicit override if set, else group default.
                return {
                    ...m,
                    effective_access_in_group: !!o?.effective_access_in_group,
                    effective_assign_in_group: !!o?.effective_assign_in_group,
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
            title: 'Access Tasks',
            dataIndex: 'effective_access_in_group',
            width: 140,
            render: (val, record) => (
                <Switch
                    checked={!!val}
                    disabled={upsertMutation.isPending}
                    onClick={(_, e) => e?.stopPropagation?.()}
                    onChange={(checked) =>
                        handleMemberToggle(record, 'access', checked)
                    }
                />
            ),
        },
        {
            title: 'Assign Tasks',
            dataIndex: 'effective_assign_in_group',
            width: 140,
            render: (val, record) => {
                // Invariant — assign requires access. If access is OFF
                // for this member, the Assign toggle is forced off and
                // disabled. Backend enforces the same invariant.
                const accessOff = !record.effective_access_in_group
                return (
                    <Switch
                        checked={!accessOff && !!val}
                        disabled={accessOff || upsertMutation.isPending}
                        onClick={(_, e) => e?.stopPropagation?.()}
                        onChange={(checked) =>
                            handleMemberToggle(record, 'assign', checked)
                        }
                    />
                )
            },
        },
    ]

    return (
        <div style={{ padding: '8px 0' }}>
            <div style={{ marginBottom: 8, color: '#9b9b9b', fontSize: 12 }}>
                Members are managed in Users → Groups.
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
// Additional Users — people who are not in any group but still need
// task access. Toggles write directly to task_user_permissions and
// keep the same Access/Assign vocabulary used everywhere else.
// ─────────────────────────────────────────────────────────────────────────────

function AdditionalUsersSection({ users }) {
    const queryClient = useQueryClient()

    const { data: permissionRows = [], isLoading: permsLoading } = useQuery({
        queryKey: ['admin-task-permissions'],
        queryFn: () => taskPermissionService.listAdminUsers(),
    })

    const permByUserId = useMemo(() => {
        const map = {}
        for (const p of permissionRows) map[p.user_id] = p
        return map
    }, [permissionRows])

    const updateMutation = useMutation({
        mutationFn: ({ userId, data }) =>
            taskPermissionService.updateUserPermission(userId, data),
        onSuccess: () => {
            message.success('Permissions updated.')
            queryClient.invalidateQueries({ queryKey: ['admin-task-permissions'] })
            queryClient.invalidateQueries({
                queryKey: ['admin-task-permissions-effective'],
            })
            queryClient.invalidateQueries({ queryKey: ['task-permissions'] })
        },
        onError: (err) => {
            message.error(
                err?.response?.data?.detail || 'Failed to update permissions.'
            )
        },
    })

    const rows = useMemo(
        () =>
            users.map((u) => {
                const perm = permByUserId[u.id]
                return {
                    user_id: u.id,
                    full_name: u.full_name || u.email,
                    email: u.email,
                    is_active: !!u.is_active,
                    can_access_tasks: !!perm?.can_access_tasks,
                    can_assign_tasks: !!perm?.can_assign_tasks,
                }
            }),
        [users, permByUserId]
    )

    const handleToggle = (row, field, value) => {
        const next = {
            can_access_tasks:
                field === 'can_access_tasks' ? value : !!row.can_access_tasks,
            can_assign_tasks:
                field === 'can_assign_tasks' ? value : !!row.can_assign_tasks,
        }
        if (field === 'can_access_tasks' && !value) next.can_assign_tasks = false
        if (field === 'can_assign_tasks' && value) next.can_access_tasks = true
        updateMutation.mutate({ userId: row.user_id, data: next })
    }

    const columns = [
        {
            title: 'User',
            dataIndex: 'full_name',
            render: (val, row) => val || row.email || row.user_id,
        },
        { title: 'Email', dataIndex: 'email' },
        {
            title: 'Access Tasks',
            dataIndex: 'can_access_tasks',
            width: 140,
            render: (val, row) => (
                <Switch
                    checked={!!val}
                    disabled={!row.is_active || updateMutation.isPending}
                    onChange={(checked) =>
                        handleToggle(row, 'can_access_tasks', checked)
                    }
                />
            ),
        },
        {
            title: 'Assign Tasks',
            dataIndex: 'can_assign_tasks',
            width: 140,
            render: (val, row) => {
                const accessOff = !row.can_access_tasks
                return (
                    <Switch
                        checked={!accessOff && !!val}
                        disabled={
                            !row.is_active ||
                            accessOff ||
                            updateMutation.isPending
                        }
                        onChange={(checked) =>
                            handleToggle(row, 'can_assign_tasks', checked)
                        }
                    />
                )
            },
        },
    ]

    return (
        <div style={{ marginTop: 32 }}>
            <div style={{ marginBottom: 8 }}>
                <strong style={{ fontSize: 15, color: '#fff' }}>
                    Additional Users
                </strong>
                <div style={{ color: '#9b9b9b', fontSize: 12, marginTop: 2 }}>
                    People with task permissions outside any group.
                </div>
            </div>
            <Table
                rowKey="user_id"
                size="small"
                columns={columns}
                dataSource={rows}
                loading={permsLoading}
                pagination={false}
                locale={{
                    emptyText:
                        'Everyone with access is already in a group.',
                }}
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

    const { data: effectiveRows = [] } = useQuery({
        queryKey: ['admin-task-permissions-effective'],
        queryFn: () => taskPermissionService.listEffective(),
    })

    const groupMemberIds = useMemo(() => {
        const set = new Set()
        for (const row of effectiveRows) {
            if (row.is_group_member) set.add(row.user_id)
        }
        return set
    }, [effectiveRows])

    const nonGroupUsers = useMemo(
        () =>
            users.filter(
                (u) => u.is_active && !groupMemberIds.has(u.id)
            ),
        [users, groupMemberIds]
    )

    const permByGroupId = useMemo(() => {
        const map = {}
        for (const p of permissions) map[p.group_id] = p
        return map
    }, [permissions])

    const upsertPermMutation = useMutation({
        mutationFn: ({ groupId, data }) =>
            taskGroupPermissionService.upsertGroupDefaults(groupId, data),
        onSuccess: () => {
            // The backend cascades the changed default(s) to every
            // existing member override in the group, so refetch the
            // member-override list as well to reflect the new state.
            queryClient.invalidateQueries({
                queryKey: ['admin-task-group-permissions'],
            })
            queryClient.invalidateQueries({
                queryKey: ['admin-task-group-member-overrides'],
            })
            queryClient.invalidateQueries({
                queryKey: ['admin-task-permissions-effective'],
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
        // Invariant — assign requires access. Mirror what the
        // backend enforces so the client-side toast feels accurate
        // before the refetch lands.
        if (!data.can_access_tasks_default) {
            data.can_assign_tasks_default = false
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
            title: 'Access Tasks',
            dataIndex: 'can_access_tasks_default',
            width: 140,
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
            title: 'Assign Tasks',
            dataIndex: 'can_assign_tasks_default',
            width: 140,
            render: (val, row) => {
                const accessOff = !row.can_access_tasks_default
                return (
                    <Switch
                        checked={!accessOff && !!val}
                        disabled={accessOff || upsertPermMutation.isPending}
                        onClick={(_, e) => e?.stopPropagation?.()}
                        onChange={(checked) =>
                            handleDefaultToggle(row, 'assign', checked)
                        }
                    />
                )
            },
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

            <AdditionalUsersSection users={nonGroupUsers} />
        </>
    )
}

export default TaskAccessByGroupTab
