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
    Alert,
    Button,
    Checkbox,
    DatePicker,
    Form,
    Input,
    InputNumber,
    Modal,
    Select,
    Space,
    Table,
    Tag,
    Tooltip,
    message,
} from 'antd'
import {
    ApiOutlined,
    CopyOutlined,
    DownOutlined,
    EyeInvisibleOutlined,
    EyeOutlined,
    FileTextOutlined,
    KeyOutlined,
    PlusOutlined,
    ReloadOutlined,
    SafetyCertificateOutlined,
    StopOutlined,
    UnorderedListOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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

const ENV_META = {
    dev: { label: 'Development', color: '#f59e0b' },
    live: { label: 'Live', color: '#22a06b' },
}
const TYPE_LABEL = { service: 'Service', user: 'User-bound' }
const BINDING_LABEL = {
    global: 'Global (everything)',
    user: 'User',
    group: 'Group',
    customer: 'Customer',
    project: 'Project',
}

function fmtDate(v) {
    return v ? dayjs(v).format('DD MMM YYYY') : '—'
}
function fmtDateTime(v) {
    return v ? dayjs(v).format('DD MMM YYYY HH:mm') : '—'
}

// =============================================================================
// Section shell (PM Configurations ile ayni kalip)
// =============================================================================

function Section({ icon, title, subtitle, count, accent, open, onToggle, children }) {
    return (
        <section
            className={`tm-section${open ? ' is-open' : ''}`}
            style={{ '--tm-accent': accent }}
        >
            <button
                type="button"
                className="tm-section-head"
                onClick={onToggle}
                aria-expanded={open}
            >
                <span className="tm-section-icon">{icon}</span>
                <span className="tm-section-titles">
                    <span className="tm-section-title">{title}</span>
                    {subtitle && (
                        <span className="tm-section-sub">{subtitle}</span>
                    )}
                </span>
                {typeof count === 'number' && (
                    <span className="tm-section-count">{count}</span>
                )}
                <DownOutlined className="tm-section-chevron" />
            </button>
            <div className="tm-section-body-wrap">
                <div className="tm-section-body">
                    <div className="tm-section-inner">{children}</div>
                </div>
            </div>
        </section>
    )
}

function StatCard({ icon, label, value, accent }) {
    return (
        <div className="tm-stat" style={{ '--tm-accent': accent }}>
            <span className="tm-stat-icon">{icon}</span>
            <div className="tm-stat-body">
                <div className="tm-stat-value">{value}</div>
                <div className="tm-stat-label">{label}</div>
            </div>
        </div>
    )
}

// =============================================================================
// Token-once modal — plaintext'in gorundugu TEK yer
// =============================================================================

function TokenOnceModal({ issued, onDone }) {
    const [copied, setCopied] = useState(false)
    const [confirmed, setConfirmed] = useState(false)
    const [masked, setMasked] = useState(false)

    if (!issued) return null
    const token = issued.token

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(token)
            setCopied(true)
            message.success('Token copied to clipboard.')
        } catch {
            message.error('Copy failed — select and copy manually.')
        }
    }

    return (
        <Modal
            open
            title="API token created"
            closable={false}
            maskClosable={false}
            keyboard={false}
            footer={
                <Button
                    type="primary"
                    disabled={!confirmed}
                    onClick={onDone}
                >
                    Done — token stored securely
                </Button>
            }
            width={640}
            destroyOnClose
        >
            <Alert
                type="warning"
                showIcon
                message="This token will not be shown again. Store it securely now."
                style={{ marginBottom: 16 }}
            />
            <div className="am-token-box">
                <code className="am-token-value">
                    {masked
                        ? `${token.slice(0, 12)}${'•'.repeat(24)}`
                        : token}
                </code>
                <Space>
                    <Tooltip title={masked ? 'Show' : 'Hide'}>
                        <Button
                            size="small"
                            icon={
                                masked ? (
                                    <EyeOutlined />
                                ) : (
                                    <EyeInvisibleOutlined />
                                )
                            }
                            onClick={() => setMasked((m) => !m)}
                        />
                    </Tooltip>
                    <Button
                        size="small"
                        type="primary"
                        icon={<CopyOutlined />}
                        onClick={copy}
                    >
                        Copy
                    </Button>
                </Space>
            </div>
            <Checkbox
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                style={{ marginTop: 16 }}
            >
                I have copied and securely stored this token.
            </Checkbox>
            {!copied && confirmed && (
                <div className="am-token-hint">
                    Tip: use the Copy button to avoid typos.
                </div>
            )}
        </Modal>
    )
}

// =============================================================================
// Client create/edit modal (guided) + bindings editor
// =============================================================================

