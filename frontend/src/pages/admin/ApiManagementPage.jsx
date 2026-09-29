/**
 * =============================================================================
 * HERMES - Admin API Management Page (Stage 2E)
 * =============================================================================
 * Dis entegrasyon API client'lari + token yasam dongusu + request loglari +
 * dokumantasyon girisleri.
 *
 * Hermes Liquid (29.09): tam genislik; KPI karolari + hap segment ile bolum
 * secimi + her bolum tek cam kart (settingsKit). Istemciler kart izgarasi,
 * token/istek kayitlari tablo. Veri akisi, sorgular ve mutation'lar AYNI;
 * istek kayitlari hala YALNIZCA o bolum acikken yuklenir.
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
import { Link, useSearchParams } from 'react-router-dom'
import {
    Button, DatePicker, Input, Modal, Select, Spin, Table, Tooltip, message
} from 'antd'
import {
    ApiOutlined, ArrowRightOutlined, ClockCircleOutlined, CodeOutlined, FileTextOutlined, KeyOutlined,
    LockOutlined, PlusOutlined, ReloadOutlined, RobotOutlined, SafetyCertificateOutlined, StopOutlined,
    UnorderedListOutlined,
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
import './settingsKit.css'
import './ApiManagementPage.css'

/*
 * Sorumluluk sinirlari (Sprint 6A/6C): bu dosya YALNIZCA orkestrasyon
 * yapar — sorgular, mutation'lar, onay akislari ve bolum duzeni. Saf
 * sozlukler, sunum kiti ve iki modal kendi modullerinde yasar.
 */
import {
    BINDING_LABEL, ENV_META, SCOPE_HELP, TYPE_LABEL, fmtDate, fmtDateTime,
} from '../../features/api-management/model/format'
import TokenOnceModal from '../../features/api-management/components/TokenOnceModal'
import ClientModal from '../../features/api-management/modals/ClientModal'
import { normalizeApiError } from '../../features/admin/shared/normalizeApiError'
import { useT } from '../../i18n'
import { Avatar, ModalHead } from '../../components/liquid'
import { SettingsEmpty, SettingsKpis, SettingsSection, SettingsTabs } from './settingsKit'

const SECTION_KEYS = ['clients', 'tokens', 'logs', 'docs']

/** HTTP durum kodu → durum hapi tonu. */
const statusTone = (code) => (code < 400 ? 'ok' : code === 429 ? 'warn' : 'bad')

// =============================================================================
// Page
// =============================================================================

