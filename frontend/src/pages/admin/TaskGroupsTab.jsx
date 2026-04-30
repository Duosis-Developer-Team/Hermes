/**
 * =============================================================================
 * HERMES - Task Groups Tab (Admin → Task Management)
 * =============================================================================
 * Primary view for managing task access by group. Each group is rendered
 * as an expandable Ant Design Table row whose expanded panel shows
 * members and their effective permission contribution within that group.
 *
 * User name / email / auth role are joined client-side from a single
 * auth-service /users/lookup call.
 * =============================================================================
 */

import { useMemo, useState } from 'react'
import {
    Table,
    Button,
    Space,
    Tag,
    Tooltip,
    Switch,
    message,
    Popconfirm,
} from 'antd'
import {
    PlusOutlined,
    EditOutlined,
    InboxOutlined,
    UndoOutlined,
    UserAddOutlined,
    DeleteOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { authService, taskGroupService } from '../../services/api'
import TaskGroupModal from '../../components/modals/TaskGroupModal'
import TaskGroupMemberModal from '../../components/modals/TaskGroupMemberModal'

function GroupMembersPanel({ group, allUsersById, users }) {
    const queryClient = useQueryClient()
    const [memberModalOpen, setMemberModalOpen] = useState(false)
    const [editingMember, setEditingMember] = useState(null)

    const { data: members = [], isLoading } = useQuery({
        queryKey: ['admin-task-group-members', group.id],
        queryFn: () => taskGroupService.listMembers(group.id),
    })

    const memberUserIds = useMemo(
        () => new Set(members.map((m) => m.user_id)),
        [members]
    )

    const candidateUsers = useMemo(
        () => users.filter((u) => u.is_active && !memberUserIds.has(u.id)),
        [users, memberUserIds]
    )

    const addMutation = useMutation({
        mutationFn: (data) => taskGroupService.addMember(group.id, data),
        onSuccess: () => {
            message.success('Member added.')
            setMemberModalOpen(false)
            setEditingMember(null)
            queryClient.invalidateQueries({
                queryKey: ['admin-task-group-members', group.id],
            })
            queryClient.invalidateQueries({ queryKey: ['admin-task-groups'] })
            queryClient.invalidateQueries({ queryKey: ['task-permissions'] })
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to add member.')
        },
    })

    const updateMutation = useMutation({
        mutationFn: ({ memberId, data }) =>
            taskGroupService.updateMember(group.id, memberId, data),
        onSuccess: () => {
            message.success('Member updated.')
            setMemberModalOpen(false)
            setEditingMember(null)
            queryClient.invalidateQueries({
                queryKey: ['admin-task-group-members', group.id],
            })
            queryClient.invalidateQueries({ queryKey: ['task-permissions'] })
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to update member.')
        },
    })

    const removeMutation = useMutation({
        mutationFn: (memberId) => taskGroupService.removeMember(group.id, memberId),
        onSuccess: () => {
            message.success('Member removed.')
            queryClient.invalidateQueries({
                queryKey: ['admin-task-group-members', group.id],
            })
            queryClient.invalidateQueries({ queryKey: ['admin-task-groups'] })
            queryClient.invalidateQueries({ queryKey: ['task-permissions'] })
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to remove member.')
        },
    })

    const handleSubmit = async (payload, member) => {
        if (member) {
            await updateMutation.mutateAsync({
                memberId: member.id,
                data: payload,
            })
        } else {
            await addMutation.mutateAsync(payload)
        }
    }

    const renderOverride = (override) => {
        if (override === true) return <Tag color="green">Force enabled</Tag>
        if (override === false) return <Tag color="red">Force disabled</Tag>
        return <Tag>Inherit</Tag>
    }

    const columns = [
        {
            title: 'User',
            dataIndex: 'user_id',
            key: 'user',
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
            key: 'auth_role',
            render: (uid) => {
                const u = allUsersById[uid]
                if (!u) return '—'
                if (u.is_admin) return <Tag color="gold">ADMIN</Tag>
                return <Tag color="blue">{u.role || 'USER'}</Tag>
            },
        },
        {
            title: 'Task Title',
            dataIndex: 'task_title',
            key: 'task_title',
            render: (val) => val || <span style={{ color: '#888' }}>—</span>,
        },
        {
            title: 'Effective Access',
            dataIndex: 'effective_access_in_group',
            key: 'effective_access',
            render: (val) =>
                val ? <Tag color="green">Granted</Tag> : <Tag>No</Tag>,
        },
        {
            title: 'Effective Assign',
            dataIndex: 'effective_assign_in_group',
            key: 'effective_assign',
            render: (val) =>
                val ? <Tag color="green">Granted</Tag> : <Tag>No</Tag>,
        },
        {
            title: 'Access Override',
            dataIndex: 'can_access_tasks_override',
            key: 'access_override',
            render: renderOverride,
        },
        {
            title: 'Assign Override',
            dataIndex: 'can_assign_tasks_override',
            key: 'assign_override',
            render: renderOverride,
        },
        {
            title: 'Actions',
            key: 'actions',
            render: (_, record) => (
                <Space>
                    <Tooltip title="Edit member">
                        <Button
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => {
                                setEditingMember(record)
                                setMemberModalOpen(true)
                            }}
                        />
                    </Tooltip>
                    <Popconfirm
                        title="Remove from group?"
                        description="This removes the membership only — the user account and their tasks are untouched."
                        okText="Remove"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => removeMutation.mutate(record.id)}
                    >
                        <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
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
                    onClick={() => {
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

            <TaskGroupMemberModal
                open={memberModalOpen}
                onClose={() => {
                    setMemberModalOpen(false)
                    setEditingMember(null)
                }}
                onSubmit={handleSubmit}
                editingMember={editingMember}
                candidateUsers={candidateUsers}
                loading={addMutation.isPending || updateMutation.isPending}
            />
        </div>
    )
}

function TaskGroupsTab() {
    const queryClient = useQueryClient()
    const [groupModalOpen, setGroupModalOpen] = useState(false)
    const [editingGroup, setEditingGroup] = useState(null)
    const [includeArchived, setIncludeArchived] = useState(false)

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

    const { data: groups = [], isLoading } = useQuery({
        queryKey: ['admin-task-groups', { include_archived: includeArchived }],
        queryFn: () =>
            taskGroupService.list(
                includeArchived ? { include_archived: true } : {}
            ),
    })

    const createMutation = useMutation({
        mutationFn: (data) => taskGroupService.create(data),
        onSuccess: () => {
            message.success('Task group created.')
            setGroupModalOpen(false)
            setEditingGroup(null)
            queryClient.invalidateQueries({ queryKey: ['admin-task-groups'] })
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to create group.')
        },
    })

    const updateMutation = useMutation({
        mutationFn: ({ groupId, data }) => taskGroupService.update(groupId, data),
        onSuccess: () => {
            message.success('Task group updated.')
            setGroupModalOpen(false)
            setEditingGroup(null)
            queryClient.invalidateQueries({ queryKey: ['admin-task-groups'] })
            queryClient.invalidateQueries({ queryKey: ['task-permissions'] })
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to update group.')
        },
    })

    const archiveMutation = useMutation({
        mutationFn: (groupId) => taskGroupService.archive(groupId),
        onSuccess: () => {
            message.success('Task group archived.')
            queryClient.invalidateQueries({ queryKey: ['admin-task-groups'] })
            queryClient.invalidateQueries({ queryKey: ['task-permissions'] })
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to archive group.')
        },
    })

    const reactivateMutation = useMutation({
        mutationFn: (groupId) => taskGroupService.update(groupId, { is_active: true }),
        onSuccess: () => {
            message.success('Task group reactivated.')
            queryClient.invalidateQueries({ queryKey: ['admin-task-groups'] })
            queryClient.invalidateQueries({ queryKey: ['task-permissions'] })
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to reactivate group.')
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
        { title: 'Group Name', dataIndex: 'name' },
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
            title: 'Default Access',
            dataIndex: 'can_access_tasks_default',
            width: 130,
            render: (val, row) => (
                <Switch
                    checked={!!val}
                    disabled={updateMutation.isPending}
                    onChange={(checked) =>
                        updateMutation.mutate({
                            groupId: row.id,
                            data: { can_access_tasks_default: checked },
                        })
                    }
                />
            ),
        },
        {
            title: 'Default Assign',
            dataIndex: 'can_assign_tasks_default',
            width: 130,
            render: (val, row) => (
                <Switch
                    checked={!!val}
                    disabled={updateMutation.isPending}
                    onChange={(checked) =>
                        updateMutation.mutate({
                            groupId: row.id,
                            data: { can_assign_tasks_default: checked },
                        })
                    }
                />
            ),
        },
        {
            title: 'Status',
            dataIndex: 'is_active',
            width: 100,
            render: (val) =>
                val ? <Tag color="green">Active</Tag> : <Tag>Archived</Tag>,
        },
        {
            title: 'Actions',
            key: 'actions',
            width: 200,
            render: (_, record) => (
                <Space>
                    <Tooltip title="Edit group">
                        <Button
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => {
                                setEditingGroup(record)
                                setGroupModalOpen(true)
                            }}
                        />
                    </Tooltip>
                    {record.is_active ? (
                        <Popconfirm
                            title="Archive group?"
                            description="The group stops contributing to effective permissions. Members and existing tasks are kept."
                            okText="Archive"
                            okButtonProps={{ danger: true }}
                            onConfirm={() => archiveMutation.mutate(record.id)}
                        >
                            <Button size="small" danger icon={<InboxOutlined />}>
                                Archive
                            </Button>
                        </Popconfirm>
                    ) : (
                        <Button
                            size="small"
                            icon={<UndoOutlined />}
                            onClick={() => reactivateMutation.mutate(record.id)}
                        >
                            Reactivate
                        </Button>
                    )}
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
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 8,
                }}
            >
                <Space>
                    <Switch
                        checked={includeArchived}
                        onChange={setIncludeArchived}
                        checkedChildren="With archived"
                        unCheckedChildren="Active only"
                    />
                </Space>
                <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => {
                        setEditingGroup(null)
                        setGroupModalOpen(true)
                    }}
                >
                    Create Task Group
                </Button>
            </div>

            <Table
                rowKey="id"
                columns={columns}
                dataSource={groups}
                loading={isLoading}
                pagination={{ pageSize: 10 }}
                locale={{ emptyText: 'No task groups yet — create one above.' }}
                expandable={{
                    expandedRowRender: (group) => (
                        <GroupMembersPanel
                            group={group}
                            allUsersById={allUsersById}
                            users={users}
                        />
                    ),
                    rowExpandable: () => true,
                }}
            />

            <TaskGroupModal
                open={groupModalOpen}
                onClose={() => {
                    setGroupModalOpen(false)
                    setEditingGroup(null)
                }}
                onSubmit={handleSubmit}
                editingGroup={editingGroup}
                loading={createMutation.isPending || updateMutation.isPending}
            />
        </>
    )
}

export default TaskGroupsTab
