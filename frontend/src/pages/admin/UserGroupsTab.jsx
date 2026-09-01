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
    Alert,
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
import { normalizeApiError } from '../../features/admin/shared/normalizeApiError'
import { useT } from '../../i18n'

// ─────────────────────────────────────────────────────────────────────────────
// Virtual group helpers
// ─────────────────────────────────────────────────────────────────────────────

const VIRTUAL_ADMINS_ID = '__virtual_admins__'
const VIRTUAL_GENERAL_ID = '__virtual_general__'

// `t` PARAMETRE olarak gelir: bu saf bir yardimci, bilesen degil —
// hook cagiramaz. Cagiran bilesen kendi `t`'sini gecirir.
function buildVirtualGroups(users, t) {
    const admins = users.filter((u) => u.is_admin)
    const general = users.filter((u) => !u.is_admin && u.is_active)
    return [
        {
            id: VIRTUAL_ADMINS_ID,
            name: 'Admins',
            description: t('groups.builtInAdmins'),
            is_active: true,
            member_count: admins.length,
            virtual: true,
            members: admins,
        },
        {
            id: VIRTUAL_GENERAL_ID,
            name: 'General Users',
            description: t('groups.builtInAllUsers'),
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
    const t = useT()
    const columns = [
        {
            title: t('entity.user'),
            dataIndex: 'full_name',
            render: (val, row) => val || row.email || row.id,
        },
        { title: t('users.email'), dataIndex: 'email' },
        {
            title: t('groups.authRole'),
            dataIndex: 'role',
            render: (val, row) =>
                row.is_admin ? (
                    <Tag color="gold">ADMIN</Tag>
                ) : (
                    <Tag color="blue">{val || 'USER'}</Tag>
                ),
        },
        {
            title: t('groups.memberTitle'),
            key: 'title',
            render: () => <span style={{ color: 'var(--c-text-muted)' }}>—</span>,
        },
    ]

    return (
        <div style={{ padding: '8px 0' }}>
            <div style={{ marginBottom: 8, color: 'var(--c-text-muted)' }}>
                {users.length} member{users.length === 1 ? '' : 's'} ·{' '}
                membership is automatic — managed via user role.
            </div>
            <Table
                rowKey="id"
                size="small"
                columns={columns}
                dataSource={users}
                pagination={false}
                locale={{ emptyText: t('groups.noMatchingUsers') }}
            />
        </div>
    )
}

function RealMembersTable({ group, allUsersById, users }) {
    const t = useT()
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
            message.success(t('groups.memberUpdated'))
            setMemberModalOpen(false)
            setEditingMember(null)
            queryClient.invalidateQueries({
                queryKey: ['admin-user-group-members', group.id],
            })
        },
        // Hata mesaji MODAL icinde form seviyesinde gosterilir
        // (mutateAsync reddi oraya ulasir); burada tekrar toast atmak
        // ayni hatayi iki kez anlatirdi.
    })

    const handleBulkAdd = async ({ user_ids: userIds = [], title = null }) => {
        if (!userIds.length) return
        // Cift tetikleme kilidi KAYNAKTA.
        if (bulkAdding) return
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
            // Kismi basari SESSIZCE yutulmaz: basarili olanlar yukarida
            // bildirildi, basarisiz olanlar burada.
            const firstFail = results.find((r) => r.status === 'rejected')
            if (failed > 0 && succeeded > 0) {
                message.error(
                    `${normalizeApiError(firstFail?.reason).message} `
                    + `(${failed} of ${results.length} could not be added.)`
                )
            }
            // Hicbiri eklenemediyse hata MODALA firlatilir: kullanici
            // secimini kaybetmeden form seviyesinde mesaji gorur.
            queryClient.invalidateQueries({
                queryKey: ['admin-user-group-members', group.id],
            })
            queryClient.invalidateQueries({ queryKey: ['admin-user-groups'] })
            queryClient.invalidateQueries({ queryKey: ['task-permissions'] })
            if (succeeded > 0) {
                setMemberModalOpen(false)
                setEditingMember(null)
            } else if (firstFail) {
                throw firstFail.reason
            }
        } finally {
            setBulkAdding(false)
        }
    }

    const removeMutation = useMutation({
        mutationFn: (memberId) => userGroupService.removeMember(group.id, memberId),
        onSuccess: () => {
            message.success(t('groups.memberRemoved'))
            setRemovingMember(null)
            queryClient.invalidateQueries({
                queryKey: ['admin-user-group-members', group.id],
            })
            queryClient.invalidateQueries({ queryKey: ['admin-user-groups'] })
            queryClient.invalidateQueries({ queryKey: ['task-permissions'] })
        },
        onError: (err) => {
            message.error(normalizeApiError(err).message)
            setRemovingMember(null)
        },
    })

    const isRemoving = removeMutation.isPending

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
            title: t('entity.user'),
            dataIndex: 'user_id',
            render: (uid) => {
                const u = allUsersById[uid]
                return u?.full_name || u?.email || uid
            },
        },
        {
            title: t('users.email'),
            dataIndex: 'user_id',
            key: 'email',
            render: (uid) => allUsersById[uid]?.email || '—',
        },
        {
            title: t('groups.authRole'),
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
            title: t('groups.memberTitle'),
            dataIndex: 'title',
            render: (val) => val || <span style={{ color: 'var(--c-text-muted)' }}>—</span>,
        },
        {
            title: t('common.actions'),
            key: 'actions',
            render: (_, record) => (
                <Space onClick={(e) => e.stopPropagation()}>
                    {/*
                      * AntD `Tooltip` erisilebilir AD VERMEZ (title
                      * attribute'u basmaz, portala cizer). Ikon-only
                      * butonlarin adi bu yuzden acikca yazilir.
                      */}
                    <Tooltip title={t('groups.editMemberTitle')}>
                        <Button
                            size="small"
                            icon={<EditOutlined />}
                            aria-label={`Edit title for ${
                                allUsersById[record.user_id]?.full_name
                                || allUsersById[record.user_id]?.email
                                || record.user_id
                            }`}
                            disabled={isRemoving}
                            onClick={() => {
                                setEditingMember(record)
                                setMemberModalOpen(true)
                            }}
                        />
                    </Tooltip>
                    <Tooltip title={t('groups.removeFromGroup')}>
                        <Button
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            aria-label={`Remove ${
                                allUsersById[record.user_id]?.full_name
                                || allUsersById[record.user_id]?.email
                                || record.user_id
                            } from group`}
                            disabled={isRemoving}
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
                <span style={{ color: 'var(--c-text-muted)' }}>
                    {members.length} member{members.length === 1 ? '' : 's'}
                </span>
                <Button
                    size="small"
                    className="h-create-action"
                    icon={<UserAddOutlined />}
                    onClick={(e) => {
                        e.stopPropagation()
                        setEditingMember(null)
                        setMemberModalOpen(true)
                    }}
                >{t('groups.addMember')}</Button>
            </div>

            <Table
                rowKey="id"
                size="small"
                columns={columns}
                dataSource={members}
                loading={isLoading}
                pagination={false}
                locale={{ emptyText: t('groups.noMembers') }}
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
                title={t('groups.removeMemberConfirm')}
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
                onConfirm={() => {
                    if (isRemoving || !removingMember) return
                    removeMutation.mutate(removingMember.id)
                }}
                loading={isRemoving}
            />
        </div>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab
// ─────────────────────────────────────────────────────────────────────────────

function UserGroupsTab() {
    const t = useT()
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

    const {
        data: realGroups = [], isLoading, isError, error, refetch,
    } = useQuery({
        queryKey: ['admin-user-groups'],
        queryFn: () => userGroupService.list(),
    })

    const virtualGroups = useMemo(
        () => buildVirtualGroups(users, t), [users, t],
    )

    // Virtual groups always first; admin-created groups follow alphabetically.
    const allRows = useMemo(
        () => [...virtualGroups, ...realGroups],
        [virtualGroups, realGroups]
    )

    const createMutation = useMutation({
        mutationFn: (data) => userGroupService.create(data),
        onSuccess: () => {
            message.success(t('groups.groupCreated'))
            setGroupModalOpen(false)
            setEditingGroup(null)
            queryClient.invalidateQueries({ queryKey: ['admin-user-groups'] })
        },
        // Hata MODAL icinde form seviyesinde gosterilir (mutateAsync
        // reddi oraya ulasir) — ayni hatayi iki kez anlatmiyoruz.
    })

    const updateMutation = useMutation({
        mutationFn: ({ groupId, data }) => userGroupService.update(groupId, data),
        onSuccess: () => {
            message.success(t('groups.groupUpdated'))
            setGroupModalOpen(false)
            setEditingGroup(null)
            queryClient.invalidateQueries({ queryKey: ['admin-user-groups'] })
        },
        // Hata MODAL icinde form seviyesinde gosterilir.
    })

    const deactivateMutation = useMutation({
        mutationFn: (groupId) => userGroupService.deactivate(groupId),
        onSuccess: () => {
            message.success(t('groups.groupArchived'))
            setDeletingGroup(null)
            queryClient.invalidateQueries({ queryKey: ['admin-user-groups'] })
            queryClient.invalidateQueries({ queryKey: ['task-permissions'] })
        },
        onError: (err) => {
            message.error(normalizeApiError(err).message)
            setDeletingGroup(null)
        },
    })

    const isSavingGroup = createMutation.isPending || updateMutation.isPending
    const isArchivingGroup = deactivateMutation.isPending

    const handleSubmit = async (payload, groupId) => {
        if (groupId) {
            await updateMutation.mutateAsync({ groupId, data: payload })
        } else {
            await createMutation.mutateAsync(payload)
        }
    }

    const columns = [
        {
            title: t('group.name'),
            dataIndex: 'name',
            render: (val, row) =>
                row.virtual ? (
                    <Space>
                        <strong>{val}</strong>
                        <Tag>{t('groups.builtIn')}</Tag>
                    </Space>
                ) : (
                    <strong>{val}</strong>
                ),
        },
        {
            title: t('common.description'),
            dataIndex: 'description',
            render: (val) => val || <span style={{ color: 'var(--c-text-muted)' }}>—</span>,
        },
        {
            title: t('groups.members'),
            dataIndex: 'member_count',
            width: 100,
            align: 'center',
        },
        {
            title: t('common.actions'),
            key: 'actions',
            width: 200,
            render: (_, record) =>
                record.virtual ? (
                    <span style={{ color: 'var(--c-text-muted)' }}>—</span>
                ) : (
                    <Space onClick={(e) => e.stopPropagation()}>
                        <Tooltip title={t('groups.editGroup')}>
                            <Button
                                size="small"
                                icon={<EditOutlined />}
                                aria-label={`Edit ${record.name}`}
                                disabled={isArchivingGroup}
                                onClick={() => {
                                    setEditingGroup(record)
                                    setGroupModalOpen(true)
                                }}
                            />
                        </Tooltip>
                        {/*
                          * Backend `deactivate` cagirir (soft): kayit ve
                          * gecmis korunur. UI buna "Delete" DEMEZ.
                          */}
                        <Button
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            aria-label={`Archive ${record.name}`}
                            disabled={isArchivingGroup}
                            onClick={() => setDeletingGroup(record)}
                        >{t('groups.archive')}</Button>
                    </Space>
                ),
        },
    ]

    return (
        <>
            {isError && (
                <Alert
                    type="error"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message={normalizeApiError(error).message}
                    action={
                        <Button size="small" onClick={() => refetch()}>{t('common.retry')}</Button>
                    }
                />
            )}
            <div
                style={{
                    marginBottom: 12,
                    display: 'flex',
                    justifyContent: 'flex-end',
                }}
            >
                <Button
                    className="h-create-action"
                    icon={<PlusOutlined />}
                    onClick={() => {
                        setEditingGroup(null)
                        setGroupModalOpen(true)
                    }}
                >{t('groups.createGroup')}</Button>
            </div>

            <Table
                rowKey="id"
                columns={columns}
                dataSource={allRows}
                loading={isLoading}
                pagination={{ pageSize: 20 }}
                locale={{
                    emptyText: t('groups.noGroups'),
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
                loading={isSavingGroup}
            />

            <DangerConfirmModal
                open={!!deletingGroup}
                title={t('groups.archiveGroup')}
                body="This removes the group from active use. Membership, user accounts and existing tasks remain unchanged, and the group can be restored by an administrator."
                itemName={deletingGroup?.name}
                itemSubtitle={
                    deletingGroup
                        ? `${deletingGroup.member_count ?? 0} member${
                              deletingGroup.member_count === 1 ? '' : 's'
                          }`
                        : null
                }
                confirmLabel="Archive Group"
                onCancel={() => setDeletingGroup(null)}
                onConfirm={() => {
                    if (isArchivingGroup || !deletingGroup) return
                    deactivateMutation.mutate(deletingGroup.id)
                }}
                loading={isArchivingGroup}
            />
        </>
    )
}

export default UserGroupsTab
