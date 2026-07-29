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
    Input,
    Modal,
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
                    <div style={{ color: 'var(--c-text-strong)', fontWeight: 600 }}>
                        {userLabel(assigner)}
                    </div>
                    <div style={{ color: 'var(--c-text-muted)', fontSize: 12 }}>
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
                        borderTop: '1px solid var(--c-border)',
                    }}
                >
                    {/* Groups section */}
                    <div style={{ marginTop: 12 }}>
                        <div
                            style={{
                                fontSize: 11,
                                color: 'var(--c-text-muted)',
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
                                    color: 'var(--c-text-faint)',
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
                                            borderBottom: '1px solid var(--c-border)',
                                        }}
                                    >
                                        <div>
                                            <TeamOutlined
                                                style={{ marginRight: 6, color: '#a78bfa' }}
                                            />
                                            <span style={{ color: 'var(--c-text-strong)' }}>
                                                {g?.name || rel.assignee_group_id}
                                            </span>
                                            <span style={{ color: 'var(--c-text-muted)', marginLeft: 8 }}>
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
                                color: 'var(--c-text-muted)',
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
                                    color: 'var(--c-text-faint)',
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
                                            borderBottom: '1px solid var(--c-border)',
                                        }}
                                    >
                                        <div>
                                            <UserOutlined
                                                style={{ marginRight: 6, color: '#60a5fa' }}
                                            />
                                            <span style={{ color: 'var(--c-text-strong)' }}>
                                                {userLabel(u)}
                                            </span>
                                            {u?.email && (
                                                <span
                                                    style={{
                                                        color: 'var(--c-text-muted)',
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

    return (
        <Modal
            title="Add Assignment Rules"
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
                                ? 'No active users found.'
                                : undefined
                        }
                    />
                </Form.Item>

                {/* Bulk targets — pick any number of users AND/OR groups in
                    a single save. At least one is required (validated on
                    submit since the rule spans two fields). */}
                <Form.Item
                    label="Assignee Users"
                    name="assignee_user_ids"
                    extra="Pick one or more users this assigner may assign to."
                    dependencies={['assignee_group_ids']}
                    rules={[
                        {
                            validator: async (_, value) => {
                                const groupIds =
                                    form.getFieldValue('assignee_group_ids') ||
                                    []
                                if (
                                    (!value || value.length === 0) &&
                                    groupIds.length === 0
                                ) {
                                    return Promise.reject(
                                        new Error(
                                            'Select at least one user or group.'
                                        )
                                    )
                                }
                                return Promise.resolve()
                            },
                        },
                    ]}
                >
                    <Select
                        mode="multiple"
                        allowClear
                        showSearch
                        placeholder="Select users"
                        optionFilterProp="label"
                        maxTagCount="responsive"
                        options={eligibleAssignees.map((u) => ({
                            value: u.id,
                            label: userLabel(u),
                        }))}
                        notFoundContent={
                            eligibleAssignees.length === 0
                                ? 'No active users found.'
                                : undefined
                        }
                    />
                </Form.Item>

                <Form.Item
                    label="Assignee Groups"
                    name="assignee_group_ids"
                    extra="Optionally assign whole groups (fans out per active member at task time)."
                >
                    <Select
                        mode="multiple"
                        allowClear
                        showSearch
                        placeholder="Select groups"
                        optionFilterProp="label"
                        maxTagCount="responsive"
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
            </Form>
        </Modal>
    )
}

function AssignmentHierarchyTab({ scope = 'task' }) {
    const queryClient = useQueryClient()
    const scopeNoun = scope === 'issue' ? 'issues/suggestions' : 'tasks'

    const [addModalOpen, setAddModalOpen] = useState(false)
    const [presetAssignerId, setPresetAssignerId] = useState(null)
    const [removingUserRelation, setRemovingUserRelation] = useState(null)
    const [removingGroupRelation, setRemovingGroupRelation] = useState(null)
    const [assignerSearch, setAssignerSearch] = useState('')

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

    // Assignment Hierarchy is configuration — show every active user.
    // Whether a mapping is *effective* at task-create time is enforced
    // by the backend's effective resolver (admin / Access Tasks /
    // Assign Tasks). Filtering the selector by direct-row permissions
    // hid users who had Access/Assign through a group, and made it
    // look like the hierarchy modal was missing users that the
    // Users page clearly listed.
    const eligibleAssigners = useMemo(
        () => users.filter((u) => u.is_active),
        [users]
    )
    const eligibleAssignees = useMemo(
        () => users.filter((u) => u.is_active),
        [users]
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
        queryKey: ['admin-task-assignment-relations', scope],
        queryFn: () => taskAssignmentService.list(scope),
    })
    const { data: groupRelations = [], isLoading: groupRelLoading } = useQuery({
        queryKey: ['admin-task-assignment-group-relations', scope],
        queryFn: () => taskAssignmentGroupService.list(scope),
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
        const term = assignerSearch.trim().toLowerCase()
        return ids
            .map((id) => ({
                assigner: usersById[id] || { id, full_name: id },
                userRelations: cardsByAssigner.get(id).user,
                groupRelations: cardsByAssigner.get(id).group,
            }))
            .filter(({ assigner }) => {
                if (!term) return true
                return (
                    userLabel(assigner).toLowerCase().includes(term) ||
                    (assigner.email || '').toLowerCase().includes(term)
                )
            })
            .sort((a, b) =>
                userLabel(a.assigner).localeCompare(userLabel(b.assigner))
            )
    }, [cardsByAssigner, usersById, assignerSearch])

    // Mutations — one bulk add covers any mix of users + groups in a
    // single submit. User relations go in one array call (backend skips
    // duplicates); each group is its own relation row, created in
    // parallel and tolerant of already-existing ones.
    const addRulesMutation = useMutation({
        mutationFn: async ({ assigner, userIds, groupIds }) => {
            if (userIds.length) {
                await taskAssignmentService.create({
                    assigner_user_id: assigner,
                    assignee_user_ids: userIds,
                    scope,
                })
            }
            if (groupIds.length) {
                const results = await Promise.allSettled(
                    groupIds.map((gid) =>
                        taskAssignmentGroupService.create({
                            assigner_user_id: assigner,
                            assignee_group_id: gid,
                            scope,
                        })
                    )
                )
                // 409 = "already mapped" — tolerated as a no-op. Any other
                // rejection is a genuine failure and must surface (even if
                // user relations and other groups succeeded — onSettled
                // refetch still reflects the parts that went through).
                const realFailures = results.filter(
                    (r) =>
                        r.status === 'rejected' &&
                        r.reason?.response?.status !== 409
                )
                if (realFailures.length > 0) {
                    throw realFailures[0].reason
                }
            }
        },
        onSuccess: () => {
            message.success('Assignment rules added.')
            setAddModalOpen(false)
        },
        onError: (err) => {
            message.error(
                err?.response?.data?.detail || 'Failed to add assignment rules.'
            )
        },
        onSettled: () => {
            queryClient.invalidateQueries({
                queryKey: ['admin-task-assignment-relations', scope],
            })
            queryClient.invalidateQueries({
                queryKey: ['admin-task-assignment-group-relations', scope],
            })
        },
    })

    const deleteUserMutation = useMutation({
        mutationFn: (id) => taskAssignmentService.delete(id),
        onSuccess: () => {
            message.success('User rule removed.')
            setRemovingUserRelation(null)
            queryClient.invalidateQueries({
                queryKey: ['admin-task-assignment-relations', scope],
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
                queryKey: ['admin-task-assignment-group-relations', scope],
            })
        },
        onError: (err) => {
            message.error(err?.response?.data?.detail || 'Failed to remove rule.')
            setRemovingGroupRelation(null)
        },
    })

    const handleAdd = (values) => {
        const userIds = values.assignee_user_ids || []
        const groupIds = values.assignee_group_ids || []
        if (userIds.length === 0 && groupIds.length === 0) {
            message.warning('Select at least one user or group.')
            return
        }
        addRulesMutation.mutate({
            assigner: values.assigner_user_id,
            userIds,
            groupIds,
        })
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
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                    marginBottom: 12,
                }}
            >
                <Input.Search
                    allowClear
                    placeholder="Search assigner by name or email"
                    value={assignerSearch}
                    onChange={(e) => setAssignerSearch(e.target.value)}
                    style={{ maxWidth: 320 }}
                />
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
                            : assignerSearch.trim()
                            ? 'No assigner matches your search.'
                            : `No assignment rules yet — click Add Assignment Rule to let assigners assign ${scopeNoun}.`
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
                onClose={() => {
                    setAddModalOpen(false)
                    setPresetAssignerId(null)
                }}
                onSubmit={handleAdd}
                eligibleAssigners={eligibleAssigners}
                eligibleAssignees={eligibleAssignees}
                eligibleGroups={groups}
                initialAssignerId={presetAssignerId}
                loading={addRulesMutation.isPending}
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
