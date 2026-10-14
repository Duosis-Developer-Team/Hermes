/**
 * =============================================================================
 * HERMES - Duosis Ticket Hub (agent yüzeyi)
 * =============================================================================
 * Uygulama seçici KATALOGDAN gelir: `hermes`/`logislot` kodları burada
 * HARDCODE EDİLMEZ, yeni bir ürün bağlandığında ekran kendiliğinden
 * öğrenir.
 *
 * Filtre durumu URL'e yazılır — bir kuyruk linki paylaşılabilir; ama
 * erişimi yine backend belirler (link, yetki vermez).
 *
 * "Erişiminiz yok" ile "ticket yok" AYRI durumlardır ve ayrı mesajlarla
 * gösterilir: aktif grup üyeliği olmayan bir agent'a boş bir liste
 * göstermek, sorunu sessizce gizlerdi.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Checkbox, Input, message, Pagination, Skeleton } from 'antd'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

import { authService } from '../../api/authApi'
import { ticketErrorCode, ticketHelpdeskService, ticketHubService } from '../../api/ticketsApi'
import { Button, EmptyState, Page } from '../../components/ui'
import { GlassCard, PageHero } from '../../components/liquid'
import AgentWorkbench, { LIVE_REFRESH_MS } from '../../features/tickets/AgentWorkbench'
import { BOARD_QUEUES, TICKET_SORTS, ticketRef } from '../../features/tickets/constants'
import {
    TicketPriorityBadge, TicketStatusBadge,
} from '../../features/tickets/TicketStatusBadge'
import BulkBar from '../../features/tickets/BulkBar'
import TicketBoard from '../../features/tickets/TicketBoard'
import useTicketWorkLog from '../../features/tickets/useTicketWorkLog'
import LogTimeModal from '../../components/modals/LogTimeModal'
import SaveViewModal from '../../features/tickets/SaveViewModal'
import TicketAxisBar from '../../features/tickets/TicketAxisBar'
import TicketFiltersDrawer from '../../features/tickets/TicketFiltersDrawer'
import TicketViewsSidebar from '../../features/tickets/TicketViewsSidebar'
import SlaBadge, { TagChips } from '../../features/tickets/SlaBadge'
import SurfaceSwitch from '../../features/tickets/SurfaceSwitch'
import TicketCustomerLogo from '../../features/tickets/TicketCustomerLogo'
import useTicketContext from '../../features/tickets/useTicketContext'
import { queryKeys } from '../../query/queryKeys'
import '../../features/tickets/tickets.css'
import { useTicketErrorText, useTicketLabel } from '../../features/tickets/useTicketLabel'
import { useT } from '../../i18n'

dayjs.extend(relativeTime)

const DEFAULT_QUEUE = 'my_group_open'
const PAGE_SIZE = 50
// Kayitli gorunume yazilan filtre anahtarlari (URL parametreleriyle ayni).
const VIEW_KEYS = ['queue', 'status', 'priority', 'category', 'group', 'tag', 'sort', 'application', 'q']
// Bu genislikten itibaren liste + satir ici calisma bolmesi yan yana
// (soldaki talepler, sagdaki sohbet); daha darda liste tek basina, detay
// cekmecede acilir.
const SPLIT_QUERY = '(min-width: 1100px)'
// Sol kolon (kuyruklar) gizlenebilir — liste + sohbet tum genisligi alir.
// Kisisel kolaylik: tarayicida hatirlanir (okunamazsa acik baslar).
const RAIL_KEY = 'hermes.tickets.railCollapsed'
const readRail = () => { try { return window.localStorage.getItem(RAIL_KEY) === '1' } catch { return false } }
const writeRail = (on) => { try { window.localStorage.setItem(RAIL_KEY, on ? '1' : '0') } catch { /* yok say */ } }

