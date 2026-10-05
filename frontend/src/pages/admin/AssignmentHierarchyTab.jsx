/**
 * =============================================================================
 * HERMES - Assignment Hierarchy Tab (Admin → Task Management)
 * =============================================================================
 * Replaces the old flat "assigner | assignee | created | actions" table
 * with assigner-grouped expandable rows. Each assigner can map to:
 *   - individual users  (task_assignment_relations)
 *   - whole user groups (task_assignment_group_relations)
 *
 * Assigning to a group at task-creation time fans the task out to one
 * row per active group member; the assignment rule itself stays a single
 * record.
 *
 * Hermes Liquid (29.09): satirlar avatar + ad + sayac haplari; acilan
 * govde iki kolon (gruplar | kisiler). Davranis ve veri akisi AYNI.
 * =============================================================================
 */

import { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Form,
    Input,
    Modal,
    Select,
    Spin,
    Tooltip,
    message,
} from 'antd'
import {
    ApartmentOutlined, DeleteOutlined, DownOutlined, PlusOutlined, SearchOutlined, TeamOutlined, UserOutlined,
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
import { Avatar, FormSection, ModalHead } from '../../components/liquid'
import { SettingsEmpty } from './settingsKit'
import { selectFilter, matchesAny } from '../../utils/searchText'

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
    const assignerName = userLabel(assigner)

    return (
        /* Assigner basina bir liste satiri. Satiri acan kontrol GERCEK bir
           buton; "kural ekle" onun KARDESI (ic ice interaktif yok). */
        <div className={`ah-row${expanded ? ' is-open' : ''}`}>
            <div className="ah-row__head">
                <button
                    type="button"
                    className="ah-row__toggle"
                    aria-expanded={expanded}
                    onClick={() => setExpanded((v) => !v)}
                >
                    <Avatar id={assigner.id} name={assignerName} size={34} />
                    <span className="sk-person__text ah-row__who">
                        <span className="sk-person__name">{assignerName}</span>
                        {assigner.email && (
                            <span className="sk-person__meta">{assigner.email}</span>
                        )}
                    </span>
                    <span className="ah-row__tags">
                        <span className="lq-tag lq-tag--info">
                            <UserOutlined aria-hidden="true" />
                            {t(userCount === 1 ? 'assignment.userOne' : 'assignment.userMany', { n: userCount })}
                        </span>
                        <span className="lq-tag lq-tag--violet">
                            <TeamOutlined aria-hidden="true" />
                            {t(groupCount === 1 ? 'assignment.groupOne' : 'assignment.groupMany', { n: groupCount })}
                        </span>
                    </span>
                    <DownOutlined className="ah-row__chev" aria-hidden="true" />
                </button>
                {/*
                  * Satir basina ikonlu kisayol: ust bardaki genel
                  * butondan farkli sey yapar (bu assigner'i on-secer).
                  * Erisilebilir ad bu ayrimi soyler (Tooltip ad VERMEZ).
                  */}
                <Tooltip title={t('assignment.addRuleFor', { name: assignerName })}>
                    <Button
                        size="small"
                        className="h-inline-action ah-row__add"
                        icon={<PlusOutlined />}
                        aria-label={t('assignment.addRuleFor', { name: assignerName })}
                        onClick={() => onAddRule(assigner.id)}
                    />
                </Tooltip>
            </div>

            {expanded && (
                <div className="ah-row__body">
                    <div className="ah-col">
                        <FormSection>{t('task.groups')}</FormSection>
                        {groupRelations.length === 0 ? (
                            <p className="ah-none">{t('assignment.noGroupAssignments')}</p>
                        ) : (
                            <ul className="ah-list">
                                {groupRelations.map((rel) => {
                                    const g = groupsById[rel.assignee_group_id]
                                    const groupName = g?.name || rel.assignee_group_id
                                    const count = groupMemberCounts[rel.assignee_group_id] ?? 0
                                    return (
                                        <li key={rel.id} className="ah-item">
                                            <span className="ah-item__group" aria-hidden="true"><TeamOutlined /></span>
                                            <span className="sk-person__text">
                                                <span className="sk-person__name">{groupName}</span>
                                                <span className="sk-person__meta">
                                                    {t(count === 1 ? 'assignment.memberOne' : 'assignment.memberMany', { n: count })}
                                                </span>
                                            </span>
                                            {/* Tooltip erisilebilir AD VERMEZ. */}
                                            <Tooltip title={t('assignment.removeGroupFromAssigner')}>
                                                <Button
                                                    size="small"
                                                    className="h-inline-action h-inline-action--danger"
                                                    icon={<DeleteOutlined />}
                                                    aria-label={t('assignment.removeGroupAria', {
                                                        group: groupName, assigner: assignerName,
                                                    })}
                                                    onClick={() => onRemoveGroupRelation(rel)}
                                                />
                                            </Tooltip>
                                        </li>
                                    )
                                })}
                            </ul>
                        )}
                    </div>

                    <div className="ah-col">
                        <FormSection>{t('task.users')}</FormSection>
                        {userRelations.length === 0 ? (
                            <p className="ah-none">{t('assignment.noUserAssignments')}</p>
                        ) : (
                            <ul className="ah-list">
                                {userRelations.map((rel) => {
                                    const u = usersById[rel.assignee_user_id]
                                    const name = u ? userLabel(u) : rel.assignee_user_id
                                    return (
                                        <li key={rel.id} className="ah-item">
                                            <Avatar id={rel.assignee_user_id} name={name} size={28} />
                                            <span className="sk-person__text">
                                                <span className="sk-person__name">{name}</span>
                                                {u?.email && (
                                                    <span className="sk-person__meta">{u.email}</span>
                                                )}
                                            </span>
                                            {/* Tooltip erisilebilir AD VERMEZ. */}
                                            <Tooltip title={t('assignment.removeUserFromAssigner')}>
                                                <Button
                                                    size="small"
                                                    className="h-inline-action h-inline-action--danger"
                                                    icon={<DeleteOutlined />}
                                                    aria-label={t('assignment.removeUserAria', {
                                                        user: name, assigner: assignerName,
                                                    })}
                                                    onClick={() => onRemoveUserRelation(rel)}
                                                />
                                            </Tooltip>
                                        </li>
                                    )
                                })}
                            </ul>
                        )}
                    </div>
                </div>
            )}
        </div>
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
            title={<ModalHead icon={<ApartmentOutlined />} tone="violet" title={t('assignment.addRules')} />}
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
                        filterOption={selectFilter}
                        options={eligibleAssigners.map((u) => ({
                            value: u.id,
                            label: userLabel(u),
                        }))}
                        notFoundContent={
                            eligibleAssigners.length === 0
                                ? t('assignment.noActiveUsers')
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
                                        new Error(t('assignment.selectAtLeastOne'))
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
                        filterOption={selectFilter}
                        maxTagCount="responsive"
                        options={eligibleAssignees.map((u) => ({
                            value: u.id,
                            label: userLabel(u),
                        }))}
                        notFoundContent={
                            eligibleAssignees.length === 0
                                ? t('assignment.noActiveUsers')
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
                        filterOption={selectFilter}
                        maxTagCount="responsive"
                        options={eligibleGroups.map((g) => ({
                            value: g.id,
                            label: g.name,
                        }))}
                        notFoundContent={
                            eligibleGroups.length === 0
                                ? t('assignment.noActiveGroups')
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
                    + t('assignment.groupRulesMissing'),
                retry: refetchGroupRel,
            }
            : null

    // Group rules per assigner so we can render one row per assigner.
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
        const term = assignerSearch.trim()
        return ids
            .map((id) => ({
                assigner: usersById[id] || { id, full_name: id },
                userRelations: cardsByAssigner.get(id).user,
                groupRelations: cardsByAssigner.get(id).group,
            }))
            .filter(({ assigner }) => {
                if (!term) return true
                return matchesAny([userLabel(assigner), assigner.email], term)
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

    const openGeneralAdd = () => {
        setPresetAssignerId(null)
        setAddModalOpen(true)
    }

    const isLoading = userRelLoading || groupRelLoading
    const hasAnyRule = cardsByAssigner.size > 0
    const searching = assignerSearch.trim().length > 0
    const removingUser =
        removingUserRelation && usersById[removingUserRelation.assignee_user_id]
    const removingGroupName =
        removingGroupRelation &&
        (groupsById[removingGroupRelation.assignee_group_id]?.name || '—')

    /* Genel "kural ekle" eylemi: kart icindeki ayni metinli butondan AYRI
       ad tasir (hicbir assigner'i on-secmez). */
    const addAction = (
        <Button
            className="h-create-action"
            icon={<PlusOutlined />}
            aria-label={t('assignment.addRuleShort')}
            onClick={openGeneralAdd}
        >{t('assignment.addRule')}</Button>
    )

    let content
    if (sortedAssignerCards.length > 0) {
        content = (
            <div className="ah-rows">
                {sortedAssignerCards.map(({ assigner, userRelations: ur, groupRelations: gr }) => (
                    <AssignerCard
                        key={assigner.id}
                        assigner={assigner}
                        userRelations={ur}
                        groupRelations={gr}
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
                ))}
            </div>
        )
    } else if (isLoading) {
        content = <div className="ah-loading"><Spin /></div>
    } else if (searching) {
        content = (
            <SettingsEmpty
                compact
                icon={<SearchOutlined />}
                text={t('assignment.noMatch')}
            />
        )
    } else {
        content = (
            <SettingsEmpty
                icon={<ApartmentOutlined />}
                title={t('assignment.emptyTitle')}
                text={t(scope === 'issue' ? 'assignment.emptyTextIssue' : 'assignment.emptyTextTask')}
                action={addAction}
            />
        )
    }

    return (
        <>
            {/* Ilk kullanimda arac cubugu gizlenir: bos durum kendi eylemini
                tasir (ayni buton iki kez gorunmez). */}
            {(hasAnyRule || searching) && (
                <div className="sk-toolbar">
                    {/*
                      * `Input.Search` DEGIL: filtre zaten yazarken canli
                      * uygulaniyor, dolayisiyla arama BUTONU hicbir sey
                      * yapmiyordu — ustelik zayif adlandirilmis ("search")
                      * fazladan bir dokunma hedefi ekliyordu.
                      */}
                    <Input
                        className="ah-search"
                        prefix={<SearchOutlined aria-hidden="true" />}
                        aria-label={t('assignment.searchAssigner')}
                        allowClear
                        placeholder={t('assignment.searchAssigner')}
                        value={assignerSearch}
                        onChange={(e) => setAssignerSearch(e.target.value)}
                    />
                    {addAction}
                </div>
            )}

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

            {content}

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
                body={t('assignment.removeMappingBody')}
                itemName={
                    removingUser
                        ? userLabel(removingUser)
                        : removingUserRelation?.assignee_user_id
                }
                confirmLabel={t('assignment.remove')}
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
                body={t('assignment.removeMappingBody')}
                itemName={removingGroupName}
                confirmLabel={t('assignment.remove')}
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
