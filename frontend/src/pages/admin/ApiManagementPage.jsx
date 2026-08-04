/**
 * =============================================================================
 * HERMES - Admin API Management Page (Stage 2E)
 * =============================================================================
 * Dis entegrasyon API client'lari + token yasam dongusu + request loglari +
 * dokumantasyon girisleri. PM Configurations'in gorsel dilini (tm-*
 * section/stat kaliplari) yeniden kullanir.
 *
 * Guvenlik davranislari:
 *  - Token plaintext'i YALNIZCA olusturma/rotate aninda TokenOnceModal'da
 *    gorunur; kapatilinca state + mutation cache temizlenir, localStorage/
 *    sessionStorage/query-cache'e ASLA yazilmaz. Kapatma, "kopyaladim"
 *    onay kutusu isaretlenmeden mumkun degildir.
 *  - Hash hicbir yerde render edilmez (backend zaten dondurmez).
 *  - Revoke/rotate/disable onaylari DangerConfirmModal ile (beyaz
 *    Popconfirm YOK).
 * =============================================================================
 */

import { useMemo, useState } from 'react'
import {
    Button, DatePicker, Input, Modal, Select, Space, Table, Tag, Tooltip, message
} from 'antd'
import {
    ApiOutlined, FileTextOutlined, KeyOutlined, PlusOutlined, ReloadOutlined, SafetyCertificateOutlined, StopOutlined, UnorderedListOutlined
} from '@ant-design/icons'
import {
    keepPreviousData, useMutation, useQuery, useQueryClient,
} from '@tanstack/react-query'
import dayjs from 'dayjs'

import {
    apiManagementService,
    authService,
    customerService,
    projectService,
    userGroupService,
} from '../../services/api'
import DangerConfirmModal from '../../components/common/DangerConfirmModal'
import './TaskManagementPage.css'
import './ApiManagementPage.css'

/*
 * Sorumluluk sinirlari (Sprint 6A/6C): bu dosya artik YALNIZCA
 * orkestrasyon yapar — sorgular, mutation'lar, onay akislari ve bolum
 * duzeni. Saf sozlukler, sunum kabuklari ve iki modal kendi
 * modullerinde yasar. Davranis DEGISMEDI.
 */
import {
    BINDING_LABEL, ENV_META, SCOPE_HELP, TYPE_LABEL, fmtDate, fmtDateTime,
} from '../../features/api-management/model/format'
import { Section, StatCard } from '../../features/api-management/components/Shell'
import TokenOnceModal from '../../features/api-management/components/TokenOnceModal'
import ClientModal from '../../features/api-management/modals/ClientModal'
import { normalizeApiError } from '../../features/admin/shared/normalizeApiError'


// =============================================================================
// Page
// =============================================================================