export default function TicketHubPage() {
    const t = useT()
    const tl = useTicketLabel()
    const errorText = useTicketErrorText()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const [params, setParams] = useSearchParams()
    const context = useTicketContext()

    const [selectedId, setSelectedId] = useState(null)
    const [filtersOpen, setFiltersOpen] = useState(false)
    const [saveOpen, setSaveOpen] = useState(false)
    const [railCollapsed, setRailCollapsed] = useState(readRail)
    const toggleRail = () => setRailCollapsed((on) => { writeRail(!on); return !on })
    const [split, setSplit] = useState(
        () => typeof window !== 'undefined' && window.matchMedia(SPLIT_QUERY).matches,
    )
    useEffect(() => {
        const mq = window.matchMedia(SPLIT_QUERY)
        const onChange = (e) => setSplit(e.matches)
        mq.addEventListener('change', onChange)
        return () => mq.removeEventListener('change', onChange)
    }, [])

    // A6 derin link: is kaleminden gelen `?ticket=<id>` calisma alanini acar
    // (tek seferlik; parametre okunup temizlenir).
    useEffect(() => {
        const wanted = params.get('ticket')
        if (!wanted) return
        setSelectedId(wanted)
        const next = new URLSearchParams(params)
        next.delete('ticket')
        setParams(next, { replace: true })
    }, [params, setParams])

    // Yuzey karari SUNUCUDAN: yalniz talep eden (saglayici olmayan) tenant
    // buraya gelirse kendi ekranina yonlendirilir (404 yerine dogru yer).
    // Hem saglayici hem talep eden tenant iki sayfayi da kullanir.
    useEffect(() => {
        if (context.isPortal && !context.isHub) navigate('/support', { replace: true })
    }, [context.isPortal, context.isHub, navigate])

    const queue = params.get('queue') || DEFAULT_QUEUE
    const applicationId = params.get('application') || undefined
    const search = params.get('q') || ''
    const statuses = params.getAll('status')
    const priorities = params.getAll('priority')
    const categories = params.getAll('category')
    const groupId = params.get('group') || undefined
    // Gorunum: liste (varsayilan) ya da kanban — is yonetimindeki gibi URL'de.
    const layout = params.get('layout') === 'board' ? 'board' : 'list'
    // Musteri (kaynak tenant kaydi) — Musteriler sayfasindan gelinir.
    const customerId = params.get('customer') || undefined
    const tagIds = params.getAll('tag')
    const viewId = params.get('view') || null
    const sort = TICKET_SORTS.includes(params.get('sort')) ? params.get('sort') : 'updated'
    const page = Math.max(1, Number(params.get('page')) || 1)
    // "Clear" ancak temizlenecek bir sey varken gorunur — bos bir
    // filtre cubugunda olu buton durmaz.
    const hasFilters = Boolean(
        search || statuses.length || priorities.length || categories.length
        || tagIds.length || applicationId || groupId || customerId || sort !== 'updated' || viewId
        || (queue && queue !== DEFAULT_QUEUE),
    )

    // Filtre degisince ilk sayfaya donulur; yalniz `page` degisirse kalinir.
    const patchParams = (patch) => {
        const next = new URLSearchParams(params)
        Object.entries(patch).forEach(([key, value]) => {
            next.delete(key)
            if (Array.isArray(value)) value.forEach((v) => next.append(key, v))
            else if (value) next.set(key, value)
        })
        if (!('page' in patch)) next.delete('page')
        // Elle filtre degisirse secili gorunum artik birebir degildir.
        if (!('view' in patch)) next.delete('view')
        setParams(next, { replace: true })
    }

    // Cache anahtari icin DETERMINISTIK filtre: dizi kimligi degil
    // ICERIGI onemli, bu yuzden bagimlilik olarak birlestirilmis metin
    // kullanilir (ayni secim → ayni anahtar → gereksiz refetch yok).
    const statusKey = statuses.join(',')
    const priorityKey = priorities.join(',')
    const categoryKey = categories.join(',')
    const tagKey = tagIds.join(',')
    const filters = useMemo(() => ({
        queue,
        application_id: applicationId,
        q: search || undefined,
        status: statusKey ? statusKey.split(',') : [],
        priority: priorityKey ? priorityKey.split(',') : [],
        category: categoryKey ? categoryKey.split(',') : [],
        group_id: groupId,
        source_tenant_row_id: customerId,
        tag: tagKey ? tagKey.split(',') : [],
        sort,
        page,
    }), [queue, applicationId, search, statusKey, priorityKey, categoryKey, tagKey, groupId, customerId, sort, page])

    const applications = useQuery({
        queryKey: queryKeys.tickets.applications,
        queryFn: ticketHubService.listApplications,
        enabled: context.isHub,
    })

    const queues = useQuery({
        queryKey: [...queryKeys.tickets.queues, applicationId ?? 'all'],
        queryFn: () => ticketHubService.listQueues(
            applicationId ? { application_id: applicationId } : {},
        ),
        enabled: context.isHub,
        refetchInterval: LIVE_REFRESH_MS,
    })

    const groups = useQuery({
        queryKey: queryKeys.tickets.routingGroups,
        queryFn: ticketHubService.routingGroups,
        enabled: context.isHub,
        staleTime: 300_000,
    })

    // Canli yenileme: yeni talep / musteri yaniti 30 sn icinde listeye
    // duser (sekme gorunurken). Sayfalama + siralama sunucuda.
    const list = useQuery({
        queryKey: queryKeys.tickets.list(filters),
        queryFn: () => ticketHubService.list({
            queue,
            application_id: applicationId,
            search: search || undefined,
            status: statuses,
            priority: priorities,
            category: categories,
            group_id: groupId,
            source_tenant_row_id: customerId,
            tag: tagIds,
            sort,
            limit: PAGE_SIZE,
            offset: (page - 1) * PAGE_SIZE,
        }),
        enabled: context.isHub,
        keepPreviousData: true,
        refetchInterval: LIVE_REFRESH_MS,
    })

    // Kanban: tum akis (iptal yok, tamamlanan son 14 gun); kapsam yalniz
    // "tum" ya da "bana atanan" — acik-yalniz kuyruklar Tamamlandi'yi
    // bosaltirdi. Diger suzgecler (arama, musteri, ekip...) gecerli.
    const boardQueue = BOARD_QUEUES.includes(queue) ? queue : 'all'
    const board = useQuery({
        queryKey: queryKeys.tickets.list({ ...filters, queue: boardQueue, page: 1, layout: 'board' }),
        queryFn: () => ticketHubService.list({
            queue: boardQueue, board: true, application_id: applicationId, search: search || undefined,
            status: statuses, priority: priorities, category: categories, group_id: groupId,
            source_tenant_row_id: customerId, tag: tagIds, sort: 'updated', limit: 200,
        }),
        enabled: context.isHub && layout === 'board',
        keepPreviousData: true,
        refetchInterval: LIVE_REFRESH_MS,
    })
    const workLog = useTicketWorkLog()

    const customers = useQuery({
        queryKey: queryKeys.tickets.myCustomers,
        queryFn: ticketHelpdeskService.myCustomers,
        enabled: context.isHub,
        staleTime: 60_000,
    })

    const tags = useQuery({
        queryKey: queryKeys.tickets.tags,
        queryFn: () => ticketHelpdeskService.tags(),
        enabled: context.isHub,
        staleTime: 300_000,
    })
    const views = useQuery({
        queryKey: queryKeys.tickets.views,
        queryFn: ticketHelpdeskService.views,
        enabled: context.isHub,
        staleTime: 300_000,
    })

    // Toplu islem secimi: filtre/sayfa degisince temizlenir.
    const [selected, setSelected] = useState(() => new Set())
    const selectionKey = JSON.stringify(filters)
    useEffect(() => { setSelected(new Set()) }, [selectionKey])
    const toggleSelected = (id) => setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
    })
    const bulk = useMutation({
        mutationFn: ({ action, value }) => ticketHelpdeskService.bulk({
            ticket_ids: [...selected], action, value,
        }),
        onSuccess: (results) => {
            const ok = results.filter((r) => r.ok).length
            const skipped = results.length - ok
            if (skipped) message.warning(t('hub.bulkPartial', { ok, skipped }))
            else message.success(t('hub.bulkDone', { count: ok }))
            setSelected(new Set())
            queryClient.invalidateQueries({ queryKey: queryKeys.tickets.all })
        },
        onError: () => message.error(t('hub.bulkFailed')),
    })

    const saveView = useMutation({
        mutationFn: ({ name, is_shared }) => {
            const filtersOut = {}
            VIEW_KEYS.forEach((key) => {
                const all = params.getAll(key)
                if (all.length > 1) filtersOut[key] = all
                else if (all.length === 1) filtersOut[key] = ['status', 'priority', 'category', 'tag'].includes(key) ? all : all[0]
            })
            return ticketHelpdeskService.createView({ name, is_shared, filters: filtersOut })
        },
        onSuccess: (view) => {
            queryClient.invalidateQueries({ queryKey: queryKeys.tickets.views })
            patchParams({ view: view.id })
            message.success(t('hub.viewSaved'))
        },
        onError: (error) => message.error(error?.normalized?.message || t('hub.viewSaveFailed')),
    })
    const deleteView = useMutation({
        mutationFn: (view) => ticketHelpdeskService.deleteView(view.id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.tickets.views }),
    })
    const applyView = (view) => {
        const next = new URLSearchParams()
        Object.entries(view.filters || {}).forEach(([key, value]) => {
            if (Array.isArray(value)) value.forEach((v) => next.append(key, v))
            else if (value) next.set(key, value)
        })
        next.set('view', view.id)
        setParams(next, { replace: true })
    }

    // Atanan kisilerin adlari (kendi tenant dizini; tek istek).
    const assigneeIds = useMemo(() => [...new Set(
        (list.data?.items ?? []).map((r) => r.assigned_user_id).filter(Boolean),
    )].sort(), [list.data])
    const assignees = useQuery({
        queryKey: queryKeys.authUsersLookup.byIds(assigneeIds),
        queryFn: () => authService.lookupUsers({ ids: assigneeIds }),
        enabled: assigneeIds.length > 0,
        staleTime: 60_000,
    })
    const assigneeName = useMemo(() => Object.fromEntries(
        (assignees.data ?? []).map((u) => [u.id, u.full_name || u.email]),
    ), [assignees.data])

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.tickets.all })
    }

    const onCommandError = (error) => {
        const code = ticketErrorCode(error)
        message.error(errorText(code, t('portal.actionFailed')))
        // Surum catismasinda son hali yukle; composer taslagi
        // AgentWorkbench icinde KORUNUR.
        if (code === 'ticket_version_conflict') invalidate()
    }

    if (context.isLoading) {
        return (
            <Page className="tickets-page fade-in">
                <Skeleton active paragraph={{ rows: 6 }} />
            </Page>
        )
    }

    if (!context.isHub) {
        return (
            <Page className="tickets-page fade-in">
                <EmptyState
                    title={t('hub.unavailable')}
                    description={
                        context.context?.reason === 'missing_permission'
                            ? t('portal.noAccess')
                            : t('portal.moduleNotConfigured')
                    }
                />
            </Page>
        )
    }

    const rows = list.data?.items ?? []
    const total = list.data?.total ?? 0

    // Genis ekranda secim yoksa listenin ilk talebi acilir (prototip).
    const firstId = rows[0]?.id
    const activeId = selectedId || (split ? firstId : null)

    const activeFilterCount = statuses.length + priorities.length + categories.length
        + tagIds.length + (customerId ? 1 : 0) + (groupId ? 1 : 0)
    const activeView = (views.data ?? []).find((v) => v.id === viewId)
    const shownCount = layout === 'board' ? (board.data?.items ?? []).length : total
    const scopeLabel = activeView?.name
        ?? tl('queue', layout === 'board' ? boardQueue : queue)

    return (
        <Page className="tickets-page">
            <SurfaceSwitch />
            <PageHero
                title={t('hub.tickets')}
                subtitle={`${scopeLabel} \u00b7 ${t('hub.countLabel', { count: shownCount })}`}
                actions={(
                    <>
                        {/* Diger sayfalardaki arama alaniyla ayni: onekli tek hap.
                            Enter arar, temizlemek filtreyi kaldirir. */}
                        <Input
                            allowClear
                            className="tickets-search"
                            prefix={<SearchOutlined aria-hidden="true" />}
                            placeholder={t('hub.searchPlaceholder')}
                            aria-label={t('hub.searchPlaceholder')}
                            defaultValue={search}
                            onPressEnter={(e) => patchParams({ q: e.currentTarget.value || null })}
                            onChange={(e) => { if (!e.target.value) patchParams({ q: null }) }}
                        />
                        <Button
                            icon={<ReloadOutlined />}
                            aria-label={t('common.refresh')}
                            title={t('common.refresh')}
                            onClick={() => (layout === 'board' ? board.refetch() : list.refetch())}
                            loading={layout === 'board' ? board.isFetching : list.isFetching}
                        />
                    </>
                )}
            />

            <div className={`tv-workspace tk-workspace${railCollapsed ? ' is-rail-collapsed' : ''}`}>
                <TicketViewsSidebar
                    layout={layout}
                    queues={queues.data ?? []}
                    activeQueue={queue}
                    onSelectQueue={(key) => patchParams({ queue: key === DEFAULT_QUEUE ? null : key })}
                    views={views.data ?? []}
                    activeViewId={viewId}
                    onApplyView={applyView}
                    onDeleteView={(view) => deleteView.mutate(view)}
                    applications={applications.data ?? []}
                    activeApplication={applicationId ?? 'all'}
                    onSelectApplication={(key) => patchParams({ application: key === 'all' ? null : key })}
                    onNavigate={navigate}
                />

                <div className="tv-main">
                    <TicketAxisBar
                        railCollapsed={railCollapsed}
                        onToggleRail={toggleRail}
                        layout={layout}
                        onSelectLayout={(next) => patchParams({ layout: next === 'board' ? 'board' : null, view: viewId })}
                        sort={sort}
                        onSelectSort={(value) => patchParams({ sort: value === 'updated' ? null : value })}
                        activeFilterCount={activeFilterCount}
                        onOpenFilters={() => setFiltersOpen(true)}
                        canClear={hasFilters}
                        onClear={() => setParams(layout === 'board' ? new URLSearchParams({ layout: 'board' }) : new URLSearchParams())}
                        onSaveAs={() => setSaveOpen(true)}
                    />
                    <TicketFiltersDrawer
                        open={filtersOpen}
                        onClose={() => setFiltersOpen(false)}
                        value={{ status: statuses, priority: priorities, category: categories, tag: tagIds, customer: customerId, group: groupId }}
                        onChange={patchParams}
                        onClear={() => patchParams({ status: [], priority: [], category: [], tag: [], customer: null, group: null })}
                        tags={tags.data ?? []}
                        customers={customers.data ?? []}
                        groups={groups.data ?? []}
                    />
                    <SaveViewModal
                        open={saveOpen}
                        onCancel={() => setSaveOpen(false)}
                        onSave={(payload) => { saveView.mutate(payload); setSaveOpen(false) }}
                        canShare={context.can('tickets.config.manage') || context.can('tickets.admin')}
                    />

                    {!context.hasScope ? (
                        <EmptyState
                            title={t('hub.noQueueVisible')}
                            description={t('hub.noScopeHint')}
                        />
                    ) : layout === 'board' ? (
                        <TicketBoard
                            rows={board.data?.items ?? []}
                            assigneeName={assigneeName}
                            canRespond={context.can('tickets.respond') || context.can('tickets.admin')}
                            canResolve={context.can('tickets.resolve') || context.can('tickets.admin')}
                            onOpen={setSelectedId}
                            onChanged={invalidate}
                            onError={onCommandError}
                            onLogTime={workLog.canLogTime ? workLog.openLogTime : undefined}
                        />
                    ) : (
                        <div className={`tickets-split${split ? ' is-split' : ''}`}>
                            <GlassCard className="tickets-list" aria-busy={list.isLoading}>
                                {rows.length > 0 && (
                                    <div className="tickets-list__head">
                                        <Checkbox
                                            checked={rows.every((r) => selected.has(r.id))}
                                            indeterminate={selected.size > 0 && !rows.every((r) => selected.has(r.id))}
                                            onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                                            aria-label={t('hub.selectPage')}
                                        >{t('hub.selectPage')}</Checkbox>
                                    </div>
                                )}
                                <BulkBar
                                    count={selected.size}
                                    groups={groups.data ?? []}
                                    tags={tags.data ?? []}
                                    canAssign={context.can('tickets.assign') || context.can('tickets.admin')}
                                    canRespond={context.can('tickets.respond') || context.can('tickets.admin')}
                                    pending={bulk.isPending}
                                    onAction={(action, value) => bulk.mutate({ action, value })}
                                    onClear={() => setSelected(new Set())}
                                />
                                {list.isLoading && <Skeleton active paragraph={{ rows: 6 }} />}
                                {!list.isLoading && rows.length === 0 && (
                                    <EmptyState title={t('hub.noTickets')} description={t('hub.tryAnotherQueue')} />
                                )}
                                <ul className="tickets-list__rows">
                                    {rows.map((row, i) => (
                                        <li key={row.id} className="tickets-list__item" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                                            <Checkbox
                                                className="tickets-row__check"
                                                checked={selected.has(row.id)}
                                                onChange={() => toggleSelected(row.id)}
                                                aria-label={t('hub.selectTicket', { number: ticketRef(row) })}
                                            />
                                            <button
                                                type="button"
                                                className={`tickets-row${row.id === activeId ? ' is-active' : ''}${row.unread ? ' is-unread' : ''}`}
                                                aria-current={row.id === activeId ? 'true' : undefined}
                                                onClick={() => setSelectedId(row.id)}
                                            >
                                                <TicketCustomerLogo source={row.source_tenant} size={36} className="tickets-row__logo" />
                                                <span className="tickets-row__main">
                                                    <span className="tickets-row__title">
                                                        {row.unread && <span className="tickets-row__dot" aria-label={t('hub.unread')} />}
                                                        <span className="tickets-row__code">{ticketRef(row)}</span>
                                                        {row.title}
                                                    </span>
                                                    <span className="tickets-row__meta">
                                                        <TicketPriorityBadge priority={row.priority} />
                                                        {[row.application?.display_name, row.source_tenant?.display_name,
                                                            row.assigned_user_id
                                                                ? `${row.assigned_group?.name ?? ''} → ${assigneeName[row.assigned_user_id] ?? '…'}`
                                                                : row.assigned_group?.name,
                                                            row.updated_at ? dayjs(row.updated_at).fromNow() : null]
                                                            .filter(Boolean).join(' \u00b7 ')}
                                                    </span>
                                                </span>
                                                <span className="tickets-row__badges">
                                                    <TicketStatusBadge status={row.status} surface="hub" />
                                                    <SlaBadge sla={row.sla} />
                                                    <TagChips tags={row.tags} />
                                                </span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                                {total > PAGE_SIZE && (
                                    <Pagination
                                        className="tickets-list__pager"
                                        simple
                                        size="small"
                                        current={page}
                                        pageSize={PAGE_SIZE}
                                        total={total}
                                        onChange={(next) => patchParams({ page: next > 1 ? String(next) : null })}
                                    />
                                )}
                            </GlassCard>

                            {split && (
                                <AgentWorkbench
                                    inline
                                    ticketId={activeId}
                                    open={Boolean(activeId)}
                                    onClose={() => setSelectedId(null)}
                                    context={context}
                                    onChanged={invalidate}
                                    onError={onCommandError}
                                    onOpenTicket={setSelectedId}
                                    onLogTime={workLog.canLogTime ? workLog.openLogTime : undefined}
                                />
                            )}
                        </div>
                    )}
                </div>
            </div>

            {(!split || layout === 'board') && (
            <AgentWorkbench
                ticketId={selectedId}
                open={Boolean(selectedId)}
                onClose={() => setSelectedId(null)}
                context={context}
                onChanged={invalidate}
                onError={onCommandError}
                onOpenTicket={setSelectedId}
                onLogTime={workLog.canLogTime ? workLog.openLogTime : undefined}
            />
            )}

            {/* Talep cozulunce / "Efor gir" → gorevdeki Log Time penceresi. */}
            <LogTimeModal
                open={Boolean(workLog.logTicket)}
                onClose={workLog.closeLogTime}
                onSubmit={workLog.submitWorkLog}
                prefillTicket={workLog.prefill}
                loading={workLog.isLoggingTime}
            />
        </Page>
    )
}
