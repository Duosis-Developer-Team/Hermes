/**
 * =============================================================================
 * HERMES - Assignment Hierarchy Tab (Admin → Task Management)
 * =============================================================================
 * Replaces the old flat "assigner | assignee | created | actions" table
 * with assigner-grouped expandable cards. Each assigner can map to:
 *   - individual users  (task_assignment_relations)
 *   - whole user groups (task_assignment_group_relations)
 *
 * Assigning to a group at task-creation time fans the task out to one
 * row per active group member; the assignment rule itself stays a single
 * record.
 * =============================================================================
 */

import { useMemo, useState } from 'react'
import {
    Button,
    Card,
    Empty,
    Form,
    Modal,
    Radio,
    Select,
    Space,
    Tag,
    Tooltip,
    message,
} from 'antd'
import {
    DeleteOutlined,
    PlusOutlined,
    TeamOutlined,
    UserOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
    authService,
    taskAssignmentGroupService,
    taskAssignmentService,
    taskPermissionService,
    userGroupService,
} from '../../services/api'
import DangerConfirmModal from '../../components/common/DangerConfirmModal'

function userLabel(u) {
    if (!u) return '—'
    return u.full_name || u.email || u.id
}

function AssignerCard({
    assigner,
    userRelations,
    groupRelations,
    usersById,
    groupsById,
    groupMemberCounts,
    onAddRule,
    onRemoveUserRelation,
    onRemoveGroupRelation,
}) {
    const [expanded, setExpanded] = useState(false)
    const userCount = userRelations.length
    const groupCount = groupRelations.length

    return (
        <Card
            size="small"
            style={{ marginBottom: 12 }}
            bodyStyle={{ padding: 0 }}
        >
            <div
                role="button"
                tabIndex={0}
                onClick={() => setExpanded((v) => !v)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setExpanded((v) => !v)
                    }
                }}
                style={{
                    padding: '12px 16px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                    flexWrap: 'wrap',
                    gap: 8,
                }}
            >
                <div>
                    <div style={{ color: '#fff', fontWeight: 600 }}>
                        {userLabel(assigner)}
                    </div>
                    <div style={{ color: '#9b9b9b', fontSize: 12 }}>
                        {assigner.email || ''}
                    </div>
                </div>
                <Space size={8}>
                    <Tag color="blue">
                        {userCount} user{userCount === 1 ? '' : 's'}
                    </Tag>
                    <Tag color="purple">
                        {groupCount} group{groupCount === 1 ? '' : 's'}
                    </Tag>
                    <Button
                        size="small"
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={(e) => {
                            e.stopPropagation()
                            onAddRule(assigner.id)
                        }}
                    >
                        Add Assignment Rule
                    </Button>
                </Space>
            </div>

            {expanded && (
                <div
                    style={{
                        padding: '0 16px 16px',
                        borderTop: '1px solid #303030',
                    }}
                >
                    {/* Groups section */}
                    <div style={{ marginTop: 12 }}>
                        <div
                            style={{
                                fontSize: 11,
                                color: '#9b9b9b',
                                letterSpacing: 0.4,
                                textTransform: 'uppercase',
                                marginBottom: 6,
                            }}
                        >
                            Groups
                        </div>
                        {groupRelations.length === 0 ? (
                            <div
                                style={{
                                    color: '#5a5a5a',
                                    fontSize: 12,
                                    fontStyle: 'italic',
                                }}
                            >
                                No group assignments.
                            </div>
                        ) : (
                            groupRelations.map((rel) => {
                                const g = groupsById[rel.assignee_group_id]
                                const count =
                                    groupMemberCounts[rel.assignee_group_id] ?? 0
                                return (
                                    <div
                                        key={rel.id}
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            padding: '6px 0',
                                            borderBottom: '1px solid #2a2a2a',
                                        }}
                                    >
                                        <div>
                                            <TeamOutlined
                                                style={{ marginRight: 6, color: '#a78bfa' }}
                                            />
                                            <span style={{ color: '#fff' }}>
                                                {g?.name || rel.assignee_group_id}
                                            </span>
                                            <span style={{ color: '#9b9b9b', marginLeft: 8 }}>
                                                {count} member{count === 1 ? '' : 's'}
                                            </span>
                                        </div>
                                        <Tooltip title="Remove this group from assigner">
                                            <Button
                                                size="small"
                                                danger
                                                icon={<DeleteOutlined />}
                                                onClick={() => onRemoveGroupRelation(rel)}
                                            />
                                        </Tooltip>
                                    </div>
                                )
                            })
                        )}
                    </div>

                    {/* Users section */}
                    <div style={{ marginTop: 16 }}>
                        <div
                            style={{
                                fontSize: 11,
                                color: '#9b9b9b',
                                letterSpacing: 0.4,
                                textTransform: 'uppercase',
                                marginBottom: 6,
                            }}
                        >
                            Users
                        </div>
                        {userRelations.length === 0 ? (
                            <div
                                style={{
                                    color: '#5a5a5a',
                                    fontSize: 12,
                                    fontStyle: 'italic',
                                }}
                            >
                                No user assignments.
                            </div>
                        ) : (
                            userRelations.map((rel) => {
                                const u = usersById[rel.assignee_user_id]
                                return (
                                    <div
                                        key={rel.id}
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            padding: '6px 0',
                                            borderBottom: '1px solid #2a2a2a',
                                        }}
                                    >
                                        <div>
                                            <UserOutlined
                                                style={{ marginRight: 6, color: '#60a5fa' }}
                                            />
                                            <span style={{ color: '#fff' }}>
                                                {userLabel(u)}
                                            </span>
                                            {u?.email && (
                                                <span
                                                    style={{
                                                        color: '#9b9b9b',
                                                        marginLeft: 8,
                                                        fontSize: 12,
                                                    }}
                                                >
                                                    {u.email}
                                                </span>
                                            )}
                                        </div>
                                        <Tooltip title="Remove this user from assigner">
                                            <Button
                                                size="small"
                                                danger
                                                icon={<DeleteOutlined />}
                                                onClick={() => onRemoveUserRelation(rel)}
                                            />
                                        </Tooltip>
                                    </div>
                                )
                            })
                        )}
                    </div>
                </div>
            )}
        </Card>
    )
}

