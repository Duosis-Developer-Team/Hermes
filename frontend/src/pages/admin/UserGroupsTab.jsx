/**
 * =============================================================================
 * HERMES - User Groups Tab (Admin → Users → Groups)
 * =============================================================================
 * Generic group management. Two virtual built-in groups appear at the
 * top of the table, derived from auth-service:
 *   - Admins        : users where is_admin = true
 *   - General Users : users where is_admin = false AND is_active = true
 *
 * Built-in groups are read-only — membership follows from user role.
 * Below them, admin-created custom groups (Technical Team, etc.) are
 * full CRUD with member management.
 *
 * Whole-row click expands/collapses; action buttons stop propagation.
 * No "Active only" toggle here — deactivated groups simply do not show.
 * =============================================================================
 */

import { useMemo, useState } from 'react'
import {
    Button,
    Space,
    Table,
    Tag,
    Tooltip,
    message,
} from 'antd'
import {
    DeleteOutlined,
    EditOutlined,
    PlusOutlined,
    UserAddOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { authService, userGroupService } from '../../services/api'
import UserGroupModal from '../../components/modals/UserGroupModal'
import UserGroupMemberModal from '../../components/modals/UserGroupMemberModal'
import DangerConfirmModal from '../../components/common/DangerConfirmModal'

// ─────────────────────────────────────────────────────────────────────────────
// Virtual group helpers
// ─────────────────────────────────────────────────────────────────────────────

const VIRTUAL_ADMINS_ID = '__virtual_admins__'
const VIRTUAL_GENERAL_ID = '__virtual_general__'

function buildVirtualGroups(users) {
    const admins = users.filter((u) => u.is_admin)
    const general = users.filter((u) => !u.is_admin && u.is_active)
    return [
        {
            id: VIRTUAL_ADMINS_ID,
            name: 'Admins',
            description: 'Built-in. Membership derives from the Admin role.',
            is_active: true,
            member_count: admins.length,
            virtual: true,
            members: admins,
        },
        {
            id: VIRTUAL_GENERAL_ID,
            name: 'General Users',
            description: 'Built-in. All active non-admin users.',
            is_active: true,
            member_count: general.length,
            virtual: true,
            members: general,
        },
    ]
}

// ─────────────────────────────────────────────────────────────────────────────
// Members panel — shared by virtual + real groups
// ─────────────────────────────────────────────────────────────────────────────

function VirtualMembersTable({ users }) {
    const columns = [
        {
            title: 'User',
            dataIndex: 'full_name',
            render: (val, row) => val || row.email || row.id,
        },
        { title: 'Email', dataIndex: 'email' },
        {
            title: 'Auth Role',
            dataIndex: 'role',
            render: (val, row) =>
                row.is_admin ? (
                    <Tag color="gold">ADMIN</Tag>
                ) : (
                    <Tag color="blue">{val || 'USER'}</Tag>
                ),
        },
        {
            title: 'Member Title',
            key: 'title',
            render: () => <span style={{ color: '#888' }}>—</span>,
        },
    ]

    return (
        <div style={{ padding: '8px 0' }}>
            <div style={{ marginBottom: 8, color: '#9b9b9b' }}>
                {users.length} member{users.length === 1 ? '' : 's'} ·{' '}
                membership is automatic — managed via user role.
            </div>
            <Table
                rowKey="id"
                size="small"
                columns={columns}
                dataSource={users}
                pagination={false}
                locale={{ emptyText: 'No matching users.' }}
            />
        </div>
    )
}

function RealMembersTable({ group, allUsersById, users }) {
    const queryClient = useQueryClient()
    const [memberModalOpen, setMemberModalOpen] = useState(false)
    const [editingMember, setEditingMember] = useState(null)
    const [removingMember, setRemovingMember] = useState(null)

    const { data: members = [], isLoading } = useQuery({
        queryKey: ['admin-user-group-members', group.id],
        queryFn: () => userGroupService.listMembers(group.id),
    })

    const memberUserIds = useMemo(
        () => new Set(members.map((m) => m.user_id)),
        [members]
    )

    const candidateUsers = useMemo(
        () => users.filter((u) => u.is_active && !memberUserIds.has(u.id)),
        [users, memberUserIds]
    )

    const [bulkAdding, setBulkAdding] = useState(false)

    const updateMutation = useMutation({
        mutationFn: ({ memberId, data }) =>
            userGroupService.updateMember(group.id, memberId, data),
        onSuccess: () => {
            message.success('Member updated.')
            setMemberModalOpen(false)
            setEditingMember(null)
            queryClient.invalidateQueries({
                queryKey: ['admin-user-group-members', group.id],
            })
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to update member.')
        },
    })

    const handleBulkAdd = async ({ user_ids: userIds = [], title = null }) => {
        if (!userIds.length) return
        setBulkAdding(true)
        try {
            const results = await Promise.allSettled(
                userIds.map((userId) =>
                    userGroupService.addMember(group.id, {
                        user_id: userId,
                        title: title || null,
                    })
                )
            )
            const succeeded = results.filter((r) => r.status === 'fulfilled').length
            const failed = results.length - succeeded
            if (succeeded > 0) {
                message.success(
                    `${succeeded} member${succeeded === 1 ? '' : 's'} added to ${group.name}.`
                )
            }
            if (failed > 0) {
                const firstFail = results.find((r) => r.status === 'rejected')
                message.error(
                    firstFail?.reason?.response?.data?.detail ||
                        `${failed} member${failed === 1 ? '' : 's'} could not be added.`
                )
            }
            queryClient.invalidateQueries({
                queryKey: ['admin-user-group-members', group.id],
            })
            queryClient.invalidateQueries({ queryKey: ['admin-user-groups'] })
            queryClient.invalidateQueries({ queryKey: ['task-permissions'] })
            if (succeeded > 0) {
                setMemberModalOpen(false)
                setEditingMember(null)
            }
        } finally {
            setBulkAdding(false)
        }
    }

    const removeMutation = useMutation({
        mutationFn: (memberId) => userGroupService.removeMember(group.id, memberId),
        onSuccess: () => {
            message.success('Member removed.')
            setRemovingMember(null)
            queryClient.invalidateQueries({
                queryKey: ['admin-user-group-members', group.id],
            })
            queryClient.invalidateQueries({ queryKey: ['admin-user-groups'] })
            queryClient.invalidateQueries({ queryKey: ['task-permissions'] })
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to remove member.')
            setRemovingMember(null)
        },
    })

    const handleSubmit = async (payload, member) => {
        if (member) {
            await updateMutation.mutateAsync({
                memberId: member.id,
                data: payload,
            })
        } else {
            await handleBulkAdd(payload)
        }
    }

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
            title: 'Auth Role',
            dataIndex: 'user_id',
            key: 'role',
            render: (uid) => {
                const u = allUsersById[uid]
                if (!u) return '—'
                if (u.is_admin) return <Tag color="gold">ADMIN</Tag>
                return <Tag color="blue">{u.role || 'USER'}</Tag>
            },
        },
        {
            title: 'Member Title',
            dataIndex: 'title',
            render: (val) => val || <span style={{ color: '#888' }}>—</span>,
        },
        {
            title: 'Actions',
            key: 'actions',
            render: (_, record) => (
                <Space onClick={(e) => e.stopPropagation()}>
                    <Tooltip title="Edit Member Title">
                        <Button
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => {
                                setEditingMember(record)
                                setMemberModalOpen(true)
                            }}
                        />
                    </Tooltip>
                    <Tooltip title="Remove from group">
                        <Button
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => setRemovingMember(record)}
                        />
                    </Tooltip>
                </Space>
            ),
        },
    ]

    return (
        <div style={{ padding: '8px 0' }}>
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 8,
                }}
            >
                <span style={{ color: '#9b9b9b' }}>
                    {members.length} member{members.length === 1 ? '' : 's'}
                </span>
                <Button
                    size="small"
                    type="primary"
                    icon={<UserAddOutlined />}
                    onClick={(e) => {
                        e.stopPropagation()
                        setEditingMember(null)
                        setMemberModalOpen(true)
                    }}
                >
                    Add Member
                </Button>
            </div>

            <Table
                rowKey="id"
                size="small"
                columns={columns}
                dataSource={members}
                loading={isLoading}
                pagination={false}
                locale={{ emptyText: 'No members yet.' }}
            />

            <UserGroupMemberModal
                open={memberModalOpen}
                onClose={() => {
                    setMemberModalOpen(false)
                    setEditingMember(null)
                }}
                onSubmit={handleSubmit}
                editingMember={editingMember}
                candidateUsers={candidateUsers}
                userMap={allUsersById}
                loading={bulkAdding || updateMutation.isPending}
            />

            <DangerConfirmModal
                open={!!removingMember}
                title="Remove member from group?"
                body="This removes the user from this group only. The user account is not affected, and existing tasks remain unchanged."
                itemName={
                    removingMember
                        ? allUsersById[removingMember.user_id]?.full_name ||
                          allUsersById[removingMember.user_id]?.email ||
                          removingMember.user_id
                        : null
                }
                itemSubtitle={
                    removingMember
                        ? group.name +
                          (removingMember.title ? ` · ${removingMember.title}` : '')
                        : null
                }
                confirmLabel="Remove"
                onCancel={() => setRemovingMember(null)}
                onConfirm={() =>
                    removingMember && removeMutation.mutate(removingMember.id)
                }
                loading={removeMutation.isPending}
            />
        </div>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab
