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

import { useEffect, useMemo, useState } from 'react'
import {
    Alert,
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
    SearchOutlined,
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
import { normalizeApiError } from '../../features/admin/shared/normalizeApiError'
import { resetAndFill } from '../../features/admin/shared/formLifecycle'
import { useT } from '../../i18n'

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
    const t = useT()
    const [expanded, setExpanded] = useState(false)
    const userCount = userRelations.length
    const groupCount = groupRelations.length

    return (
        /* Kullanici bulgusu: assigner satirlari arasinda ayrim yoktu.
           Kart yerine, aralarinda ince koyu-mavi hairline bulunan
           premium satirlar. */
        <Card
            size="small"
            className="tm-assigner-card"
            style={{ marginBottom: 0 }}
            styles={{ body: { padding: 0 } }}
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
                    {/*
                      * Ust bardaki genel buton ile ayni GORUNUR metni
                      * tasiyor ama farkli sey yapiyor (bu assigner'i
                      * on-secer). Erisilebilir ad bu ayrimi soyler.
                      */}
                    <Button
                        size="small"
                        className="h-create-action"
                        icon={<PlusOutlined />}
                        aria-label={`Add assignment rule for ${userLabel(assigner)}`}
                        onClick={(e) => {
                            e.stopPropagation()
                            onAddRule(assigner.id)
                        }}
                    >{t('assignment.addRule')}</Button>
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
                        >{t('task.groups')}</div>
                        {groupRelations.length === 0 ? (
                            <div
                                style={{
                                    color: 'var(--c-text-faint)',
                                    fontSize: 12,
                                    fontStyle: 'italic',
                                }}
                            >{t('assignment.noGroupAssignments')}</div>
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
                                        {/* Tooltip erisilebilir AD VERMEZ. */}
                                        <Tooltip title={t('assignment.removeGroupFromAssigner')}>
                                            <Button
                                                size="small"
                                                danger
                                                icon={<DeleteOutlined />}
                                                aria-label={
                                                    `Remove group ${g?.name
                                                        || rel.assignee_group_id} `
                                                    + `from ${userLabel(assigner)}`
                                                }
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
                        >{t('task.users')}</div>
                        {userRelations.length === 0 ? (
                            <div
                                style={{
                                    color: 'var(--c-text-faint)',
                                    fontSize: 12,
                                    fontStyle: 'italic',
                                }}
                            >{t('assignment.noUserAssignments')}</div>
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
                                        {/* Tooltip erisilebilir AD VERMEZ. */}
                                        <Tooltip title={t('assignment.removeUserFromAssigner')}>
                                            <Button
                                                size="small"
                                                danger
                                                icon={<DeleteOutlined />}
                                                aria-label={
                                                    `Remove ${u ? userLabel(u)
                                                        : rel.assignee_user_id} `
                                                    + `from ${userLabel(assigner)}`
                                                }
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
    const t = useT()
    const [form] = Form.useForm()

    /**
     * Her acilista TAM sekil yazilir. `initialValues` yalnizca mount'ta
     * uygulanir ve `afterClose` icindeki resetFields O ANDAKI initial
     * degerlere doner; bu yuzden bir karttan on-secili assigner ile
     * acildiktan sonra genel butondan acmak eski assigner'i
     * BIRAKABILIYORDU. Coklu secimler de acikca temizlenir.
     */
    useEffect(() => {
        if (!open) return
        resetAndFill(form, {
            assigner_user_id: initialAssignerId || undefined,
            assignee_user_ids: [],
            assignee_group_ids: [],
        })
    }, [open, initialAssignerId, form])

    return (
        <Modal
            title={t('assignment.addRules')}
            open={open}
            onCancel={onClose}
            onOk={() => {
                // Cift gonderim kilidi KAYNAKTA.
                if (loading) return
                form.submit()
            }}
            okText={t('common.save')}
            confirmLoading={loading}
            destroyOnHidden
            closable={!loading}
            maskClosable={!loading}
            keyboard={!loading}
        >
            <Form
                form={form}
                layout="vertical"
                onFinish={onSubmit}
            >
                <Form.Item
                    label={t('assignment.assigner')}
                    name="assigner_user_id"
                    rules={[{ required: true, message: t('assignment.pickAssigner') }]}
                >
                    <Select
                        showSearch
                        placeholder={t('assignment.selectAssigner')}
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
                    label={t('assignment.assigneeUsers')}
                    name="assignee_user_ids"
                    extra={t('assignment.pickTargets')}
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
                        placeholder={t('assignment.selectUsers')}
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
                    label={t('assignment.assigneeGroups')}
                    name="assignee_group_ids"
                    extra={t('assignment.groupsHint')}
                >
                    <Select
                        mode="multiple"
                        allowClear
                        showSearch
                        placeholder={t('assignment.selectGroups')}
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
    const t = useT()
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

    const {
        data: userRelations = [], isLoading: userRelLoading,
        isError: userRelError, error: userRelErrObj, refetch: refetchUserRel,
    } = useQuery({
        queryKey: ['admin-task-assignment-relations', scope],
        queryFn: () => taskAssignmentService.list(scope),
    })
    const {
        data: groupRelations = [], isLoading: groupRelLoading,
        isError: groupRelError, error: groupRelErrObj, refetch: refetchGroupRel,
    } = useQuery({
        queryKey: ['admin-task-assignment-group-relations', scope],
        queryFn: () => taskAssignmentGroupService.list(scope),
    })

    /**
     * Kurallar IKI sorgudan gelir. Biri basarisiz olursa geri kalan
     * kartlar EKSIK bir hiyerarsiyi TAM gibi gosterir — yetki verisinde
     * bu yaniltici. Hata acikca bildirilir ve yeniden denenebilir.
     */
    const relationsError = userRelError
        ? { message: normalizeApiError(userRelErrObj).message, retry: refetchUserRel }
        : groupRelError
            ? {
                message: `${normalizeApiError(groupRelErrObj).message} `
                    + 'Group rules are missing from the list below.',
                retry: refetchGroupRel,
            }
            : null

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
            message.success(t('assignment.rulesAdded'))
            setAddModalOpen(false)
        },
        onError: (err) => {
            message.error(normalizeApiError(err).message)
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
            message.success(t('assignment.userRuleRemoved'))
            setRemovingUserRelation(null)
            queryClient.invalidateQueries({
                queryKey: ['admin-task-assignment-relations', scope],
            })
        },
        onError: (err) => {
            message.error(normalizeApiError(err).message)
            setRemovingUserRelation(null)
        },
    })

    const deleteGroupMutation = useMutation({
        mutationFn: (id) => taskAssignmentGroupService.delete(id),
        onSuccess: () => {
            message.success(t('assignment.groupRuleRemoved'))
            setRemovingGroupRelation(null)
            queryClient.invalidateQueries({
                queryKey: ['admin-task-assignment-group-relations', scope],
            })
        },
        onError: (err) => {
            message.error(normalizeApiError(err).message)
            setRemovingGroupRelation(null)
        },
    })

    const isAddingRules = addRulesMutation.isPending
    const isRemovingRule =
        deleteUserMutation.isPending || deleteGroupMutation.isPending

    const handleAdd = (values) => {
        // Cift gonderim kilidi KAYNAKTA.
        if (isAddingRules) return
        const userIds = values.assignee_user_ids || []
        const groupIds = values.assignee_group_ids || []
        if (userIds.length === 0 && groupIds.length === 0) {
            message.warning(t('assignment.selectAtLeastOne'))
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
                {/*
                  * `Input.Search` DEGIL: filtre zaten yazarken canli
                  * uygulaniyor, dolayisiyla arama BUTONU hicbir sey
                  * yapmiyordu — ustelik zayif adlandirilmis ("search")
                  * fazladan bir dokunma hedefi ekliyordu. Sozluk
                  * yuzeylerinde ayni karar verilmisti.
                  */}
                <Input
                    prefix={<SearchOutlined aria-hidden="true" />}
                    aria-label={t('assignment.searchAssigner')}
                    allowClear
                    placeholder={t('assignment.searchAssigner')}
                    value={assignerSearch}
                    onChange={(e) => setAssignerSearch(e.target.value)}
                    style={{ maxWidth: 320 }}
                />
                <Button
                    className="h-create-action"
                    icon={<PlusOutlined />}
                    /* Kart icindeki ayni metinli butondan AYRI ad: bu
                       hicbir assigner'i on-secmez. */
                    aria-label={t('assignment.addRuleShort')}
                    onClick={() => {
                        setPresetAssignerId(null)
                        setAddModalOpen(true)
                    }}
                >{t('assignment.addRule')}</Button>
            </div>

            {relationsError && (
                <Alert
                    type="error"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message={relationsError.message}
                    action={
                        <Button size="small" onClick={() => relationsError.retry()}>{t('common.retry')}</Button>
                    }
                />
            )}

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
                title={t('assignment.removeMapping')}
                body="This prevents future assignment through this mapping. Existing tasks remain unchanged."
                itemName={
                    removingUser
                        ? userLabel(removingUser)
                        : removingUserRelation?.assignee_user_id
                }
                confirmLabel="Remove"
                onCancel={() => setRemovingUserRelation(null)}
                onConfirm={() => {
                    // Cift tetikleme kilidi KAYNAKTA.
                    if (isRemovingRule || !removingUserRelation) return
                    deleteUserMutation.mutate(removingUserRelation.id)
                }}
                loading={isRemovingRule}
            />

            <DangerConfirmModal
                open={!!removingGroupRelation}
                title={t('assignment.removeMapping')}
                body="This prevents future assignment through this mapping. Existing tasks remain unchanged."
                itemName={removingGroupName}
                confirmLabel="Remove"
                onCancel={() => setRemovingGroupRelation(null)}
                onConfirm={() => {
                    if (isRemovingRule || !removingGroupRelation) return
                    deleteGroupMutation.mutate(removingGroupRelation.id)
                }}
                loading={isRemovingRule}
            />
        </>
    )
}

export default AssignmentHierarchyTab