function AddRuleModal({
    open,
    onClose,
    onSubmit,
    eligibleAssigners,
    eligibleAssignees,
    eligibleGroups,
    initialAssignerId = null,
    loading = false,
}) {
    const [form] = Form.useForm()
    const targetType = Form.useWatch('target_type', form) || 'user'

    return (
        <Modal
            title="Add Assignment Rule"
            open={open}
            onCancel={onClose}
            onOk={() => form.submit()}
            okText="Save"
            confirmLoading={loading}
            destroyOnClose
            afterClose={() => form.resetFields()}
        >
            <Form
                form={form}
                layout="vertical"
                initialValues={{
                    assigner_user_id: initialAssignerId || undefined,
                    target_type: 'user',
                }}
                onFinish={onSubmit}
            >
                <Form.Item
                    label="Assigner"
                    name="assigner_user_id"
                    rules={[{ required: true, message: 'Pick an assigner.' }]}
                >
                    <Select
                        showSearch
                        placeholder="Select assigner"
                        optionFilterProp="label"
                        options={eligibleAssigners.map((u) => ({
                            value: u.id,
                            label: userLabel(u),
                        }))}
                        notFoundContent={
                            eligibleAssigners.length === 0
                                ? 'No users with Can Assign Tasks enabled. Enable it in Direct User Overrides first.'
                                : undefined
                        }
                    />
                </Form.Item>

                <Form.Item label="Target Type" name="target_type">
                    <Radio.Group>
                        <Radio.Button value="user">User</Radio.Button>
                        <Radio.Button value="group">Group</Radio.Button>
                    </Radio.Group>
                </Form.Item>

                {targetType === 'user' ? (
                    <Form.Item
                        label="Assignee User"
                        name="assignee_user_id"
                        rules={[
                            { required: true, message: 'Pick an assignee user.' },
                        ]}
                    >
                        <Select
                            showSearch
                            placeholder="Select user"
                            optionFilterProp="label"
                            options={eligibleAssignees.map((u) => ({
                                value: u.id,
                                label: userLabel(u),
                            }))}
                            notFoundContent={
                                eligibleAssignees.length === 0
                                    ? 'No users with Can Access Tasks enabled.'
                                    : undefined
                            }
                        />
                    </Form.Item>
                ) : (
                    <Form.Item
                        label="Assignee Group"
                        name="assignee_group_id"
                        rules={[
                            { required: true, message: 'Pick an assignee group.' },
                        ]}
                    >
                        <Select
                            showSearch
                            placeholder="Select group"
                            optionFilterProp="label"
                            options={eligibleGroups.map((g) => ({
                                value: g.id,
                                label: g.name,
                            }))}
                            notFoundContent={
                                eligibleGroups.length === 0
                                    ? 'No active groups. Create one in Users → Groups first.'
                                    : undefined
                            }
                        />
                    </Form.Item>
                )}
            </Form>
        </Modal>
    )
}