// ─────────────────────────────────────────────────────────────────────────────

function UserGroupsTab() {
    const queryClient = useQueryClient()
    const [groupModalOpen, setGroupModalOpen] = useState(false)
    const [deletingGroup, setDeletingGroup] = useState(null)
    const [editingGroup, setEditingGroup] = useState(null)

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

    const { data: realGroups = [], isLoading } = useQuery({
        queryKey: ['admin-user-groups'],
        queryFn: () => userGroupService.list(),
    })

    const virtualGroups = useMemo(() => buildVirtualGroups(users), [users])

    // Virtual groups always first; admin-created groups follow alphabetically.
    const allRows = useMemo(
        () => [...virtualGroups, ...realGroups],
        [virtualGroups, realGroups]
    )

    const createMutation = useMutation({
        mutationFn: (data) => userGroupService.create(data),
        onSuccess: () => {
            message.success('Group created.')
            setGroupModalOpen(false)
            setEditingGroup(null)
            queryClient.invalidateQueries({ queryKey: ['admin-user-groups'] })
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to create group.')
        },
    })

    const updateMutation = useMutation({
        mutationFn: ({ groupId, data }) => userGroupService.update(groupId, data),
        onSuccess: () => {
            message.success('Group updated.')
            setGroupModalOpen(false)
            setEditingGroup(null)
            queryClient.invalidateQueries({ queryKey: ['admin-user-groups'] })
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to update group.')
        },
    })

    const deactivateMutation = useMutation({
        mutationFn: (groupId) => userGroupService.deactivate(groupId),
        onSuccess: () => {
            message.success('Group deleted.')
            setDeletingGroup(null)
            queryClient.invalidateQueries({ queryKey: ['admin-user-groups'] })
            queryClient.invalidateQueries({ queryKey: ['task-permissions'] })
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to delete group.')
            setDeletingGroup(null)
        },
    })

    const handleSubmit = async (payload, groupId) => {
        if (groupId) {
            await updateMutation.mutateAsync({ groupId, data: payload })
        } else {
            await createMutation.mutateAsync(payload)
        }
    }

    const columns = [
        {
            title: 'Group Name',
            dataIndex: 'name',
            render: (val, row) =>
                row.virtual ? (
                    <Space>
                        <strong>{val}</strong>
                        <Tag>Built-in</Tag>
                    </Space>
                ) : (
                    <strong>{val}</strong>
                ),
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
            title: 'Actions',
            key: 'actions',
            width: 200,
            render: (_, record) =>
                record.virtual ? (
                    <span style={{ color: '#888' }}>—</span>
                ) : (
                    <Space onClick={(e) => e.stopPropagation()}>
                        <Tooltip title="Edit Group">
                            <Button
                                size="small"
                                icon={<EditOutlined />}
                                onClick={() => {
                                    setEditingGroup(record)
                                    setGroupModalOpen(true)
                                }}
                            />
                        </Tooltip>
                        <Button
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => setDeletingGroup(record)}
                        >
                            Delete
                        </Button>
                    </Space>
                ),
        },
    ]

    return (
        <>
            <div
                style={{
                    marginBottom: 12,
                    display: 'flex',
                    justifyContent: 'flex-end',
                }}
            >
                <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => {
                        setEditingGroup(null)
                        setGroupModalOpen(true)
                    }}
                >
                    Create Group
                </Button>
            </div>

            <Table
                rowKey="id"
                columns={columns}
                dataSource={allRows}
                loading={isLoading}
                pagination={{ pageSize: 20 }}
                locale={{
                    emptyText: 'No groups yet — Admins / General Users always show.',
                }}
                expandable={{
                    expandRowByClick: true, // whole-row click toggles
                    expandedRowRender: (group) =>
                        group.virtual ? (
                            <VirtualMembersTable users={group.members} />
                        ) : (
                            <RealMembersTable
                                group={group}
                                allUsersById={allUsersById}
                                users={users}
                            />
                        ),
                    rowExpandable: () => true,
                }}
            />

            <UserGroupModal
                open={groupModalOpen}
                onClose={() => {
                    setGroupModalOpen(false)
                    setEditingGroup(null)
                }}
                onSubmit={handleSubmit}
                editingGroup={editingGroup}
                loading={createMutation.isPending || updateMutation.isPending}
            />

            <DangerConfirmModal
                open={!!deletingGroup}
                title="Delete group?"
                body="This removes the group from active use. User accounts and existing tasks remain unchanged."
                itemName={deletingGroup?.name}
                itemSubtitle={
                    deletingGroup
                        ? `${deletingGroup.member_count ?? 0} member${
                              deletingGroup.member_count === 1 ? '' : 's'
                          }`
                        : null
                }
                confirmLabel="Delete Group"
                onCancel={() => setDeletingGroup(null)}
                onConfirm={() =>
                    deletingGroup && deactivateMutation.mutate(deletingGroup.id)
                }
                loading={deactivateMutation.isPending}
            />
        </>
    )
}

export default UserGroupsTab