const SCOPE_HELP = {
    'tasks:read': 'Read work items',
    'tasks:write': 'Create & update work items',
    'tasks:comment': 'Comment on work items',
    'tasks:complete': 'Change work item status',
    'customers:read': 'Read customers',
    'projects:read': 'Read projects',
    'work-logs:read': 'Read work logs',
    'work-logs:write': 'Create work logs',
    'meetings:read': 'Read meetings',
    'users:read': 'Read user directory',
    'groups:read': 'Read groups',
}

function ClientModal({ open, editing, scopes, pickers, onClose, onSubmit, saving }) {
    const [form] = Form.useForm()
    const clientType = Form.useWatch('client_type', form) || 'service'
    const bindings = Form.useWatch('access', form) || []
    const hasGlobal = bindings.some((b) => b?.access_type === 'global')

    const scopeOptions = useMemo(
        () =>
            scopes.map((s) => ({
                value: s,
                label: `${s} — ${SCOPE_HELP[s] || ''}`,
            })),
        [scopes]
    )

    const bindingTypeOptions = useMemo(() => {
        const opts = [
            { value: 'user', label: 'User' },
            { value: 'group', label: 'Group' },
            { value: 'customer', label: 'Customer' },
            { value: 'project', label: 'Project' },
        ]
        // Kural: global yalniz basina; user-bound client global alamaz.
        if (clientType !== 'user' && bindings.length <= 1) {
            opts.unshift({ value: 'global', label: BINDING_LABEL.global })
        }
        return opts
    }, [clientType, bindings.length])

    const targetOptions = (type) => pickers[type] || []

    const handleFinish = (values) => {
        const access = (values.access || []).filter(Boolean).map((b) => ({
            access_type: b.access_type,
            target_id: b.access_type === 'global' ? null : b.target_id,
        }))
        onSubmit({
            name: values.name?.trim(),
            description: values.description || null,
            client_type: values.client_type,
            bound_user_id:
                values.client_type === 'user' ? values.bound_user_id : null,
            environment: values.environment,
            scopes: values.scopes || [],
            rate_limit_per_min: values.rate_limit_per_min || null,
            access,
        })
    }

    return (
        <Modal
            open={open}
            title={editing ? 'Edit API Client' : 'Create API Client'}
            okText={editing ? 'Save Changes' : 'Create Client'}
            onOk={() => form.submit()}
            onCancel={onClose}
            confirmLoading={saving}
            width={680}
            destroyOnClose
        >
            <Form
                form={form}
                layout="vertical"
                onFinish={handleFinish}
                initialValues={
                    editing
                        ? {
                              name: editing.name,
                              description: editing.description,
                              client_type: editing.client_type,
                              bound_user_id: editing.bound_user_id,
                              environment: editing.environment,
                              scopes: editing.scopes,
                              rate_limit_per_min: editing.rate_limit_per_min,
                              access: editing.access?.map((b) => ({
                                  access_type: b.access_type,
                                  target_id: b.target_id,
                              })),
                          }
                        : {
                              client_type: 'service',
                              environment: 'dev',
                              scopes: [],
                              access: [],
                          }
                }
            >
                <Form.Item
                    label="Client Name"
                    name="name"
                    rules={[
                        { required: true, message: 'Name is required.' },
                        { min: 2, max: 100 },
                    ]}
                >
                    <Input placeholder="e.g. Reporting Bot" maxLength={100} />
                </Form.Item>
                <Form.Item label="Description" name="description">
                    <Input.TextArea
                        rows={2}
                        maxLength={2000}
                        placeholder="What integrates through this client?"
                    />
                </Form.Item>
                <div className="am-form-row">
                    <Form.Item
                        label="Client Type"
                        name="client_type"
                        tooltip="Service: server-to-server integration. User-bound: acts on behalf of one Hermes user and can never see more than they can."
                    >
                        <Select
                            disabled={!!editing}
                            options={[
                                { value: 'service', label: 'Service' },
                                { value: 'user', label: 'User-bound' },
                            ]}
                        />
                    </Form.Item>
                    <Form.Item
                        label="Environment"
                        name="environment"
                        tooltip="Development tokens only work on the dev deployment; Live tokens only on the live deployment."
                    >
                        <Select
                            disabled={!!editing}
                            options={[
                                { value: 'dev', label: 'Development' },
                                { value: 'live', label: 'Live' },
                            ]}
                        />
                    </Form.Item>
                    <Form.Item
                        label="Rate Limit (req/min)"
                        name="rate_limit_per_min"
                        tooltip="Empty = default 60 requests per minute."
                    >
                        <InputNumber
                            min={1}
                            max={10000}
                            style={{ width: '100%' }}
                            placeholder="60"
                        />
                    </Form.Item>
                </div>
                {clientType === 'user' && (
                    <Form.Item
                        label="Bound Hermes User"
                        name="bound_user_id"
                        rules={[
                            {
                                required: true,
                                message:
                                    'A user-bound client requires a bound user.',
                            },
                        ]}
                    >
                        <Select
                            showSearch
                            optionFilterProp="label"
                            options={targetOptions('user')}
                            placeholder="Select the Hermes user this client acts as"
                            disabled={!!editing}
                        />
                    </Form.Item>
                )}
                <Form.Item
                    label="Scopes"
                    name="scopes"
                    tooltip="What operations the client may perform. Data visibility is controlled separately by access bindings below."
                >
                    <Select
                        mode="multiple"
                        options={scopeOptions}
                        placeholder="Select allowed operations"
                        maxTagCount="responsive"
                    />
                </Form.Item>

                <div className="am-bindings-label">
                    Access bindings
                    <span className="am-bindings-hint">
                        Which data the client can see. No bindings = no
                        business data. Global cannot be combined with
                        narrower bindings.
                    </span>
                </div>
                <Form.List name="access">
                    {(fields, { add, remove }) => (
                        <>
                            {fields.map((field) => {
                                const row = bindings[field.name] || {}
                                return (
                                    <div
                                        key={field.key}
                                        className="am-binding-row"
                                    >
                                        <Form.Item
                                            name={[field.name, 'access_type']}
                                            rules={[{ required: true }]}
                                            style={{ marginBottom: 0 }}
                                        >
                                            <Select
                                                placeholder="Type"
                                                options={bindingTypeOptions}
                                                style={{ minWidth: 150 }}
                                            />
                                        </Form.Item>
                                        {row.access_type !== 'global' && (
                                            <Form.Item
                                                name={[
                                                    field.name,
                                                    'target_id',
                                                ]}
                                                rules={[
                                                    {
                                                        required: true,
                                                        message:
                                                            'Target required.',
                                                    },
                                                ]}
                                                style={{
                                                    marginBottom: 0,
                                                    flex: 1,
                                                }}
                                            >
                                                <Select
                                                    showSearch
                                                    optionFilterProp="label"
                                                    placeholder="Select target"
                                                    options={targetOptions(
                                                        row.access_type
                                                    )}
                                                />
                                            </Form.Item>
                                        )}
                                        <Button
                                            danger
                                            size="small"
                                            onClick={() =>
                                                remove(field.name)
                                            }
                                        >
                                            Remove
                                        </Button>
                                    </div>
                                )
                            })}
                            <Button
                                icon={<PlusOutlined />}
                                size="small"
                                disabled={hasGlobal}
                                onClick={() => add({ access_type: undefined })}
                                style={{ marginTop: 4 }}
                            >
                                Add binding
                            </Button>
                            {hasGlobal && (
                                <span className="am-bindings-hint">
                                    {' '}
                                    Global grants everything — remove it to
                                    add narrower bindings.
                                </span>
                            )}
                        </>
                    )}
                </Form.List>
            </Form>
        </Modal>
    )
}

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
    const onErr = (err) =>
        message.error(err?.response?.data?.detail || 'Operation failed.')

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
                    err?.response?.data?.detail ||
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
        keepPreviousData: true,
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
            } else if (res.status === 'failed') {
                message.error(`Cleanup failed (${res.failure_class}).`)
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
        onError: () => message.error('Cleanup request failed.'),
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
                    <Button
                        type="primary"
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
                                <Button
                                    size="small"
                                    onClick={() =>
                                        setClientModal({ editing: c })
                                    }
                                >
                                    Edit
                                </Button>
                                <Button
                                    size="small"
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
                                    danger={c.status === 'active'}
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
                    <div className="am-doc-card is-static is-coming">
                        <span className="am-doc-title">
                            MCP Server{' '}
                            <Tag color="orange">coming later</Tag>
                        </span>
                        <span className="am-doc-sub">
                            AI-tool integration through the Hermes MCP server
                            is planned for a later stage.
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
                    const c = confirm
                    setConfirm(null)
                    if (c.kind === 'revoke')
                        revokeToken.mutate({ tokenId: c.token.id })
                    else if (c.kind === 'rotate')
                        rotateToken.mutate({ tokenId: c.token.id })
                    else toggleClientStatus.mutate({ client: c.client })
                }}
            />

            <Modal
                open={!!expiryModal}
                title="Update token expiry"
                okText="Save"
                onOk={() =>
                    updateExpiry.mutate({
                        tokenId: expiryModal.token.id,
                        expiresAt: expiryValue
                            ? expiryValue.endOf('day').toISOString()
                            : null,
                    })
                }
                confirmLoading={updateExpiry.isPending}
                onCancel={() => setExpiryModal(null)}
                destroyOnClose
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
