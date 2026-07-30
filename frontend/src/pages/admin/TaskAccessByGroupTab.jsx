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

import { useEffect, useMemo, useRef, useState } from 'react'
import {
    Button,
    Input,
    Progress,
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
    taskPermissionService,
    userGroupService,
} from '../../services/api'
import {
    applyAssignRequiresAccess, classifyBulkResult, mergeMemberPermissions,
} from '../../features/admin/permissions/model/effectivePermission'
import {
    errorText, failedTargets, runBulkOverrides,
} from '../../features/admin/permissions/model/bulkOverrides'
import { normalizeApiError } from '../../features/admin/shared/normalizeApiError'

// ─────────────────────────────────────────────────────────────────────────────
// Member overrides panel — rendered inside each group's expanded row
// ─────────────────────────────────────────────────────────────────────────────

function GroupMemberOverridesPanel({ group, allUsersById, groupPermission }) {
    const queryClient = useQueryClient()

    const { data: members = [], isLoading: membersLoading } = useQuery({
        queryKey: ['admin-user-group-members', group.id],
        queryFn: () => userGroupService.listMembers(group.id),
    })

    const { data: overrides = [], isLoading: overridesLoading } = useQuery({
        queryKey: ['admin-task-group-member-overrides', group.id],
        queryFn: () => taskGroupPermissionService.listMemberOverrides(group.id),
    })

    // Izin yazmalarindan sonra tazelenmesi gereken TAM kume — tek yerde.
    // Ilgisiz cache (Time Entry, genel uygulama) DOKUNULMAZ.
    const refreshPermissionQueries = () => {
        queryClient.invalidateQueries({
            queryKey: ['admin-task-group-member-overrides', group.id],
        })
        queryClient.invalidateQueries({
            queryKey: ['admin-task-permissions-effective'],
        })
        queryClient.invalidateQueries({ queryKey: ['task-permissions'] })
    }

    const upsertMutation = useMutation({
        mutationFn: ({ userId, data }) =>
            taskGroupPermissionService.upsertMemberOverride(group.id, userId, data),
        onSuccess: () => {
            message.success('Override saved.')
            refreshPermissionQueries()
        },
        onError: (err) => {
            // Sunum katmani: sunucunun domain aciklamasi korunur,
            // teknik govde ve 5xx icerigi kullaniciya gosterilmez.
            message.error(normalizeApiError(err).message)
        },
    })

    // ── Toplu uygulama ────────────────────────────────────────────────
    // Uye override ucu TEK UYELIKtir → N uye = N istek, islem ATOMIK
    // DEGIL. Arayuz atomikmis gibi davranmaz: ilerleme sayilir, her
    // uyenin gercek sonucu saklanir, kismi basari ASLA tam basari gibi
    // gosterilmez ve yeniden deneme YALNIZCA basarisizlari kapsar.
    const [bulk, setBulk] = useState(null)
    const abortRef = useRef({ aborted: false })

    // Panel kapanirsa/unmount olursa surucu susar: unmount sonrasi
    // state guncellemesi ve unhandled rejection olusmaz.
    useEffect(() => {
        const flag = abortRef.current
        return () => { flag.aborted = true }
    }, [])

    const applyToMembers = async (targets, data, label) => {
        // Ayni panelde ikinci bir toplu islem baslatilamaz.
        if (bulk?.running) return
        if (!targets.length) {
            message.info('No members to update.')
            return
        }
        setBulk({
            running: true, label, data,
            progress: { total: targets.length, completed: 0, succeeded: 0, failed: 0 },
            results: null,
        })
        const { results, aborted } = await runBulkOverrides({
            targets,
            data,
            signal: abortRef.current,
            apply: ({ userId, data: patch }) =>
                taskGroupPermissionService.upsertMemberOverride(group.id, userId, patch),
            onProgress: (progress) =>
                setBulk((prev) => (prev ? { ...prev, progress } : prev)),
        })
        if (aborted) return

        const outcome = classifyBulkResult(results)
        setBulk((prev) => (prev ? { ...prev, running: false, results, outcome } : prev))

        // Sunucu gercegini yeniden oku — kismi basarida cache'i "hepsi
        // basarili" durumuna ZORLAMAYIZ; basarili uyeler yeni degeri,
        // basarisiz uyeler eski degeri gosterir.
        refreshPermissionQueries()

        if (outcome.kind === 'success') {
            message.success(`${outcome.total} member(s) updated.`)
        } else if (outcome.kind === 'partial') {
            message.warning(
                `${outcome.total - outcome.failed.length} of ${outcome.total} updated — `
                + `${outcome.failed.length} failed.`
            )
        } else if (outcome.kind === 'error') {
            message.error(`All ${outcome.total} update(s) failed.`)
        }
    }

    const retryFailed = () => {
        if (!bulk?.results) return
        const byId = Object.fromEntries(rows.map((r) => [r.user_id, r]))
        applyToMembers(failedTargets(bulk.results, byId), bulk.data, bulk.label)
    }

    // Simple binary toggle: ON = explicit TRUE override, OFF = explicit
    // FALSE override. The "inherit-from-default" tri-state is gone in v1
    // for a cleaner UX; the underlying nullable column is preserved on
    // the backend so old NULL rows still resolve to the group default.
    const handleMemberToggle = (member, kind, checked) => {
        const fieldByKind = {
            access: 'can_access_tasks_override',
            assign: 'can_assign_tasks_override',
            access_issues: 'can_access_issues_override',
            assign_issues: 'can_assign_issues_override',
        }
        const fieldName = fieldByKind[kind]
        upsertMutation.mutate({
            userId: member.user_id,
            data: { [fieldName]: !!checked },
        })
    }

    // KUSUR DUZELTMESI (Sprint 6B): overrides ucu YALNIZCA override
    // satiri olan uyeler icin kayit doner. Eski kod `!!o?.effective_...`
    // okudugu icin, satiri olmayan (yani grup default'unu DEVRALAN) her
    // uye KAPALI gorunuyordu — grup izni ACIK olsa bile. Efektif deger
    // artik grup default'uyla birlikte, backend kuralinin birebir
    // portundan hesaplanir (features/admin/permissions/model).
    const rows = useMemo(
        () =>
            mergeMemberPermissions({
                members,
                overrides,
                permission: groupPermission,
            }),
        [members, overrides, groupPermission]
    )

    /**
     * Iznin KAYNAGI: "Direct override" mi, gruptan mi devralindi.
     * Renk TEK BASINA anlatmaz (§8) — gorunur METIN + erisilebilir ad.
     * Access ve Assign kaynaklari BAGIMSIZ gosterilir.
     */
    const SourceTag = ({ source, kind }) => {
        const explicit = source === 'explicit'
        const label = explicit ? 'Direct override' : 'Inherited from group'
        return (
            <Tag
                color={explicit ? 'gold' : 'default'}
                aria-label={`${kind}: ${label}`}
                style={{ marginInlineStart: 8, fontSize: 11 }}
            >
                {explicit ? 'Direct' : 'Inherited'}
            </Tag>
        )
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
            title: 'Member Title',
            dataIndex: 'title',
            render: (val) => val || <span style={{ color: 'var(--c-text-muted)' }}>—</span>,
        },
        {
            title: 'Access Tasks',
            dataIndex: 'effective_access_in_group',
            width: 190,
            render: (val, record) => (
                <>
                    <Switch
                        checked={!!val}
                        disabled={upsertMutation.isPending || !!bulk?.running}
                        onClick={(_, e) => e?.stopPropagation?.()}
                        onChange={(checked) =>
                            handleMemberToggle(record, 'access', checked)
                        }
                    />
                    <SourceTag source={record.access_source} kind="Access Tasks" />
                </>
            ),
        },
        {
            title: 'Assign Tasks',
            dataIndex: 'effective_assign_in_group',
            width: 190,
            render: (val, record) => {
                // Invariant — assign requires access. If access is OFF
                // for this member, the Assign toggle is forced off and
                // disabled. Backend enforces the same invariant.
                const accessOff = !record.effective_access_in_group
                return (
                    <>
                        <Switch
                            checked={!accessOff && !!val}
                            disabled={
                                accessOff || upsertMutation.isPending
                                || !!bulk?.running
                            }
                            onClick={(_, e) => e?.stopPropagation?.()}
                            onChange={(checked) =>
                                handleMemberToggle(record, 'assign', checked)
                            }
                        />
                        <SourceTag
                            source={record.assign_source}
                            kind="Assign Tasks"
                        />
                    </>
                )
            },
        },
        {
            title: 'Access Issues',
            dataIndex: 'effective_access_issues_in_group',
            width: 140,
            render: (val, record) => (
                <Switch
                    checked={!!val}
                    disabled={upsertMutation.isPending}
                    onClick={(_, e) => e?.stopPropagation?.()}
                    onChange={(checked) =>
                        handleMemberToggle(record, 'access_issues', checked)
                    }
                />
            ),
        },
        {
            title: 'Assign Issues',
            dataIndex: 'effective_assign_issues_in_group',
            width: 140,
            render: (val, record) => {
                // Invariant — assign requires access. If access is OFF
                // for this member, the Assign toggle is forced off and
                // disabled. Backend enforces the same invariant.
                const accessOff = !record.effective_access_issues_in_group
                return (
                    <Switch
                        checked={!accessOff && !!val}
                        disabled={accessOff || upsertMutation.isPending}
                        onClick={(_, e) => e?.stopPropagation?.()}
                        onChange={(checked) =>
                            handleMemberToggle(record, 'assign_issues', checked)
                        }
                    />
                )
            },
        },
    ]

    const failedCount = bulk?.outcome?.failed?.length ?? 0

    return (
        <div style={{ padding: '8px 0' }}>
            <div style={{ marginBottom: 8, color: 'var(--c-text-muted)', fontSize: 12 }}>
                Members are managed in Users → Groups.
            </div>

            {/* Toplu uygulama: hedef sayisi ONCEDEN bellidir, pending
                sirasinda ikinci islem baslatilamaz. */}
            <Space wrap style={{ marginBottom: 12 }}>
                <Button
                    size="small"
                    disabled={!!bulk?.running || rows.length === 0}
                    onClick={() =>
                        applyToMembers(
                            rows,
                            { can_access_tasks_override: true },
                            'Access Tasks ON'
                        )
                    }
                >
                    Grant Access to all {rows.length}
                </Button>
                <Button
                    size="small"
                    disabled={!!bulk?.running || rows.length === 0}
                    onClick={() =>
                        applyToMembers(
                            rows,
                            {
                                can_access_tasks_override: false,
                                can_assign_tasks_override: false,
                            },
                            'Access Tasks OFF'
                        )
                    }
                >
                    Revoke Access from all {rows.length}
                </Button>
            </Space>

            {bulk && (
                <div
                    role="status"
                    aria-live="polite"
                    style={{
                        marginBottom: 12,
                        padding: '8px 12px',
                        background: 'var(--c-surface-raised)',
                        border: '1px solid var(--c-border)',
                        borderRadius: 8,
                    }}
                >
                    <div style={{ fontSize: 12, color: 'var(--c-text)' }}>
                        {bulk.label} — {bulk.progress.completed}/{bulk.progress.total}
                        {' · '}
                        {bulk.progress.succeeded} succeeded
                        {' · '}
                        {bulk.progress.failed} failed
                        {bulk.running ? ' · working…' : ''}
                    </div>
                    <Progress
                        percent={Math.round(
                            (bulk.progress.completed / (bulk.progress.total || 1)) * 100
                        )}
                        size="small"
                        showInfo={false}
                        status={
                            bulk.running
                                ? 'active'
                                : failedCount > 0 ? 'exception' : 'success'
                        }
                    />
                    {!bulk.running && failedCount > 0 && (
                        <div style={{ marginTop: 8 }}>
                            {/* Kismi basari ASLA tam basari gibi gosterilmez:
                                basarisiz uyeler ADLARIYLA listelenir ve
                                yalnizca onlar yeniden denenir. */}
                            <div style={{ fontSize: 12, color: 'var(--c-text)' }}>
                                Failed for:{' '}
                                {bulk.outcome.failed
                                    .map((f) => {
                                        const u = allUsersById[f.user_id]
                                        const who =
                                            u?.full_name || u?.email || f.user_id
                                        // Sebep de gosterilir: "basarisiz"
                                        // demek tek basina eyleme
                                        // gecirilebilir bilgi degil.
                                        return `${who} (${errorText(f.error)})`
                                    })
                                    .join(', ')}
                            </div>
                            <Button
                                size="small"
                                style={{ marginTop: 6 }}
                                onClick={retryFailed}
                            >
                                Retry {failedCount} failed
                            </Button>
                        </div>
                    )}
                </div>
            )}

            <Table
                rowKey="id"
                size="small"
                columns={columns}
                dataSource={rows}
                loading={membersLoading || overridesLoading}
                pagination={false}
                locale={{ emptyText: 'No members in this group.' }}
                scroll={{ x: 'max-content' }}
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
    const [search, setSearch] = useState('')
    // all | access (has Access Tasks) | assign (has Assign Tasks)

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
            // Sunum katmani: sunucunun domain aciklamasi korunur,
            // teknik govde ve 5xx icerigi kullaniciya gosterilmez.
            message.error(normalizeApiError(err).message)
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
                    can_access_issues: !!perm?.can_access_issues,
                    can_assign_issues: !!perm?.can_assign_issues,
                }
            }),
        [users, permByUserId]
    )

    // Search so a 50-person org doesn't render as one long undifferentiated
    // list. Combined with pagination below.
    const filteredRows = useMemo(() => {
        const term = search.trim().toLowerCase()
        return rows.filter((r) => {
            if (!term) return true
            return (
                (r.full_name || '').toLowerCase().includes(term) ||
                (r.email || '').toLowerCase().includes(term)
            )
        })
    }, [rows, search])

    const grantedCount = useMemo(
        () => rows.filter((r) => r.can_access_tasks).length,
        [rows]
    )

    const handleToggle = (row, field, value) => {
        const next = {
            can_access_tasks:
                field === 'can_access_tasks' ? value : !!row.can_access_tasks,
            can_assign_tasks:
                field === 'can_assign_tasks' ? value : !!row.can_assign_tasks,
            can_access_issues:
                field === 'can_access_issues' ? value : !!row.can_access_issues,
            can_assign_issues:
                field === 'can_assign_issues' ? value : !!row.can_assign_issues,
        }
        if (field === 'can_access_tasks' && !value) next.can_assign_tasks = false
        if (field === 'can_assign_tasks' && value) next.can_access_tasks = true
        if (field === 'can_access_issues' && !value) next.can_assign_issues = false
        if (field === 'can_assign_issues' && value) next.can_access_issues = true
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
        {
            title: 'Access Issues',
            dataIndex: 'can_access_issues',
            width: 140,
            render: (val, row) => (
                <Switch
                    checked={!!val}
                    disabled={!row.is_active || updateMutation.isPending}
                    onChange={(checked) =>
                        handleToggle(row, 'can_access_issues', checked)
                    }
                />
            ),
        },
        {
            title: 'Assign Issues',
            dataIndex: 'can_assign_issues',
            width: 140,
            render: (val, row) => {
                const accessOff = !row.can_access_issues
                return (
                    <Switch
                        checked={!accessOff && !!val}
                        disabled={
                            !row.is_active ||
                            accessOff ||
                            updateMutation.isPending
                        }
                        onChange={(checked) =>
                            handleToggle(row, 'can_assign_issues', checked)
                        }
                    />
                )
            },
        },
    ]

    return (
        <div style={{ marginTop: 32 }}>
            <div style={{ marginBottom: 12 }}>
                <strong style={{ fontSize: 15, color: 'var(--c-text-strong)' }}>
                    Additional Users
                </strong>
                <div style={{ color: 'var(--c-text-muted)', fontSize: 12, marginTop: 2 }}>
                    People with task permissions outside any group.
                    {grantedCount > 0 && !search.trim() && (
                        <span style={{ marginLeft: 6 }}>
                            {grantedCount} currently granted.
                        </span>
                    )}
                </div>
            </div>

            <Space
                wrap
                style={{
                    marginBottom: 12,
                    width: '100%',
                    justifyContent: 'space-between',
                }}
            >
                <Input.Search
                    className="tm-additional-search"
                    allowClear
                    placeholder="Search by name or email"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{ width: 300 }}
                />
            </Space>

            <Table
                rowKey="user_id"
                size="small"
                columns={columns}
                dataSource={filteredRows}
                loading={permsLoading}
                scroll={{ x: 'max-content' }}
                pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
                locale={{
                    emptyText: search.trim()
                        ? 'No users match the current search.'
                        : 'Everyone with access is already in a group.',
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
            // Sunum katmani: sunucunun domain aciklamasi korunur,
            // teknik govde ve 5xx icerigi kullaniciya gosterilmez.
            message.error(normalizeApiError(err).message)
        },
    })

    const handleDefaultToggle = (group, kind, checked) => {
        const current = permByGroupId[group.id]
        const data = {
            can_access_tasks_default:
                kind === 'access' ? checked : !!current?.can_access_tasks_default,
            can_assign_tasks_default:
                kind === 'assign' ? checked : !!current?.can_assign_tasks_default,
            can_access_issues_default:
                kind === 'access_issues'
                    ? checked
                    : !!current?.can_access_issues_default,
            can_assign_issues_default:
                kind === 'assign_issues'
                    ? checked
                    : !!current?.can_assign_issues_default,
        }
        // Degismez — assign, access gerektirir. Backend'in zorladigi
        // kuralin AYNISI; kural artik tek yerde yasiyor ve testli
        // (features/admin/permissions/model.applyAssignRequiresAccess).
        upsertPermMutation.mutate({
            groupId: group.id,
            data: applyAssignRequiresAccess(data),
        })
    }

    const rows = useMemo(
        () =>
            groups.map((g) => {
                const perm = permByGroupId[g.id]
                return {
                    ...g,
                    can_access_tasks_default: !!perm?.can_access_tasks_default,
                    can_assign_tasks_default: !!perm?.can_assign_tasks_default,
                    can_access_issues_default:
                        !!perm?.can_access_issues_default,
                    can_assign_issues_default:
                        !!perm?.can_assign_issues_default,
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
            render: (val) => val || <span style={{ color: 'var(--c-text-muted)' }}>—</span>,
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
        {
            title: 'Access Issues',
            dataIndex: 'can_access_issues_default',
            width: 140,
            render: (val, row) => (
                <Switch
                    checked={!!val}
                    disabled={upsertPermMutation.isPending}
                    onClick={(_, e) => e?.stopPropagation?.()}
                    onChange={(checked) =>
                        handleDefaultToggle(row, 'access_issues', checked)
                    }
                />
            ),
        },
        {
            title: 'Assign Issues',
            dataIndex: 'can_assign_issues_default',
            width: 140,
            render: (val, row) => {
                const accessOff = !row.can_access_issues_default
                return (
                    <Switch
                        checked={!accessOff && !!val}
                        disabled={accessOff || upsertPermMutation.isPending}
                        onClick={(_, e) => e?.stopPropagation?.()}
                        onChange={(checked) =>
                            handleDefaultToggle(row, 'assign_issues', checked)
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
                scroll={{ x: 'max-content' }}
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
                            /* Grup default'u panele GECIRILIR: devralan
                               uyelerin efektif izni ancak bununla
                               hesaplanabilir (bkz. mergeMemberPermissions). */
                            groupPermission={permByGroupId[group.id]}
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