function ApiManagementPage() {
    const queryClient = useQueryClient()
    const [open, setOpen] = useState({
        clients: true,
        tokens: false,
        logs: false,
        docs: false,
    })
    const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }))

    // ── Data ────────────────────────────────────────────────────────────
    const { data: clients = [], isLoading: clientsLoading } = useQuery({
        queryKey: ['admin-api-clients'],
        queryFn: () => apiManagementService.listClients(),
    })
    const { data: capabilities } = useQuery({
        queryKey: ['public-capabilities'],
        queryFn: () => apiManagementService.getPublicCapabilities(),
        staleTime: 10 * 60 * 1000,
    })
    const scopeCatalog = useMemo(
        () => Object.keys(capabilities?.scopes || SCOPE_HELP),
        [capabilities]
    )

    // Binding hedef secicileri
    const { data: users = [] } = useQuery({
        queryKey: ['auth-users-lookup', { include_inactive: false }],
        queryFn: () => authService.lookupUsers(),
        staleTime: 60 * 1000,
    })
    const { data: groups = [] } = useQuery({
        queryKey: ['admin-user-groups'],
        queryFn: () => userGroupService.list(),
    })
    const { data: customers = [] } = useQuery({
        queryKey: ['customers'],
        queryFn: () => customerService.getAll(),
    })
    const { data: projects = [] } = useQuery({
        queryKey: ['projects'],
        queryFn: () => projectService.getAll(),
    })
    const pickers = useMemo(
        () => ({
            user: users.map((u) => ({
                value: u.id,
                label: u.full_name || u.email,
            })),
            group: groups.map((g) => ({ value: g.id, label: g.name })),
            customer: customers.map((c) => ({ value: c.id, label: c.name })),
            project: projects.map((p) => ({ value: p.id, label: p.name })),
        }),
        [users, groups, customers, projects]
    )
    const nameOf = useMemo(() => {
        const map = {}
        for (const [type, opts] of Object.entries(pickers)) {
            for (const o of opts) map[`${type}:${o.value}`] = o.label
        }
        return map
    }, [pickers])

    // ── Mutations ───────────────────────────────────────────────────────
    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ['admin-api-clients'] })
        queryClient.invalidateQueries({ queryKey: ['admin-api-tokens'] })
    }
    /*
     * Hata sunumu ortak modele bagli: sunucunun domain aciklamasi
     * (orn. "scope not allowed for service clients") KORUNUR, teknik
     * govde ve 5xx icerigi kullaniciya gosterilmez.
     */
    const onErr = (err) => message.error(normalizeApiError(err).message)

    const [clientModal, setClientModal] = useState(null) // {editing|null}
    const saveClient = useMutation({
        // Edit iki istektir (update + bindings replace). Ilk adim basarili
        // ama ikincisi basarisizsa bu KISMI guncellemedir — asla tam basari
        // gibi raporlanmaz: acik uyari verilir ve sunucu durumu refetch
        // edilir (eski binding'ler transactional replace sayesinde aynen
        // yururluktedir).
        mutationFn: async ({ editing, data }) => {
            if (!editing) return apiManagementService.createClient(data)
            await apiManagementService.updateClient(editing.id, {
                name: data.name,
                description: data.description,
                scopes: data.scopes,
                rate_limit_per_min: data.rate_limit_per_min,
            })
            try {
                await apiManagementService.replaceBindings(
                    editing.id,
                    data.access
                )
            } catch (err) {
                const detail =
                    normalizeApiError(err).message ||
                    'Access bindings could not be updated.'
                const partial = new Error(detail)
                partial.isPartial = true
                throw partial
            }
        },
        onSuccess: () => {
            message.success('API client saved.')
            setClientModal(null)
            invalidate()
        },
        onError: (err) => {
            if (err?.isPartial) {
                message.warning(
                    `Client settings were saved, but access bindings were NOT updated: ${err.message} ` +
                        'The previous bindings are still in effect.',
                    8
                )
                setClientModal(null)
                invalidate() // sunucu gercegini yeniden cek
                return
            }
            onErr(err)
        },
    })

    const toggleClientStatus = useMutation({
        mutationFn: ({ client }) =>
            client.status === 'active'
                ? apiManagementService.disableClient(client.id)
                : apiManagementService.updateClient(client.id, {
                      status: 'active',
                  }),
        onSuccess: (_, { client }) => {
            message.success(
                client.status === 'active'
                    ? 'Client disabled — all its tokens stopped working.'
                    : 'Client re-enabled.'
            )
            invalidate()
        },
        onError: onErr,
    })

    // Token-once: plaintext YALNIZCA bu state'te yasar.
    const [issuedToken, setIssuedToken] = useState(null)

    const createToken = useMutation({
        mutationFn: ({ clientId }) =>
            apiManagementService.createToken(clientId),
        onSuccess: (res) => {
            setIssuedToken({ token: res.token })
            invalidate()
        },
        onError: onErr,
    })
    const rotateToken = useMutation({
        mutationFn: ({ tokenId }) =>
            apiManagementService.rotateToken(tokenId),
        onSuccess: (res) => {
            setIssuedToken({ token: res.token })
            invalidate()
        },
        onError: onErr,
    })
    // Modal kapaninca plaintext HER YERDEN silinir: local state + react-query
    // mutation cache (mutation.data icinde kalmasin diye reset).
    const closeIssued = () => {
        setIssuedToken(null)
        createToken.reset()
        rotateToken.reset()
    }

    const revokeToken = useMutation({
        mutationFn: ({ tokenId }) =>
            apiManagementService.revokeToken(tokenId),
        onSuccess: () => {
            message.success('Token revoked.')
            invalidate()
        },
        onError: onErr,
    })
    const updateExpiry = useMutation({
        mutationFn: ({ tokenId, expiresAt }) =>
            apiManagementService.updateTokenExpiry(tokenId, expiresAt),
        onSuccess: () => {
            message.success('Token expiry updated.')
            setExpiryModal(null)
            invalidate()
        },
        onError: onErr,
    })

    /*
     * Yikici/geri alinamaz aksiyonlarin ORTAK mesguliyeti: tek bir
     * bayrak, onay modalinin hem `loading` gorunumunu hem kaynak
     * seviyesindeki kilidini besler.
     */
    const destructiveBusy =
        revokeToken.isPending || rotateToken.isPending
        || toggleClientStatus.isPending

    // Onay modallari
    const [confirm, setConfirm] = useState(null) // {kind, client?, token?}
    const [expiryModal, setExpiryModal] = useState(null) // {token}
    const [expiryValue, setExpiryValue] = useState(null)

    const clientById = useMemo(() => {
        const m = {}
        for (const c of clients) m[c.id] = c
        return m
    }, [clients])

    const allTokens = useMemo(
        () =>
            clients.flatMap((c) =>
                (c.tokens || []).map((t) => ({ ...t, client: c }))
            ),
        [clients]
    )
    const activeTokens = allTokens.filter((t) => t.status === 'active')

    // ── Token tablosu kolonlari ─────────────────────────────────────────
    const tokenColumns = [
        {
            title: 'Client',
            dataIndex: ['client', 'name'],
            render: (_, t) => (
                <Space size={6}>
                    {t.client.name}
                    <Tag
                        color={ENV_META[t.client.environment]?.color}
                        style={{ marginInlineEnd: 0 }}
                    >
                        {ENV_META[t.client.environment]?.label}
                    </Tag>
                    {t.client.status !== 'active' && (
                        <Tag color="red">client disabled</Tag>
                    )}
                </Space>
            ),
        },
        {
            title: 'Token',
            dataIndex: 'token_prefix',
            render: (v, t) => (
                <Space size={6}>
                    <code className="am-prefix">{v}…</code>
                    {t.rotated_from_token_id && (
                        <Tooltip title="Created by rotating an earlier token">
                            <Tag>rotated</Tag>
                        </Tooltip>
                    )}
                </Space>
            ),
        },
        {
            title: 'Status',
            dataIndex: 'status',
            width: 100,
            render: (v, t) =>
                v === 'active' && t.client.status === 'active' ? (
                    <Tag color="green">active</Tag>
                ) : v === 'active' ? (
                    <Tag color="orange">unusable</Tag>
                ) : (
                    <Tag color="red">revoked</Tag>
                ),
        },
        {
            title: 'Created',
            dataIndex: 'created_at',
            render: fmtDate,
        },
        {
            title: 'Expires',
            dataIndex: 'expires_at',
            render: (v) => (v ? fmtDate(v) : 'Never'),
        },
        {
            title: 'Last used',
            dataIndex: 'last_used_at',
            render: (v, t) =>
                v ? (
                    <Tooltip title={t.last_used_ip || ''}>
                        {fmtDateTime(v)}
                    </Tooltip>
                ) : (
                    '—'
                ),
        },
        {
            title: 'Actions',
            width: 230,
            render: (_, t) => (
                <Space wrap>
                    <Button
                        size="small"
                        disabled={t.status !== 'active'}
                        onClick={() => {
                            setExpiryValue(
                                t.expires_at ? dayjs(t.expires_at) : null
                            )
                            setExpiryModal({ token: t })
                        }}
                    >
                        Expiry
                    </Button>
                    <Button
                        size="small"
                        icon={<ReloadOutlined />}
                        disabled={t.status !== 'active'}
                        onClick={() => setConfirm({ kind: 'rotate', token: t })}
                    >
                        Rotate
                    </Button>
                    <Button
                        size="small"
                        danger
                        icon={<StopOutlined />}
                        disabled={t.status !== 'active'}
                        onClick={() => setConfirm({ kind: 'revoke', token: t })}
                    >
                        Revoke
                    </Button>
                </Space>
            ),
        },
    ]

    // ── Request logs ────────────────────────────────────────────────────
    const [logFilters, setLogFilters] = useState({})
    const [logOffset, setLogOffset] = useState(0)
    const LOG_PAGE = 25
    const { data: logs = [], isFetching: logsLoading } = useQuery({
        queryKey: ['admin-api-request-logs', logFilters, logOffset],
        queryFn: () =>
            apiManagementService.listRequestLogs({
                limit: LOG_PAGE,
                offset: logOffset,
                ...logFilters,
            }),
        enabled: open.logs,
        /*
         * TanStack Query v5'te `keepPreviousData` KALDIRILDI ve sessizce
         * yok sayiliyordu: her sayfa/filtre degisiminde audit tablosu
         * bosalip yeniden doluyordu. v5 karsiligi `placeholderData`.
         */
        placeholderData: keepPreviousData,
    })

    // ── Retention / cleanup (Stage 3F) ──────────────────────────────────
    // Yalnizca api_request_logs + api_idempotency_keys yasam dongusu;
    // is verisine backend yapisal olarak dokunamaz.
    const [cleanupConfirm, setCleanupConfirm] = useState(false)
    const { data: cleanup } = useQuery({
        queryKey: ['admin-api-cleanup'],
        queryFn: () => apiManagementService.getCleanupStatus(),
        enabled: open.logs,
    })
    const runCleanup = useMutation({
        mutationFn: (dryRun) => apiManagementService.runCleanup(dryRun),
        onSuccess: (res) => {
            queryClient.invalidateQueries({ queryKey: ['admin-api-cleanup'] })
            queryClient.invalidateQueries({
                queryKey: ['admin-api-request-logs'],
            })
            if (res.status === 'disabled') {
                message.warning('Cleanup is disabled by configuration.')
            } else if (res.status === 'skipped_already_running') {
                message.warning('A cleanup run is already in progress.')
            } else if (res.dry_run) {
                message.info(
                    `Dry run: ${res.request_logs_deleted} request logs and ` +
                        `${res.idempotency_keys_deleted} idempotency keys ` +
                        'would be removed.'
                )
            } else {
                message.success(
                    `Cleanup done: ${res.request_logs_deleted} request logs ` +
                        `and ${res.idempotency_keys_deleted} idempotency ` +
                        'keys removed.'
                )
            }
        },
        onError: (err) => {
            // Gercek calisma hatasi 500 + sanitize govdeyle gelir
            // (yalnizca failure_class — SQL/stack yok).
            const fc = err?.response?.data?.failure_class
            message.error(
                fc ? `Cleanup failed (${fc}).` : 'Cleanup request failed.'
            )
            queryClient.invalidateQueries({ queryKey: ['admin-api-cleanup'] })
        },
    })

    const logColumns = [
        {
            title: 'Time',
            dataIndex: 'created_at',
            render: fmtDateTime,
            width: 150,
        },
        {
            title: 'Client',
            dataIndex: 'client_id',
            render: (v) => (v ? clientById[v]?.name || v.slice(0, 8) : '—'),
        },
        {
            title: 'Request ID',
            dataIndex: 'request_id',
            render: (v) => <code className="am-prefix">{v}</code>,
        },
        { title: 'Method', dataIndex: 'method', width: 80 },
        { title: 'Path', dataIndex: 'path' },
        {
            title: 'Status',
            dataIndex: 'status_code',
            width: 90,
            render: (v, r) => (
                <Space size={4}>
                    <Tag
                        color={
                            v < 400 ? 'green' : v === 429 ? 'orange' : 'red'
                        }
                    >
                        {v}
                    </Tag>
                    {r.rate_limited && (
                        <Tooltip title="Rate limited">
                            <Tag color="orange">RL</Tag>
                        </Tooltip>
                    )}
                </Space>
            ),
        },
        {
            title: 'Duration',
            dataIndex: 'duration_ms',
            width: 100,
            render: (v) => `${v} ms`,
        },
        { title: 'Source IP', dataIndex: 'source_ip', render: (v) => v || '—' },
    ]

    // ── Render ──────────────────────────────────────────────────────────
    return (
        <div className="tm-page">
            <header className="tm-header">
                <h1 className="tm-title">API Management</h1>
                <p className="tm-subtitle">
                    External API clients, access tokens, request logs and
                    developer documentation for the Hermes Public API.
                </p>
            </header>

            <div className="tm-stats">
                <StatCard
                    icon={<ApiOutlined />}
                    label="API Clients"
                    value={clients.length}
                    accent="#388bff"
                />
                <StatCard
                    icon={<KeyOutlined />}
                    label="Active tokens"
                    value={activeTokens.length}
                    accent="#22a06b"
                />
                <StatCard
                    icon={<SafetyCertificateOutlined />}
                    label="Live clients"
                    value={clients.filter((c) => c.environment === 'live').length}
                    accent="#7c5cff"
                />
                <StatCard
                    icon={<StopOutlined />}
                    label="Disabled clients"
                    value={clients.filter((c) => c.status !== 'active').length}
                    accent="#f97316"
                />
            </div>

            {/* ── API Clients ── */}
            <Section
                icon={<ApiOutlined />}
                title="API Clients"
                subtitle="Who can call the Public API, with which scopes and data access"
                count={clients.length}
                accent="#388bff"
                open={open.clients}
                onToggle={() => toggle('clients')}
            >
                <div className="am-clients-toolbar">
                    {/* Section toolbar'ina bagli kompakt create aksiyonu. */}
                    <Button
                        className="h-create-action"
                        icon={<PlusOutlined />}
                        onClick={() => setClientModal({ editing: null })}
                    >
                        Create API Client
                    </Button>
                </div>
                {clientsLoading && <div>Loading…</div>}
                {!clientsLoading && clients.length === 0 && (
                    <div className="am-empty">
                        No API clients yet. Create one to issue tokens for
                        external integrations.
                    </div>
                )}
                {clients.map((c) => (
                    <div
                        key={c.id}
                        className={`am-client${
                            c.status !== 'active' ? ' is-disabled' : ''
                        }`}
                    >
                        <div className="am-client-head">
                            <span className="am-client-name">{c.name}</span>
                            <Tag color={ENV_META[c.environment]?.color}>
                                {ENV_META[c.environment]?.label}
                            </Tag>
                            <Tag>{TYPE_LABEL[c.client_type]}</Tag>
                            {c.client_type === 'user' && (
                                <Tag color="blue">
                                    {nameOf[`user:${c.bound_user_id}`] ||
                                        'bound user'}
                                </Tag>
                            )}
                            <Tag
                                color={
                                    c.status === 'active' ? 'green' : 'red'
                                }
                            >
                                {c.status}
                            </Tag>
                            <span className="am-client-spacer" />
                            <Space wrap>
                                {/* Uc esit agirlikta dolu buton yerine:
                                    Edit ghost, New Token create-action,
                                    Disable kontrollu danger (hover'da). */}
                                <Button
                                    size="small"
                                    className="h-inline-action"
                                    onClick={() =>
                                        setClientModal({ editing: c })
                                    }
                                >
                                    Edit
                                </Button>
                                <Button
                                    size="small"
                                    className="h-create-action"
                                    icon={<KeyOutlined />}
                                    disabled={c.status !== 'active'}
                                    onClick={() =>
                                        createToken.mutate({ clientId: c.id })
                                    }
                                >
                                    New Token
                                </Button>
                                <Button
                                    size="small"
                                    className="h-inline-action h-inline-action--danger"
                                    danger={false}
                                    onClick={() =>
                                        setConfirm({
                                            kind:
                                                c.status === 'active'
                                                    ? 'disable'
                                                    : 'enable',
                                            client: c,
                                        })
                                    }
                                >
                                    {c.status === 'active'
                                        ? 'Disable'
                                        : 'Enable'}
                                </Button>
                            </Space>
                        </div>
                        {c.description && (
                            <div className="am-client-desc">
                                {c.description}
                            </div>
                        )}
                        <div className="am-client-meta">
                            <div className="am-meta-block">
                                <span className="am-meta-label">Scopes</span>
                                <span>
                                    {(c.scopes || []).length ? (
                                        c.scopes.map((s) => (
                                            <Tag key={s}>{s}</Tag>
                                        ))
                                    ) : (
                                        <Tag color="red">none</Tag>
                                    )}
                                </span>
                            </div>
                            <div className="am-meta-block">
                                <span className="am-meta-label">
                                    Data access
                                </span>
                                <span>
                                    {(c.access || []).length ? (
                                        c.access.map((b) => (
                                            <Tag
                                                key={b.id}
                                                color={
                                                    b.access_type === 'global'
                                                        ? 'purple'
                                                        : undefined
                                                }
                                            >
                                                {b.access_type === 'global'
                                                    ? 'Global'
                                                    : `${BINDING_LABEL[b.access_type]}: ${
                                                          nameOf[
                                                              `${b.access_type}:${b.target_id}`
                                                          ] ||
                                                          String(
                                                              b.target_id
                                                          ).slice(0, 8)
                                                      }`}
                                            </Tag>
                                        ))
                                    ) : (
                                        <Tag color="red">
                                            none — no business data
                                        </Tag>
                                    )}
                                </span>
                            </div>
                            <div className="am-meta-block">
                                <span className="am-meta-label">
                                    Rate limit
                                </span>
                                {c.rate_limit_per_min || 60}/min
                            </div>
                            <div className="am-meta-block">
                                <span className="am-meta-label">Tokens</span>
                                {(c.tokens || []).filter(
                                    (t) => t.status === 'active'
                                ).length}{' '}
                                active / {(c.tokens || []).length}
                            </div>
                            <div className="am-meta-block">
                                <span className="am-meta-label">Created</span>
                                {fmtDate(c.created_at)}
                            </div>
                        </div>
                    </div>
                ))}
            </Section>

            {/* ── Access Tokens ── */}
            <Section
                icon={<KeyOutlined />}
                title="Access Tokens"
                subtitle="Every credential across all clients — prefix only, never the token itself"
                count={allTokens.length}
                accent="#22a06b"
                open={open.tokens}
                onToggle={() => toggle('tokens')}
            >
                <Table
                    rowKey="id"
                    size="small"
                    columns={tokenColumns}
                    dataSource={allTokens}
                    scroll={{ x: 'max-content' }}
                    pagination={{ pageSize: 10, hideOnSinglePage: true }}
                />
            </Section>

            {/* ── Request Logs ── */}
            <Section
                icon={<UnorderedListOutlined />}
                title="Request Logs"
                subtitle="Audit trail of Public API calls (no bodies, no secrets)"
                accent="#7c5cff"
                open={open.logs}
                onToggle={() => toggle('logs')}
            >
                {cleanup && (
                    <div className="am-cleanup-bar">
                        <div className="am-cleanup-info">
                            <span>
                                Retention: request logs{' '}
                                <b>
                                    {
                                        cleanup.policy
                                            .request_log_retention_days
                                    }{' '}
                                    days
                                </b>{' '}
                                · idempotency keys{' '}
                                <b>
                                    {
                                        cleanup.policy
                                            .idempotency_retention_hours
                                    }
                                    h
                                </b>{' '}
                                (24h TTL + safety margin)
                                {!cleanup.policy.enabled && (
                                    <Tag
                                        color="red"
                                        style={{ marginLeft: 8 }}
                                    >
                                        cleanup disabled
                                    </Tag>
                                )}
                            </span>
                            <span className="am-cleanup-last">
                                {cleanup.last_run
                                    ? `Last cleanup ${fmtDateTime(
                                          cleanup.last_run.started_at
                                      )} — ${cleanup.last_run.status}` +
                                      (cleanup.last_run.dry_run
                                          ? ' (dry run)'
                                          : '') +
                                      ` · ${cleanup.last_run.request_logs_deleted} logs / ` +
                                      `${cleanup.last_run.idempotency_keys_deleted} keys removed`
                                    : 'No cleanup has run yet'}
                                {' · '}
                                {cleanup.next_scheduled_run
                                    ? `Next run ${fmtDateTime(
                                          cleanup.next_scheduled_run
                                      )}`
                                    : 'Daily 03:00 UTC via K8s CronJob (manual apply)'}
                            </span>
                        </div>
                        <Space>
                            <Button
                                size="small"
                                loading={runCleanup.isPending}
                                onClick={() => runCleanup.mutate(true)}
                            >
                                Dry run
                            </Button>
                            <Button
                                size="small"
                                danger
                                loading={runCleanup.isPending}
                                onClick={() => setCleanupConfirm(true)}
                            >
                                Run Cleanup
                            </Button>
                        </Space>
                    </div>
                )}
                <Space wrap className="am-log-filters">
                    <Select
                        allowClear
                        placeholder="Client"
                        style={{ minWidth: 180 }}
                        options={clients.map((c) => ({
                            value: c.id,
                            label: c.name,
                        }))}
                        onChange={(v) => {
                            setLogOffset(0)
                            setLogFilters((f) => ({
                                ...f,
                                client_id: v || undefined,
                            }))
                        }}
                    />
                    <Select
                        allowClear
                        placeholder="Status"
                        style={{ minWidth: 120 }}
                        options={[200, 201, 401, 403, 404, 422, 429, 500].map(
                            (s) => ({ value: s, label: s })
                        )}
                        onChange={(v) => {
                            setLogOffset(0)
                            setLogFilters((f) => ({
                                ...f,
                                status_code: v || undefined,
                            }))
                        }}
                    />
                    <DatePicker.RangePicker
                        onChange={(range) => {
                            setLogOffset(0)
                            setLogFilters((f) => ({
                                ...f,
                                created_from: range?.[0]
                                    ? range[0].startOf('day').toISOString()
                                    : undefined,
                                created_to: range?.[1]
                                    ? range[1].endOf('day').toISOString()
                                    : undefined,
                            }))
                        }}
                    />
                    <Input.Search
                        placeholder="Request ID"
                        allowClear
                        style={{ width: 260 }}
                        onSearch={(v) => {
                            setLogOffset(0)
                            setLogFilters((f) => ({
                                ...f,
                                request_id: v || undefined,
                            }))
                        }}
                    />
                </Space>
                <Table
                    rowKey="id"
                    size="small"
                    columns={logColumns}
                    dataSource={logs}
                    loading={logsLoading}
                    scroll={{ x: 'max-content' }}
                    pagination={false}
                />
                <div className="am-log-pager">
                    <Button
                        size="small"
                        disabled={logOffset === 0}
                        onClick={() =>
                            setLogOffset((o) => Math.max(0, o - LOG_PAGE))
                        }
                    >
                        Newer
                    </Button>
                    <Button
                        size="small"
                        disabled={logs.length < LOG_PAGE}
                        onClick={() => setLogOffset((o) => o + LOG_PAGE)}
                    >
                        Older
                    </Button>
                </div>
            </Section>

            {/* ── Documentation ── */}
            <Section
                icon={<FileTextOutlined />}
                title="Documentation"
                subtitle="Developer resources for the Public API"
                accent="#f97316"
                open={open.docs}
                onToggle={() => toggle('docs')}
            >
                <div className="am-docs-grid">
                    <a
                        className="am-doc-card"
                        href="/api/public/v1/docs"
                        target="_blank"
                        rel="noreferrer"
                    >
                        <span className="am-doc-title">
                            Interactive API Reference
                        </span>
                        <span className="am-doc-sub">
                            Swagger UI for every public endpoint
                        </span>
                    </a>
                    <a
                        className="am-doc-card"
                        href="/api/public/v1/openapi.json"
                        target="_blank"
                        rel="noreferrer"
                    >
                        <span className="am-doc-title">OpenAPI Schema</span>
                        <span className="am-doc-sub">
                            Machine-readable spec (client generation)
                        </span>
                    </a>
                    <div className="am-doc-card is-static">
                        <span className="am-doc-title">Authentication</span>
                        <span className="am-doc-sub">
                            Send{' '}
                            <code>Authorization: Bearer hms_…</code> on every
                            request. Tokens are created here and shown once.
                            Full guide arrives with the Developer Portal.
                        </span>
                    </div>
                    <div className="am-doc-card is-static">
                        <span className="am-doc-title">Scopes</span>
                        <span className="am-doc-sub">
                            {scopeCatalog.map((s) => (
                                <Tag key={s} style={{ marginBottom: 4 }}>
                                    {s}
                                </Tag>
                            ))}
                        </span>
                    </div>
                    <div className="am-doc-card is-static">
                        <span className="am-doc-title">
                            MCP Server <Tag color="green">Active</Tag>
                        </span>
                        <span className="am-doc-sub">
                            AI tools connect with these same tokens, scopes
                            and data-access bindings — nothing separate to
                            issue. Every tool call lands in the Request Logs
                            below, and revoking a token cuts the tool off at
                            its next call. Issue a user-bound client for
                            write access; service clients stay read-only.
                        </span>
                    </div>
                </div>
            </Section>

            {/* ── Modals ── */}
            {clientModal && (
                <ClientModal
                    open
                    editing={clientModal.editing}
                    scopes={scopeCatalog}
                    pickers={pickers}
                    saving={saveClient.isPending}
                    onClose={() => setClientModal(null)}
                    onSubmit={(data) =>
                        saveClient.mutate({
                            editing: clientModal.editing,
                            data,
                        })
                    }
                />
            )}

            <TokenOnceModal issued={issuedToken} onDone={closeIssued} />

            <DangerConfirmModal
                open={cleanupConfirm}
                tone="danger"
                title="Run retention cleanup now?"
                subtitle={
                    'Permanently removes API request logs older than the ' +
                    'retention period and expired idempotency keys. ' +
                    'Business data (tasks, work logs, meetings, customers, ' +
                    'projects) is never touched.'
                }
                confirmLabel="Run Cleanup"
                loading={runCleanup.isPending}
                onConfirm={() => {
                    setCleanupConfirm(false)
                    runCleanup.mutate(false)
                }}
                onCancel={() => setCleanupConfirm(false)}
            />

            <DangerConfirmModal
                open={!!confirm}
                tone={confirm?.kind === 'enable' ? 'primary' : 'danger'}
                title={
                    confirm?.kind === 'revoke'
                        ? 'Revoke this token?'
                        : confirm?.kind === 'rotate'
                        ? 'Rotate this token?'
                        : confirm?.kind === 'disable'
                        ? 'Disable this API client?'
                        : 'Re-enable this API client?'
                }
                subtitle={
                    confirm?.kind === 'revoke'
                        ? 'The token stops working immediately. This cannot be undone.'
                        : confirm?.kind === 'rotate'
                        ? 'A new token will be issued and shown once; the old token stops working immediately.'
                        : confirm?.kind === 'disable'
                        ? 'All tokens of this client stop working immediately. The client can be re-enabled later.'
                        : 'Existing active tokens will start working again.'
                }
                itemSubtitle={
                    confirm?.token
                        ? `${confirm.token.client.name} · ${confirm.token.token_prefix}…`
                        : confirm?.client?.name
                }
                confirmLabel={
                    confirm?.kind === 'revoke'
                        ? 'Revoke Token'
                        : confirm?.kind === 'rotate'
                        ? 'Rotate Token'
                        : confirm?.kind === 'disable'
                        ? 'Disable Client'
                        : 'Enable Client'
                }
                onCancel={() => setConfirm(null)}
                onConfirm={() => {
                    // Cift tetikleme kilidi KAYNAKTA: revoke/rotate/enable
                    // geri alinamaz ya da yeni sir uretir; butonun
                    // `loading` olmasi bir render GEC gelir.
                    if (destructiveBusy) return
                    const c = confirm
                    setConfirm(null)
                    if (c.kind === 'revoke')
                        revokeToken.mutate({ tokenId: c.token.id })
                    else if (c.kind === 'rotate')
                        rotateToken.mutate({ tokenId: c.token.id })
                    else toggleClientStatus.mutate({ client: c.client })
                }}
                loading={destructiveBusy}
            />

            <Modal
                open={!!expiryModal}
                title="Update token expiry"
                okText="Save"
                onOk={() => {
                    // Cift gonderim kilidi KAYNAKTA.
                    if (updateExpiry.isPending) return
                    updateExpiry.mutate({
                        tokenId: expiryModal.token.id,
                        expiresAt: expiryValue
                            ? expiryValue.endOf('day').toISOString()
                            : null,
                    })
                }}
                confirmLoading={updateExpiry.isPending}
                onCancel={() => setExpiryModal(null)}
                destroyOnHidden
            >
                <p style={{ color: 'var(--c-text-muted)', marginBottom: 12 }}>
                    Leave empty for a token that never expires.
                </p>
                <DatePicker
                    style={{ width: '100%' }}
                    value={expiryValue}
                    onChange={setExpiryValue}
                    disabledDate={(d) => d && d < dayjs().startOf('day')}
                />
            </Modal>
        </div>
    )
}

export default ApiManagementPage
