/**
 * =============================================================================
 * HERMES - Proje uyeleri drawer'i (PM rework P2.1 / B2)
 * =============================================================================
 * Bir projenin uyelerini listeler; yonetebilen (projects.manage ya da o
 * projenin lead'i) ekler, rol degistirir, cikarir. Hangi dugmenin
 * gorunecegine SUNUCU karar verir (`can_manage`, `can_assign_lead`) —
 * arayuz izin kurali tekrarlamaz.
 *
 * Uyelik gorunurluk verir (A3): eklenen kisi projenin islerini hemen gorur.
 * Ayarlar › Projeler (admin) ve Explorer (lead) ayni drawer'i acar.
 * =============================================================================
 */
import { useMemo, useState } from 'react'
import { Button, Drawer, Empty, Select, Space, Tag, Typography, message } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { projectService } from '../../services/api'
import { authService } from '../../api/authApi'
import { queryKeys } from '../../query/queryKeys'
import { useT } from '../../i18n'

const { Text } = Typography

export const MEMBER_ROLES = ['lead', 'member', 'viewer']

const membersKey = (projectId) => queryKeys.projectMembers.byProject(projectId)

function ProjectMembersDrawer({ open, projectId, projectName, onClose }) {
    const t = useT()
    const queryClient = useQueryClient()
    const [newUserId, setNewUserId] = useState(null)
    const [newRole, setNewRole] = useState('member')

    const members = useQuery({
        queryKey: membersKey(projectId),
        queryFn: () => projectService.listMembers(projectId),
        enabled: open && Boolean(projectId),
    })
    const users = useQuery({
        queryKey: queryKeys.authUsersLookup.activeUsers(),
        queryFn: () => authService.lookupUsers({ include_inactive: false }),
        enabled: open,
        staleTime: 60 * 1000,
    })

    const userMap = useMemo(() => {
        const m = {}
        for (const u of users.data || []) m[String(u.id)] = u
        return m
    }, [users.data])
    const label = (id) => userMap[String(id)]?.full_name || userMap[String(id)]?.email || t('projects.unknownUser')

    const data = members.data
    const items = (data?.items || []).filter((m) => m.is_active !== false)
    const canManage = Boolean(data?.can_manage)
    const canAssignLead = Boolean(data?.can_assign_lead)
    const roleOptions = MEMBER_ROLES
        .filter((r) => r !== 'lead' || canAssignLead)
        .map((r) => ({ value: r, label: t(`projects.role_${r}`) }))

    const refresh = () => queryClient.invalidateQueries({ queryKey: membersKey(projectId) })
    const onError = (err) => message.error(err?.response?.data?.detail || err?.message || t('projects.memberError'))

    const add = useMutation({
        mutationFn: ({ userId, role }) => projectService.addMember(projectId, { user_id: userId, member_role: role }),
        onSuccess: () => { message.success(t('projects.memberAdded')); setNewUserId(null); refresh() },
        onError,
    })
    const update = useMutation({
        mutationFn: ({ membershipId, role }) => projectService.updateMember(projectId, membershipId, { member_role: role }),
        onSuccess: refresh,
        onError,
    })
    const remove = useMutation({
        mutationFn: ({ membershipId }) => projectService.removeMember(projectId, membershipId),
        onSuccess: () => { message.success(t('projects.memberRemoved')); refresh() },
        onError,
    })
    const busy = add.isPending || update.isPending || remove.isPending

    const memberIds = new Set(items.map((m) => String(m.user_id)))
    const candidateOptions = (users.data || [])
        .filter((u) => !memberIds.has(String(u.id)))
        .map((u) => ({ value: String(u.id), label: u.full_name || u.email }))

    return (
        <Drawer
            open={open}
            onClose={onClose}
            width="min(560px, 96vw)"
            title={t('projects.membersOf', { name: projectName || '' })}
            destroyOnHidden
        >
            {canManage && (
                <div className="h-project-members__add" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                    <Select
                        showSearch
                        aria-label={t('projects.pickUser')}
                        placeholder={t('projects.pickUser')}
                        value={newUserId}
                        onChange={setNewUserId}
                        options={candidateOptions}
                        filterOption={(input, option) =>
                            (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                        }
                        style={{ flex: 1 }}
                    />
                    <Select
                        aria-label={t('projects.role')}
                        value={newRole}
                        onChange={setNewRole}
                        options={roleOptions}
                        style={{ width: 130 }}
                    />
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        disabled={!newUserId || busy}
                        loading={add.isPending}
                        onClick={() => add.mutate({ userId: newUserId, role: newRole })}
                    >{t('projects.addMember')}</Button>
                </div>
            )}
            {!canManage && data && (
                <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                    {t('projects.readOnlyMembers')}
                </Text>
            )}
            {items.length === 0 ? (
                <Empty description={t('projects.noMembers')} />
            ) : (
                <ul className="h-project-members" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {items.map((m) => {
                        const isLead = m.member_role === 'lead'
                        const editable = canManage && (!isLead || canAssignLead)
                        return (
                            <li
                                key={m.id}
                                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--c-border, #eee)' }}
                            >
                                <span style={{ flex: 1 }}>{label(m.user_id)}</span>
                                {editable ? (
                                    <Select
                                        aria-label={`${t('projects.role')} — ${label(m.user_id)}`}
                                        value={m.member_role || 'member'}
                                        options={roleOptions}
                                        disabled={busy}
                                        onChange={(role) => update.mutate({ membershipId: m.id, role })}
                                        style={{ width: 130 }}
                                    />
                                ) : (
                                    <Tag>{t(`projects.role_${m.member_role || 'member'}`)}</Tag>
                                )}
                                {editable && (
                                    <Button
                                        type="text"
                                        danger
                                        icon={<DeleteOutlined />}
                                        aria-label={`${t('projects.removeMember')} — ${label(m.user_id)}`}
                                        disabled={busy}
                                        onClick={() => remove.mutate({ membershipId: m.id })}
                                    />
                                )}
                            </li>
                        )
                    })}
                </ul>
            )}
            <Space style={{ marginTop: 16 }}>
                <Text type="secondary">{t('projects.membersHint')}</Text>
            </Space>
        </Drawer>
    )
}

export default ProjectMembersDrawer