function AssignmentHierarchyTab() {
    const queryClient = useQueryClient()

    const [addModalOpen, setAddModalOpen] = useState(false)
    const [presetAssignerId, setPresetAssignerId] = useState(null)
    const [removingUserRelation, setRemovingUserRelation] = useState(null)
    const [removingGroupRelation, setRemovingGroupRelation] = useState(null)

    const { data: users = [] } = useQuery({
        queryKey: ['auth-users-lookup', { include_inactive: true }],
        queryFn: () => authService.lookupUsers({ include_inactive: true }),
        staleTime: 60 * 1000,
    })
    const usersById = useMemo(() => {
        const map = {}
        for (const u of users) map[u.id] = u
        return map
    }, [users])

    const { data: permissionRows = [] } = useQuery({
        queryKey: ['admin-task-permissions'],
        queryFn: () => taskPermissionService.listAdminUsers(),
    })
    const permMap = useMemo(() => {
        const map = {}
        for (const p of permissionRows) map[p.user_id] = p
        return map
    }, [permissionRows])

    const eligibleAssigners = useMemo(
        () =>
            users.filter(
                (u) =>
                    u.is_active &&
                    (u.is_admin || !!permMap[u.id]?.can_assign_tasks)
            ),
        [users, permMap]
    )
    const eligibleAssignees = useMemo(
        () =>
            users.filter(
                (u) => u.is_active && !!permMap[u.id]?.can_access_tasks
            ),
        [users, permMap]
    )

    const { data: groups = [] } = useQuery({
        queryKey: ['admin-user-groups'],
        queryFn: () => userGroupService.list(),
    })
    const groupsById = useMemo(() => {
        const map = {}
        for (const g of groups) map[g.id] = g
        return map
    }, [groups])
    const groupMemberCounts = useMemo(() => {
        const map = {}
        for (const g of groups) map[g.id] = g.member_count || 0
        return map
    }, [groups])

    const { data: userRelations = [], isLoading: userRelLoading } = useQuery({
        queryKey: ['admin-task-assignment-relations'],
        queryFn: () => taskAssignmentService.list(),
    })
    const { data: groupRelations = [], isLoading: groupRelLoading } = useQuery({
        queryKey: ['admin-task-assignment-group-relations'],
        queryFn: () => taskAssignmentGroupService.list(),
    })

    // Group rules per assigner so we can render one card per assigner.
    const cardsByAssigner = useMemo(() => {
        const map = new Map()
        const ensure = (assignerId) => {
            if (!map.has(assignerId)) {
                map.set(assignerId, { user: [], group: [] })
            }
            return map.get(assignerId)
        }
        for (const r of userRelations) ensure(r.assigner_user_id).user.push(r)
        for (const r of groupRelations) ensure(r.assigner_user_id).group.push(r)
        return map
    }, [userRelations, groupRelations])

    const sortedAssignerCards = useMemo(() => {
        const ids = Array.from(cardsByAssigner.keys())
        return ids
            .map((id) => ({
                assigner: usersById[id] || { id, full_name: id },
                userRelations: cardsByAssigner.get(id).user,
                groupRelations: cardsByAssigner.get(id).group,
            }))
            .sort((a, b) =>
                userLabel(a.assigner).localeCompare(userLabel(b.assigner))
            )
    }, [cardsByAssigner, usersById])

    // Mutations
    const createUserMutation = useMutation({
        mutationFn: (data) => taskAssignmentService.create(data),
        onSuccess: () => {
            message.success('User assignment rule added.')
            setAddModalOpen(false)
            queryClient.invalidateQueries({
                queryKey: ['admin-task-assignment-relations'],
            })
        },
        onError: (err) => {
            message.error(
                err?.response?.data?.detail || 'Failed to add user rule.'
            )
        },
    })

    const createGroupMutation = useMutation({
        mutationFn: (data) => taskAssignmentGroupService.create(data),
        onSuccess: () => {
            message.success('Group assignment rule added.')
            setAddModalOpen(false)
            queryClient.invalidateQueries({
                queryKey: ['admin-task-assignment-group-relations'],
            })
        },
        onError: (err) => {
            message.error(
                err?.response?.data?.detail || 'Failed to add group rule.'
            )
        },
    })

    const deleteUserMutation = useMutation({
        mutationFn: (id) => taskAssignmentService.delete(id),
        onSuccess: () => {
            message.success('User rule removed.')
            setRemovingUserRelation(null)
            queryClient.invalidateQueries({
                queryKey: ['admin-task-assignment-relations'],
            })
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to remove rule.')
            setRemovingUserRelation(null)
        },
    })

    const deleteGroupMutation = useMutation({
        mutationFn: (id) => taskAssignmentGroupService.delete(id),
        onSuccess: () => {
            message.success('Group rule removed.')
            setRemovingGroupRelation(null)
            queryClient.invalidateQueries({
                queryKey: ['admin-task-assignment-group-relations'],
            })
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to remove rule.')
            setRemovingGroupRelation(null)
        },
    })

    const handleAdd = (values) => {
        if (values.target_type === 'user') {
            createUserMutation.mutate({
                assigner_user_id: values.assigner_user_id,
                assignee_user_ids: [values.assignee_user_id],
            })
        } else {
            createGroupMutation.mutate({
                assigner_user_id: values.assigner_user_id,
                assignee_group_id: values.assignee_group_id,
            })
        }
    }

    const isLoading = userRelLoading || groupRelLoading
    const removingUser =
        removingUserRelation && usersById[removingUserRelation.assignee_user_id]
    const removingGroupName =
        removingGroupRelation &&
        (groupsById[removingGroupRelation.assignee_group_id]?.name || '—')

    return (
        <>
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    marginBottom: 12,
                }}
            >
                <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => {
                        setPresetAssignerId(null)
                        setAddModalOpen(true)
                    }}
                >
                    Add Assignment Rule
                </Button>
            </div>

            {sortedAssignerCards.length === 0 ? (
                <Empty
                    description={
                        isLoading
                            ? 'Loading…'
                            : 'No assignment rules yet — click Add Assignment Rule.'
                    }
                />
            ) : (
                sortedAssignerCards.map(({ assigner, userRelations, groupRelations }) => (
                    <AssignerCard
                        key={assigner.id}
                        assigner={assigner}
                        userRelations={userRelations}
                        groupRelations={groupRelations}
                        usersById={usersById}
                        groupsById={groupsById}
                        groupMemberCounts={groupMemberCounts}
                        onAddRule={(assignerId) => {
                            setPresetAssignerId(assignerId)
                            setAddModalOpen(true)
                        }}
                        onRemoveUserRelation={(rel) =>
                            setRemovingUserRelation(rel)
                        }
                        onRemoveGroupRelation={(rel) =>
                            setRemovingGroupRelation(rel)
                        }
                    />
                ))
            )}

            <AddRuleModal
                open={addModalOpen}
                onClose={() => setAddModalOpen(false)}
                onSubmit={handleAdd}
                eligibleAssigners={eligibleAssigners}
                eligibleAssignees={eligibleAssignees}
                eligibleGroups={groups}
                initialAssignerId={presetAssignerId}
                loading={
                    createUserMutation.isPending || createGroupMutation.isPending
                }
            />

            <DangerConfirmModal
                open={!!removingUserRelation}
                title="Remove assignment mapping?"
                body="This prevents future assignment through this mapping. Existing tasks remain unchanged."
                itemName={
                    removingUser
                        ? userLabel(removingUser)
                        : removingUserRelation?.assignee_user_id
                }
                confirmLabel="Remove"
                onCancel={() => setRemovingUserRelation(null)}
                onConfirm={() =>
                    removingUserRelation &&
                    deleteUserMutation.mutate(removingUserRelation.id)
                }
                loading={deleteUserMutation.isPending}
            />

            <DangerConfirmModal
                open={!!removingGroupRelation}
                title="Remove assignment mapping?"
                body="This prevents future assignment through this mapping. Existing tasks remain unchanged."
                itemName={removingGroupName}
                confirmLabel="Remove"
                onCancel={() => setRemovingGroupRelation(null)}
                onConfirm={() =>
                    removingGroupRelation &&
                    deleteGroupMutation.mutate(removingGroupRelation.id)
                }
                loading={deleteGroupMutation.isPending}
            />
        </>
    )
}

export default AssignmentHierarchyTab