function ApiManagementPage() {
    const t = useT()
    const queryClient = useQueryClient()

    /* Bolum secimi URL'de (`?section=`). Istek kayitlari ve temizlik
       durumu YALNIZCA kendi bolumu acikken sorgulanir (eskiden de
       acilir bolum kapaliyken sorgu kapaliydi). */
    const [params, setParams] = useSearchParams()
    const requested = params.get('section')
    const section = SECTION_KEYS.includes(requested) ? requested : 'clients'
    const selectSection = (key) => {
        setParams((prev) => {
            const next = new URLSearchParams(prev)
            next.set('section', key)
            return next
        }, { replace: true })
    }

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
                    t('api.bindingsNotUpdated')
                const partial = new Error(detail)
                partial.isPartial = true
                throw partial
            }
        },
        onSuccess: () => {
            message.success(t('api.clientSaved'))
            setClientModal(null)
            invalidate()
        },
        onError: (err) => {
            if (err?.isPartial) {
                message.warning(t('api.partialSave', { detail: err.message }), 8)
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
                    ? t('api.clientDisabledMsg')
                    : t('api.clientEnabledMsg')
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
            message.success(t('api.tokenRevoked'))
            invalidate()
        },
        onError: onErr,
    })
    const updateExpiry = useMutation({
        mutationFn: ({ tokenId, expiresAt }) =>
            apiManagementService.updateTokenExpiry(tokenId, expiresAt),
        onSuccess: () => {
            message.success(t('api.tokenExpiryUpdated'))
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
                (c.tokens || []).map((tok) => ({ ...tok, client: c }))
            ),
        [clients]
    )
    const activeTokens = allTokens.filter((tok) => tok.status === 'active')

    const envTag = (env) => {
        const meta = ENV_META[env]
        if (!meta) return <span className="lq-tag">{env}</span>
        return <span className={`lq-tag lq-tag--${meta.tone}`}>{t(meta.labelKey)}</span>
    }

    // ── Token tablosu kolonlari ─────────────────────────────────────────
    // Satir parametresi `tok`: `t` cevirici ile GOLGELENMEZ.
    const tokenColumns = [
        {
            title: t('api.client'),
            dataIndex: ['client', 'name'],
            render: (_, tok) => (
                <span className="am-cell-client">
                    <span className="am-cell-client__name">{tok.client.name}</span>
                    {envTag(tok.client.environment)}
                    {tok.client.status !== 'active' && (
                        <span className="lq-tag lq-tag--bad">{t('api.clientDisabledTag')}</span>
                    )}
                </span>
            ),
        },
        {
            title: t('api.tokens'),
            dataIndex: 'token_prefix',
            render: (v, tok) => (
                <span className="am-cell-client">
                    <code className="am-prefix">{v}…</code>
                    {tok.rotated_from_token_id && (
                        <Tooltip title={t('api.rotatedFrom')}>
                            <span className="lq-tag lq-tag--violet">{t('api.rotatedTag')}</span>
                        </Tooltip>
                    )}
                </span>
            ),
        },
        {
            title: t('common.status'),
            dataIndex: 'status',
            render: (v, tok) =>
                v === 'active' && tok.client.status === 'active' ? (
                    <span className="lq-tag lq-tag--ok">{t('api.statusActive')}</span>
                ) : v === 'active' ? (
                    <span className="lq-tag lq-tag--warn">{t('api.statusUnusable')}</span>
                ) : (
                    <span className="lq-tag lq-tag--bad">{t('api.statusRevoked')}</span>
                ),
        },
        {
            title: t('api.created'),
            dataIndex: 'created_at',
            render: (v) => <span className="sk-nowrap">{fmtDate(v)}</span>,
        },
        {
            title: t('api.expires'),
            dataIndex: 'expires_at',
            render: (v) => <span className="sk-nowrap">{v ? fmtDate(v) : t('api.never')}</span>,
        },
        {
            title: t('api.lastUsed'),
            dataIndex: 'last_used_at',
            render: (v, tok) =>
                v ? (
                    <Tooltip title={tok.last_used_ip || ''}>
                        <span className="sk-nowrap">{fmtDateTime(v)}</span>
                    </Tooltip>
                ) : (
                    <span className="sk-muted">—</span>
                ),
        },
        {
            title: <span className="h-sr-only">{t('common.actions')}</span>,
            key: 'actions',
            align: 'right',
            render: (_, tok) => (
                <span className="sk-row-actions">
                    <Button
                        size="small"
                        className="h-inline-action"
                        icon={<ClockCircleOutlined />}
                        disabled={tok.status !== 'active'}
                        onClick={() => {
                            setExpiryValue(
                                tok.expires_at ? dayjs(tok.expires_at) : null
                            )
                            setExpiryModal({ token: tok })
                        }}
                    >{t('api.expiry')}</Button>
                    <Button
                        size="small"
                        className="h-inline-action"
                        icon={<ReloadOutlined />}
                        disabled={tok.status !== 'active'}
                        onClick={() => setConfirm({ kind: 'rotate', token: tok })}
                    >{t('api.rotate')}</Button>
                    <Button
                        size="small"
                        className="h-inline-action h-inline-action--danger"
                        icon={<StopOutlined />}
                        disabled={tok.status !== 'active'}
                        onClick={() => setConfirm({ kind: 'revoke', token: tok })}
                    >{t('api.revoke')}</Button>
                </span>
            ),
        },
    ]

    // ── Request logs ────────────────────────────────────────────────────
    const [logFilters, setLogFilters] = useState({})
    const [logOffset, setLogOffset] = useState(0)
    const LOG_PAGE = 25
    const logsOpen = section === 'logs'
    const { data: logs = [], isFetching: logsLoading } = useQuery({
        queryKey: ['admin-api-request-logs', logFilters, logOffset],
        queryFn: () =>
            apiManagementService.listRequestLogs({
                limit: LOG_PAGE,
                offset: logOffset,
                ...logFilters,
            }),
        enabled: logsOpen,
        /*
         * TanStack Query v5'te `keepPreviousData` KALDIRILDI ve sessizce
         * yok sayiliyordu: her sayfa/filtre degisiminde audit tablosu
         * bosalip yeniden doluyordu. v5 karsiligi `placeholderData`.
         */
        placeholderData: keepPreviousData,
    })
    const logFiltering = Object.values(logFilters).some((v) => v !== undefined)

    // ── Retention / cleanup (Stage 3F) ──────────────────────────────────
    // Yalnizca api_request_logs + api_idempotency_keys yasam dongusu;
    // is verisine backend yapisal olarak dokunamaz.
    const [cleanupConfirm, setCleanupConfirm] = useState(false)
    const { data: cleanup } = useQuery({
        queryKey: ['admin-api-cleanup'],
        queryFn: () => apiManagementService.getCleanupStatus(),
        enabled: logsOpen,
    })
    const runCleanup = useMutation({
        mutationFn: (dryRun) => apiManagementService.runCleanup(dryRun),
        onSuccess: (res) => {
            queryClient.invalidateQueries({ queryKey: ['admin-api-cleanup'] })
            queryClient.invalidateQueries({
                queryKey: ['admin-api-request-logs'],
            })
            const counts = {
                logs: res.request_logs_deleted,
                keys: res.idempotency_keys_deleted,
            }
            if (res.status === 'disabled') {
                message.warning(t('api.cleanupDisabled'))
            } else if (res.status === 'skipped_already_running') {
                message.warning(t('api.cleanupRunning'))
            } else if (res.dry_run) {
                message.info(t('api.dryRunResult', counts))
            } else {
                message.success(t('api.cleanupDone', counts))
            }
        },
        onError: (err) => {
            // Gercek calisma hatasi 500 + sanitize govdeyle gelir
            // (yalnizca failure_class — SQL/stack yok).
            const fc = err?.response?.data?.failure_class
            message.error(
                fc ? t('api.cleanupFailedClass', { reason: fc }) : t('api.cleanupFailed')
            )
            queryClient.invalidateQueries({ queryKey: ['admin-api-cleanup'] })
        },
    })

    const logColumns = [
        {
            title: t('api.time'),
            dataIndex: 'created_at',
            render: (v) => <span className="sk-mono sk-nowrap">{fmtDateTime(v)}</span>,
        },
        {
            title: t('api.client'),
            dataIndex: 'client_id',
            render: (v) => (v ? clientById[v]?.name || v.slice(0, 8) : '—'),
        },
        {
            title: t('api.method'),
            dataIndex: 'method',
            render: (v) => (
                <span className={`am-method am-method--${String(v || '').toLowerCase()}`}>{v}</span>
            ),
        },
        {
            title: t('api.path'),
            dataIndex: 'path',
            render: (v) => <span className="sk-mono">{v}</span>,
        },
        {
            title: t('common.status'),
            dataIndex: 'status_code',
            render: (v, r) => (
                <span className="am-cell-client">
                    <span className={`lq-tag lq-tag--${statusTone(v)} lq-mono`}>{v}</span>
                    {r.rate_limited && (
                        <Tooltip title={t('api.rateLimited')}>
                            <span className="lq-tag lq-tag--warn">RL</span>
                        </Tooltip>
                    )}
                </span>
            ),
        },
        {
            title: t('api.duration'),
            dataIndex: 'duration_ms',
            align: 'right',
            render: (v) => <span className="sk-mono sk-nowrap">{`${v} ms`}</span>,
        },
        {
            title: t('api.requestId'),
            dataIndex: 'request_id',
            render: (v) => <code className="am-prefix">{v}</code>,
        },
        {
            title: t('api.sourceIp'),
            dataIndex: 'source_ip',
            render: (v) => <span className="sk-mono">{v || '—'}</span>,
        },
    ]

    const createClientAction = (
        <Button
            className="h-create-action"
            icon={<PlusOutlined />}
            onClick={() => setClientModal({ editing: null })}
        >{t('api.createClient')}</Button>
    )

    // ── Bolumler ────────────────────────────────────────────────────────
    const clientsBody = clientsLoading ? (
        <div className="am-loading"><Spin /></div>
    ) : clients.length === 0 ? (
        <SettingsEmpty
            icon={<ApiOutlined />}
            title={t('api.noClientsTitle')}
            text={t('api.noClientsText')}
            action={createClientAction}
        />
    ) : (
        <div className="am-clients">
            {clients.map((c) => {
                const active = c.status === 'active'
                const tokenList = c.tokens || []
                const activeCount = tokenList.filter((tok) => tok.status === 'active').length
                const boundName = nameOf[`user:${c.bound_user_id}`]
                return (
                    <article key={c.id} className={`am-client${active ? '' : ' is-disabled'}`}>
                        <header className="am-client__head">
                            <span className="am-client__icon" aria-hidden="true">
                                {c.client_type === 'user' ? <SafetyCertificateOutlined /> : <ApiOutlined />}
                            </span>
                            <div className="am-client__titles">
                                <h3 className="am-client__name">{c.name}</h3>
                                <div className="am-client__tags">
                                    {envTag(c.environment)}
                                    <span className="lq-tag">{TYPE_LABEL[c.client_type] ? t(TYPE_LABEL[c.client_type]) : c.client_type}</span>
                                    <span className={`lq-tag ${active ? 'lq-tag--ok' : 'lq-tag--bad'}`}>
                                        {active ? t('api.statusActive') : t('api.statusDisabled')}
                                    </span>
                                </div>
                            </div>
                        </header>

                        {c.description && <p className="am-client__desc">{c.description}</p>}

                        {c.client_type === 'user' && (
                            <div className="am-client__bound">
                                <Avatar id={c.bound_user_id} name={boundName || t('api.boundUserFallback')} size={24} />
                                <span>{boundName || t('api.boundUserFallback')}</span>
                            </div>
                        )}

                        <dl className="lq-kv am-client__kv">
                            <dt>{t('api.scopes')}</dt>
                            <dd className="am-client__chips">
                                {(c.scopes || []).length ? (
                                    c.scopes.map((s) => (
                                        <span key={s} className="lq-tag lq-tag--info lq-mono">{s}</span>
                                    ))
                                ) : (
                                    <span className="lq-tag lq-tag--bad">{t('api.noScopes')}</span>
                                )}
                            </dd>
                            <dt>{t('api.dataAccess')}</dt>
                            <dd className="am-client__chips">
                                {(c.access || []).length ? (
                                    c.access.map((b) => (
                                        <span
                                            key={b.id}
                                            className={`lq-tag ${b.access_type === 'global' ? 'lq-tag--violet' : ''}`}
                                        >
                                            {b.access_type === 'global'
                                                ? t('api.global')
                                                : `${BINDING_LABEL[b.access_type] ? t(BINDING_LABEL[b.access_type]) : b.access_type}: ${
                                                      nameOf[`${b.access_type}:${b.target_id}`]
                                                      || String(b.target_id).slice(0, 8)
                                                  }`}
                                        </span>
                                    ))
                                ) : (
                                    <span className="lq-tag lq-tag--bad">{t('api.noData')}</span>
                                )}
                            </dd>
                            <dt>{t('api.rateLimit')}</dt>
                            <dd className="lq-mono">{t('api.perMin', { n: c.rate_limit_per_min || 60 })}</dd>
                            <dt>{t('api.tokens')}</dt>
                            <dd>{t('api.tokensActiveOf', { active: activeCount, total: tokenList.length })}</dd>
                            <dt>{t('api.created')}</dt>
                            <dd>{fmtDate(c.created_at)}</dd>
                        </dl>

                        {/* Birincil: yeni token; ikincil: duzenle; yikici:
                            devre disi (hover'da kirmizi). */}
                        <footer className="am-client__actions">
                            <Button
                                size="small"
                                className="h-create-action"
                                icon={<KeyOutlined />}
                                disabled={!active}
                                aria-label={t('api.newTokenFor', { name: c.name })}
                                onClick={() => createToken.mutate({ clientId: c.id })}
                            >{t('api.newToken')}</Button>
                            <Button
                                size="small"
                                className="h-inline-action"
                                aria-label={t('api.editNamed', { name: c.name })}
                                onClick={() => setClientModal({ editing: c })}
                            >{t('common.edit')}</Button>
                            <Button
                                size="small"
                                className="h-inline-action h-inline-action--danger am-client__toggle"
                                aria-label={active
                                    ? t('api.disableNamed', { name: c.name })
                                    : t('api.enableNamed', { name: c.name })}
                                onClick={() => setConfirm({
                                    kind: active ? 'disable' : 'enable',
                                    client: c,
                                })}
                            >{active ? t('api.disable') : t('api.enable')}</Button>
                        </footer>
                    </article>
                )
            })}
        </div>
    )

    const tokensBody = (
        <Table
            rowKey="id"
            size="middle"
            columns={tokenColumns}
            dataSource={allTokens}
            loading={clientsLoading}
            scroll={{ x: 'max-content' }}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            locale={{
                emptyText: (
                    <SettingsEmpty
                        icon={<KeyOutlined />}
                        title={t('api.noTokensTitle')}
                        text={t('api.noTokensText')}
                    />
                ),
            }}
        />
    )

    const cleanupStrip = cleanup && (
        <dl className="lq-kv am-retention">
            <dt>{t('api.retentionLogs')}</dt>
            <dd>
                {t('api.days', { n: cleanup.policy.request_log_retention_days })}
                {!cleanup.policy.enabled && (
                    <span className="lq-tag lq-tag--bad am-retention__off">{t('api.cleanupOff')}</span>
                )}
            </dd>
            <dt>{t('api.retentionKeys')}</dt>
            <dd>{t('api.hoursTtl', { n: cleanup.policy.idempotency_retention_hours })}</dd>
            <dt>{t('api.lastCleanup')}</dt>
            <dd>
                {cleanup.last_run
                    ? t('api.lastCleanupValue', {
                        when: fmtDateTime(cleanup.last_run.started_at),
                        status: cleanup.last_run.dry_run
                            ? `${cleanup.last_run.status} (${t('api.dryRunSuffix')})`
                            : cleanup.last_run.status,
                        logs: cleanup.last_run.request_logs_deleted,
                        keys: cleanup.last_run.idempotency_keys_deleted,
                    })
                    : t('api.noCleanupYet')}
            </dd>
            <dt>{t('api.nextRun')}</dt>
            <dd>
                {cleanup.next_scheduled_run
                    ? fmtDateTime(cleanup.next_scheduled_run)
                    : t('api.cronFallback')}
            </dd>
        </dl>
    )

    const logsBody = (
        <>
            {cleanupStrip}
            <div className="sk-toolbar am-log-filters">
                <div className="sk-toolbar__filters">
                    <Select
                        allowClear
                        aria-label={t('api.client')}
                        placeholder={t('api.client')}
                        className="am-filter am-filter--client"
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
                        aria-label={t('common.status')}
                        placeholder={t('common.status')}
                        className="am-filter am-filter--status"
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
                        className="am-filter am-filter--range"
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
                        placeholder={t('api.requestId')}
                        aria-label={t('api.requestId')}
                        allowClear
                        className="am-filter am-filter--rid"
                        onSearch={(v) => {
                            setLogOffset(0)
                            setLogFilters((f) => ({
                                ...f,
                                request_id: v || undefined,
                            }))
                        }}
                    />
                </div>
            </div>
            <Table
                rowKey="id"
                size="middle"
                columns={logColumns}
                dataSource={logs}
                loading={logsLoading}
                scroll={{ x: 'max-content' }}
                pagination={false}
                locale={{
                    emptyText: (
                        <SettingsEmpty
                            compact
                            icon={<UnorderedListOutlined />}
                            text={logFiltering || logOffset > 0 ? t('api.noLogs') : t('api.noLogsYet')}
                        />
                    ),
                }}
            />
            <div className="am-log-pager">
                <Button
                    size="small"
                    className="h-inline-action"
                    disabled={logOffset === 0}
                    onClick={() =>
                        setLogOffset((o) => Math.max(0, o - LOG_PAGE))
                    }
                >{t('api.newer')}</Button>
                <Button
                    size="small"
                    className="h-inline-action"
                    disabled={logs.length < LOG_PAGE}
                    onClick={() => setLogOffset((o) => o + LOG_PAGE)}
                >{t('api.older')}</Button>
            </div>
        </>
    )

    const docsBody = (
        <div className="am-docs">
            <a className="am-doc am-doc--link" href="/api/public/v1/docs" target="_blank" rel="noreferrer">
                <span className="am-doc__icon" aria-hidden="true"><CodeOutlined /></span>
                <span className="am-doc__text">
                    <span className="am-doc__title">{t('api.interactiveReference')}</span>
                    <span className="am-doc__sub">{t('api.swaggerHint')}</span>
                </span>
                <ArrowRightOutlined className="am-doc__arrow" aria-hidden="true" />
            </a>
            <a className="am-doc am-doc--link" href="/api/public/v1/openapi.json" target="_blank" rel="noreferrer">
                <span className="am-doc__icon" aria-hidden="true"><FileTextOutlined /></span>
                <span className="am-doc__text">
                    <span className="am-doc__title">{t('api.openapiSchema')}</span>
                    <span className="am-doc__sub">{t('api.openapiHint')}</span>
                </span>
                <ArrowRightOutlined className="am-doc__arrow" aria-hidden="true" />
            </a>
            <Link className="am-doc am-doc--link" to="/developer">
                <span className="am-doc__icon" aria-hidden="true"><ApiOutlined /></span>
                <span className="am-doc__text">
                    <span className="am-doc__title">{t('api.developerPortal')}</span>
                    <span className="am-doc__sub">{t('api.developerPortalHint')}</span>
                </span>
                <ArrowRightOutlined className="am-doc__arrow" aria-hidden="true" />
            </Link>
            <div className="am-doc am-doc--wide">
                <span className="am-doc__icon" aria-hidden="true"><LockOutlined /></span>
                <span className="am-doc__text">
                    <span className="am-doc__title">{t('api.authentication')}</span>
                    <span className="am-doc__sub">{t('api.authHint')}</span>
                    <code className="am-doc__code">Authorization: Bearer hms_…</code>
                </span>
            </div>
            <div className="am-doc am-doc--wide">
                <span className="am-doc__icon" aria-hidden="true"><KeyOutlined /></span>
                <span className="am-doc__text">
                    <span className="am-doc__title">{t('api.scopes')}</span>
                    <span className="am-client__chips">
                        {scopeCatalog.map((s) => (
                            <Tooltip key={s} title={SCOPE_HELP[s] ? t(SCOPE_HELP[s]) : undefined}>
                                <span className="lq-tag lq-tag--info lq-mono">{s}</span>
                            </Tooltip>
                        ))}
                    </span>
                </span>
            </div>
            <div className="am-doc am-doc--wide">
                <span className="am-doc__icon" aria-hidden="true"><RobotOutlined /></span>
                <span className="am-doc__text">
                    <span className="am-doc__title">
                        {t('api.mcpServer')}
                        <span className="lq-tag lq-tag--ok">{t('common.active')}</span>
                    </span>
                    <span className="am-doc__sub">{t('api.mcpHint')}</span>
                </span>
            </div>
        </div>
    )

    const sections = {
        clients: {
            icon: <ApiOutlined />, tone: 'blue',
            title: t('api.clients'), subtitle: t('api.clientsSub'),
            count: clients.length, body: clientsBody,
        },
        tokens: {
            icon: <KeyOutlined />, tone: 'green',
            title: t('api.accessTokens'), subtitle: t('api.tokensSub'),
            count: allTokens.length, body: tokensBody, flush: true,
        },
        logs: {
            icon: <UnorderedListOutlined />, tone: 'violet',
            title: t('api.requestLogs'), subtitle: t('api.logsSub'),
            body: logsBody,
            actions: cleanup ? (
                <>
                    <Button
                        size="small"
                        className="h-inline-action"
                        loading={runCleanup.isPending}
                        onClick={() => runCleanup.mutate(true)}
                    >{t('api.dryRun')}</Button>
                    <Button
                        size="small"
                        danger
                        loading={runCleanup.isPending}
                        onClick={() => setCleanupConfirm(true)}
                    >{t('api.runCleanup')}</Button>
                </>
            ) : null,
        },
        docs: {
            icon: <FileTextOutlined />, tone: 'amber',
            title: t('api.documentation'), subtitle: t('api.docsSub'),
            body: docsBody,
        },
    }
    const active = sections[section]

    // ── Render ──────────────────────────────────────────────────────────
    return (
        <div className="am-page">
            <div className="page-header">
                <h1>{t('api.title')}</h1>
                <p>{t('api.subtitle')}</p>
                <div className="am-header-actions">{createClientAction}</div>
            </div>

            <SettingsKpis
                ariaLabel={t('api.summary')}
                items={[
                    { key: 'clients', label: t('api.clients'), value: clients.length },
                    { key: 'tokens', label: t('api.activeTokens'), value: activeTokens.length },
                    { key: 'live', label: t('api.liveClients'), value: clients.filter((c) => c.environment === 'live').length },
                    { key: 'disabled', label: t('api.disabledClients'), value: clients.filter((c) => c.status !== 'active').length },
                ]}
            />

            <SettingsTabs
                ariaLabel={t('api.sections')}
                value={section}
                onChange={selectSection}
                options={[
                    { value: 'clients', label: t('api.clients'), count: clients.length },
                    { value: 'tokens', label: t('api.accessTokens'), count: allTokens.length },
                    { value: 'logs', label: t('api.requestLogs') },
                    { value: 'docs', label: t('api.documentation') },
                ]}
            />

            <div className="lq-enter" key={section}>
                <SettingsSection
                    icon={active.icon}
                    tone={active.tone}
                    title={active.title}
                    subtitle={active.subtitle}
                    count={active.count}
                    actions={active.actions}
                    bodyClassName={active.flush ? 'sk-card__body--flush' : ''}
                >
                    {active.body}
                </SettingsSection>
            </div>

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
                title={t('api.runCleanupConfirm')}
                subtitle={t('api.cleanupConfirmBody')}
                confirmLabel={t('api.runCleanup')}
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
                        ? t('api.confirmRevokeTitle')
                        : confirm?.kind === 'rotate'
                        ? t('api.confirmRotateTitle')
                        : confirm?.kind === 'disable'
                        ? t('api.confirmDisableTitle')
                        : t('api.confirmEnableTitle')
                }
                subtitle={
                    confirm?.kind === 'revoke'
                        ? t('api.confirmRevokeBody')
                        : confirm?.kind === 'rotate'
                        ? t('api.confirmRotateBody')
                        : confirm?.kind === 'disable'
                        ? t('api.confirmDisableBody')
                        : t('api.confirmEnableBody')
                }
                itemSubtitle={
                    confirm?.token
                        ? `${confirm.token.client.name} · ${confirm.token.token_prefix}…`
                        : confirm?.client?.name
                }
                confirmLabel={
                    confirm?.kind === 'revoke'
                        ? t('api.revokeToken')
                        : confirm?.kind === 'rotate'
                        ? t('api.rotateToken')
                        : confirm?.kind === 'disable'
                        ? t('api.disableClient')
                        : t('api.enableClient')
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
                title={<ModalHead icon={<ClockCircleOutlined />} tone="amber" title={t('api.updateTokenExpiry')} />}
                okText={t('common.save')}
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
                <p className="am-expiry-hint">{t('api.neverExpires')}</p>
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
