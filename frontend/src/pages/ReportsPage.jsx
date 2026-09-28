/**
 * =============================================================================
 * HERMES PLATFORM - Raporlar (Hermes Liquid prototipi)
 * =============================================================================
 * Solda cam filtre paneli (hazir tarih araliklari + coklu secimler, her
 * birinde "Temizle"); sagda etkin filtre cipleri (tek tikla kaldir), KPI
 * karolari + CSV ve cam tablo. Mobilde ayni kontroller alt cekmecede.
 * Filtre kontrolleri TEK kaynakta (FilterControls) — eskiden masaustu ve
 * mobil icin iki kopya yaziliydi.
 * =============================================================================
 */

import { useState, useMemo } from 'react'
import {
    DatePicker, Button, Drawer, Select, Table, message, Empty, Spin
} from 'antd'
import {
    CalendarOutlined,
    CloseOutlined,
    DownloadOutlined,
    FilterOutlined,
} from '@ant-design/icons'
import { keepPreviousData, useQuery, useMutation } from '@tanstack/react-query'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'

import { normalizeApiError } from '../features/admin/shared/normalizeApiError'
import useIsMobile from '../hooks/useIsMobile'
import {
    AdminErrorAlert, AdminRefreshHint,
} from '../features/admin/shared/AdminListStates'
import {
    reportsService,
    authService,
    customerService,
    projectService,
    workTypeService,
    platformService
} from '../services/api'
import { useAuthStore } from '../stores/authStore'
import { queryKeys } from '../query/queryKeys'
import { useT } from '../i18n'
import { Avatar, CountUp, GlassCard, LiquidSegmented, PageHero } from '../components/liquid'
import './ReportsPage.css'

dayjs.extend(isoWeek)

const { RangePicker } = DatePicker

// Converts decimal hours to human-readable duration: 0.75 → "45m", 2.75 → "2h 45m", 2.0 → "2h"
function formatDuration(decimalHours) {
    if (!decimalHours && decimalHours !== 0) return '—'
    const h = Math.floor(decimalHours)
    const m = Math.round((decimalHours - h) * 60)
    if (m > 0) return `${h}h ${m}m`
    return `${h}h`
}

// =============================================================================
// Main Component
// =============================================================================

function ReportsPage() {
    const t = useT()
    // RBAC R3: sayfa yetkisi reports.view iznine bakar.
    const canViewReports = useAuthStore((s) => s.can)('reports.view')
    const permissions = useAuthStore((s) => s.permissions)
    /*
     * `can()` izinler HENUZ YUKLENMEMISKEN (null) de `false` doner ve bu
     * sayfa bunu dogrudan "Access Restricted" olarak gosteriyordu:
     * yetkili kullanici, izinler gelene kadar YANLIS bir ret ekrani
     * goruyordu. Ucuncu durum gerekli — "henuz bilmiyoruz".
     */
    const permissionsLoaded = Array.isArray(permissions)

    // ── Filter State ──────────────────────────────────────────────────────────
    const [filterSheetOpen, setFilterSheetOpen] = useState(false)
    const isMobile = useIsMobile()
    const [dateRange, setDateRange] = useState([
        dayjs().startOf('month'),
        dayjs().endOf('month')
    ])
    const [selectedUsers, setSelectedUsers] = useState([])
    const [selectedCustomers, setSelectedCustomers] = useState([])
    const [selectedProjects, setSelectedProjects] = useState([])
    const [selectedTypes, setSelectedTypes] = useState([])
    const [selectedPlatforms, setSelectedPlatforms] = useState([])

    // ── Dropdown Data ─────────────────────────────────────────────────────────
    /* Kullanici filtresi yalniz AD gosterir. Admin-only /auth/users
       ucu (users.manage) `reports.view` yetkisiyle gelen kullanicida
       403 doner ve filtre SESSIZCE bos kalirdi — en az ayricalikli
       dizin ucu bu esitsizligi kapatir (duz dizi doner). */
    const { data: usersData } = useQuery({
        queryKey: queryKeys.users.lookup,
        queryFn: () => authService.lookupUsers(),
        enabled: !!canViewReports,
        staleTime: 5 * 60 * 1000
    })
    const users = useMemo(() => (Array.isArray(usersData) ? usersData : (usersData?.data || [])).sort((a, b) =>
        (a.full_name || '').localeCompare(b.full_name || '', 'en')
    ), [usersData])

    const { data: customersData } = useQuery({
        queryKey: ['customers-list'],
        queryFn: () => customerService.getAll(),
        enabled: !!canViewReports,
        staleTime: 5 * 60 * 1000
    })
    const customers = useMemo(() => {
        const raw = customersData?.data || customersData || []
        return Array.isArray(raw) ? [...raw].sort((a, b) => a.name.localeCompare(b.name, 'en')) : []
    }, [customersData])

    const { data: projectsData } = useQuery({
        queryKey: ['projects-list'],
        queryFn: () => projectService.getAll(),
        enabled: !!canViewReports,
        staleTime: 5 * 60 * 1000
    })
    const projects = useMemo(() => {
        const raw = projectsData?.data || projectsData || []
        return Array.isArray(raw) ? [...raw].sort((a, b) => a.name.localeCompare(b.name, 'en')) : []
    }, [projectsData])

    const { data: workTypesData } = useQuery({
        queryKey: ['work-types-list'],
        queryFn: () => workTypeService.getAll(),
        enabled: !!canViewReports,
        staleTime: 5 * 60 * 1000
    })
    const workTypes = useMemo(() => {
        const raw = workTypesData?.data || workTypesData || []
        return Array.isArray(raw) ? [...raw].sort((a, b) => a.name.localeCompare(b.name, 'en')) : []
    }, [workTypesData])

    const { data: platformsData } = useQuery({
        queryKey: ['platforms-list'],
        queryFn: () => platformService.getAll(),
        enabled: !!canViewReports,
        staleTime: 5 * 60 * 1000
    })
    const platforms = useMemo(() => {
        const raw = platformsData?.data || platformsData || []
        return Array.isArray(raw) ? [...raw].sort((a, b) => a.name.localeCompare(b.name, 'en')) : []
    }, [platformsData])

    // ── Access Control ────────────────────────────────────────────────────────
    if (!permissionsLoaded) {
        // Izinler bilinmiyor: NE rapor NE ret gosterilir.
        return (
            <div style={{ padding: 40, textAlign: 'center' }}>
                <Spin />
            </div>
        )
    }

    if (!canViewReports) {
        return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>{t('reports.accessRestricted')}</div>
    }

    const activeFilterCount =
        selectedUsers.length + selectedCustomers.length + selectedProjects.length +
        selectedTypes.length + selectedPlatforms.length

    const monthRange = () => [dayjs().startOf('month'), dayjs().endOf('month')]
    const handleClearAll = () => {
        setDateRange(monthRange())
        setSelectedUsers([])
        setSelectedCustomers([])
        setSelectedProjects([])
        setSelectedTypes([])
        setSelectedPlatforms([])
    }

    // Hazir tarih araliklari (prototip). Elle secilen aralik 'custom'.
    const PRESETS = {
        week: () => [dayjs().startOf('isoWeek'), dayjs().endOf('isoWeek')],
        month: monthRange,
        lastMonth: () => [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')],
        quarter: () => [dayjs().subtract(2, 'month').startOf('month'), dayjs().endOf('month')],
    }
    const activePreset = Object.keys(PRESETS).find((k) => {
        const [a0, a1] = PRESETS[k]()
        return dateRange?.[0]?.isSame(a0, 'day') && dateRange?.[1]?.isSame(a1, 'day')
    }) || 'custom'

    const groups = [
        { key: 'users', label: t('entity.users'), aria: t('reports.filterByUser'), placeholder: t('reports.allUsers'),
            value: selectedUsers, set: setSelectedUsers, options: users.map((u) => ({ value: u.id, label: u.full_name || u.email })), people: true },
        { key: 'customers', label: t('entity.customers'), aria: t('reports.filterByCustomer'), placeholder: t('reports.allCustomers'),
            value: selectedCustomers, set: setSelectedCustomers, options: customers.map((c) => ({ value: c.id, label: c.name })) },
        { key: 'projects', label: t('entity.projects'), aria: t('reports.filterByProject'), placeholder: t('reports.allProjects'),
            value: selectedProjects, set: setSelectedProjects, options: projects.map((p) => ({ value: p.id, label: p.name })) },
        { key: 'types', label: t('reports.types'), aria: t('reports.filterByType'), placeholder: t('reports.allTypes'),
            value: selectedTypes, set: setSelectedTypes, options: workTypes.map((w) => ({ value: w.id, label: w.name })) },
        { key: 'platforms', label: t('entity.platforms'), aria: t('reports.filterByPlatform'), placeholder: t('reports.allPlatforms'),
            value: selectedPlatforms, set: setSelectedPlatforms, options: platforms.map((pl) => ({ value: pl.id, label: pl.name })) },
    ]

    const controls = (
        <FilterControls
            t={t}
            dateRange={dateRange}
            onDateRange={setDateRange}
            presets={PRESETS}
            activePreset={activePreset}
            groups={groups}
        />
    )

    // Etkin filtre cipleri: tarih + her secili deger (adiyla).
    const chips = groups.flatMap((g) => g.value.map((id) => ({
        key: `${g.key}:${id}`,
        group: g.label,
        name: g.options.find((o) => o.value === id)?.label || '—',
        remove: () => g.set(g.value.filter((v) => v !== id)),
    })))

    return (
        <div className="reports-page">
            <PageHero
                title={t('reports.title')}
                subtitle={t('reports.subtitle')}
                actions={isMobile ? (
                    <Button icon={<FilterOutlined />} onClick={() => setFilterSheetOpen(true)} aria-label={t('tasks.filters')}>
                        {t('tasks.filters')}{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
                    </Button>
                ) : null}
            />

            <div className={`reports-layout${isMobile ? '' : ' has-panel'}`}>
                {isMobile ? (
                    <Drawer
                        title={t('tasks.filters')}
                        placement="bottom"
                        height="auto"
                        open={filterSheetOpen}
                        onClose={() => setFilterSheetOpen(false)}
                        className="reports-filter-sheet"
                    >
                        {controls}
                    </Drawer>
                ) : (
                    <GlassCard className="reports-filter-toolbar reports-panel" as="aside" aria-label={t('tasks.filters')}>
                        <div className="reports-panel__head">
                            <b>{t('tasks.filters')}</b>
                            <Button size="small" onClick={handleClearAll}>{t('reports.clearFilters')}</Button>
                        </div>
                        {controls}
                    </GlassCard>
                )}

                <div className="reports-main">
                    <GlassCard className="reports-active" aria-label={t('reports.activeFilters')}>
                        <span className="reports-active__label">{t('reports.active')}</span>
                        <span className="reports-active__chip">
                            <CalendarOutlined aria-hidden="true" />
                            <b>{dateRange?.[0]?.format('D MMM')} – {dateRange?.[1]?.format('D MMM YYYY')}</b>
                        </span>
                        {chips.map((c) => (
                            <span key={c.key} className="reports-active__chip">
                                {c.group}: <b>{c.name}</b>
                                <button type="button" aria-label={`${t('common.clear')}: ${c.name}`} onClick={c.remove}>
                                    <CloseOutlined />
                                </button>
                            </span>
                        ))}
                        {chips.length > 0 && (
                            <Button size="small" onClick={handleClearAll}>{t('reports.clearAll')}</Button>
                        )}
                    </GlassCard>

                    <MainDashboard
                        dateRange={dateRange}
                        selectedUsers={selectedUsers}
                        selectedCustomers={selectedCustomers}
                        selectedProjects={selectedProjects}
                        selectedTypes={selectedTypes}
                        selectedPlatforms={selectedPlatforms}
                    />
                </div>
            </div>
        </div>
    )
}

// =============================================================================
// FilterControls — TEK kaynak (panel + mobil cekmece)
// =============================================================================

function FilterControls({ t, dateRange, onDateRange, presets, activePreset, groups }) {
    return (
        <div className="reports-controls">
            <div className="reports-field">
                <div className="reports-field__label"><CalendarOutlined aria-hidden="true" /> {t('reports.dateRange')}</div>
                <LiquidSegmented
                    ariaLabel={t('reports.dateRange')}
                    value={activePreset}
                    onChange={(k) => onDateRange(presets[k]())}
                    options={[
                        { value: 'week', label: t('reports.presetWeek') },
                        { value: 'month', label: t('reports.presetMonth') },
                        { value: 'lastMonth', label: t('reports.presetLastMonth') },
                        { value: 'quarter', label: t('reports.presetQuarter') },
                    ]}
                />
                <RangePicker
                    value={dateRange}
                    onChange={onDateRange}
                    allowClear={false}
                    className="reports-range"
                    format="D MMM YYYY"
                />
            </div>
            {groups.map((g) => (
                <div key={g.key} className="reports-field">
                    <div className="reports-field__label">
                        {g.label}
                        {g.value.length > 0 && (
                            <button type="button" className="reports-field__clear" onClick={() => g.set([])}>
                                {t('common.clear')}
                            </button>
                        )}
                    </div>
                    <Select
                        mode="multiple"
                        placeholder={g.placeholder}
                        aria-label={g.aria}
                        value={g.value}
                        onChange={g.set}
                        options={g.options}
                        allowClear
                        showSearch
                        filterOption={(i, o) => (o?.label ?? '').toLowerCase().includes(i.toLowerCase())}
                        maxTagCount={2}
                        className="reports-select"
                        optionRender={g.people ? (o) => (
                            <span className="reports-person">
                                <Avatar id={o.value} name={String(o.label)} size={22} />{o.label}
                            </span>
                        ) : undefined}
                    />
                </div>
            ))}
        </div>
    )
}

// =============================================================================
// MainDashboard
// =============================================================================

function MainDashboard({ dateRange, selectedUsers, selectedCustomers, selectedProjects, selectedTypes, selectedPlatforms }) {
    const t = useT()
    const startDate = dateRange?.[0]?.format('YYYY-MM-DD')
    const endDate = dateRange?.[1]?.format('YYYY-MM-DD')

    const queryKey = [
        'tempo-logs', startDate, endDate,
        selectedUsers, selectedCustomers, selectedProjects, selectedTypes, selectedPlatforms
    ]

    const {
        data: jsonResponse, isLoading, isFetching, isError, error, refetch,
    } = useQuery({
        queryKey,
        queryFn: () => reportsService.getJsonUserLogs({
            start_date: startDate,
            end_date: endDate,
            user_ids: selectedUsers,
            customer_ids: selectedCustomers,
            project_ids: selectedProjects,
            work_type_ids: selectedTypes,
            platform_ids: selectedPlatforms
        }),
        enabled: !!startDate && !!endDate,
        /*
         * TanStack Query v5'te `keepPreviousData` KALDIRILDI; buradaki
         * `keepPreviousData: true` sessizce yok sayiliyordu, yani her
         * filtre degisiminde tablo bosaliyor ve yeniden doluyordu.
         * v5 karsiligi `placeholderData`dir.
         *
         * Yaris konusunda ek onleme gerek YOK: filtreler query key'in
         * PARCASI oldugu icin her kombinasyon kendi cache girdisine
         * yazar; gecikmis bir yanit yeni secimin sonucunu EZEMEZ.
         */
        placeholderData: keepPreviousData,
    })

    /**
     * Satir anahtari VERIDEN turetilir. Eskiden `rowKey={(r, i) => ...}`
     * kullaniliyordu; AntD 5.x'te `rowKey`in `index` parametresi
     * DEPRECATED (siralama/filtreleme sonrasi ayni index farkli satiri
     * gosterebilir). Bu uc kayit `id` DONDURMUYOR, bu yuzden anahtar
     * satirin kendi alanlarindan uretilir; birebir ayni iki kayit varsa
     * deterministik bir sayac ile ayrilir.
     */
    const logs = useMemo(() => {
        const raw = jsonResponse?.data || []
        const seen = new Map()
        return raw.map((row) => {
            const base = [
                row.date, row.user_name, row.customer_name, row.project_name,
                row.work_type, row.activity_type, row.platform_name,
                row.duration, row.description,
            ].join('|')
            const n = (seen.get(base) || 0) + 1
            seen.set(base, n)
            return { ...row, _rowKey: n === 1 ? base : `${base}#${n}` }
        })
    }, [jsonResponse])
    const totalHours = useMemo(() => logs.reduce((sum, l) => sum + (l.duration || 0), 0), [logs])
    const entryCount = logs.length

    const exportMutation = useMutation({
        /*
         * Indirilen dosyanin filtresi ile EKRANDAKI filtre ayni kaynaktan
         * gelir: asagidaki parametreler tablonun `queryKey`iyle birebir
         * ayni degerleri kullanir.
         */
        mutationFn: () => reportsService.exportExcel({
            start_date: startDate,
            end_date: endDate,
            user_ids: selectedUsers,
            customer_ids: selectedCustomers,
            project_ids: selectedProjects,
            work_type_ids: selectedTypes,
            platform_ids: selectedPlatforms
        }),
        // Dosya gercekten uretildikten SONRA konusuruz: eskiden
        // "export started" deniyordu, oysa mutation cozüldügunde
        // indirme ya olmustu ya da olmamisti.
        onSuccess: (result) => {
            message.success(`Downloaded ${result?.filename || 'report'}`)
        },
        onError: (err) => {
            /*
             * Basarisiz indirme BASARI gibi gosterilmez.
             *
             * Indirme yardimcisi, sunucunun JSON hata govdesindeki
             * aciklamayi (orn. "Report window too large.") YEREL bir
             * Error olarak firlatir — HTTP yaniti tasimaz. Bu yuzden
             * dogrudan `normalizeApiError`e verilirse "sunucuya
             * ulasilamiyor" diye siniflanip domain mesaji KAYBOLUR.
             * Yardimci zaten teknik govdeyi disarida birakiyor, bu
             * yuzden onun mesaji guvenle gosterilebilir.
             */
            const local = err?.isDownloadError && err?.message
            message.error(local || normalizeApiError(err).message)
        },
    })
    const exportLoading = exportMutation.isPending
    const exportCsv = () => {
        // Cift tetikleme kilidi KAYNAKTA: butonun `disabled` olmasi bir
        // render GEC geldigi icin arada ikinci indirme baslayabiliyordu.
        if (exportLoading) return
        exportMutation.mutate()
    }

    const columns = [
        {
            title: t('reports.date'),
            dataIndex: 'date',
            width: 90,
            sorter: (a, b) => (a.date || '').localeCompare(b.date || ''),
            sortDirections: ['ascend', 'descend', null],
            showSorterTooltip: false,
            render: d => <span className="reports-date">{dayjs(d).format('D MMM')}</span>
        },
        {
            title: t('entity.user'),
            dataIndex: 'user_name',
            width: 180,
            sorter: (a, b) => (a.user_name || '').localeCompare(b.user_name || '', 'en'),
            sortDirections: ['ascend', 'descend', null],
            showSorterTooltip: false,
            render: u => (
                <span className="reports-person">
                    <Avatar name={u} size={26} />
                    {u}
                </span>
            )
        },
        {
            title: t('entity.customer'),
            dataIndex: 'customer_name',
            width: 130,
            sorter: (a, b) => (a.customer_name || '').localeCompare(b.customer_name || '', 'en'),
            sortDirections: ['ascend', 'descend', null],
            showSorterTooltip: false,
            render: c => <span style={{ color: 'var(--text-primary)' }}>{c}</span>
        },
        {
            title: t('entity.project'),
            dataIndex: 'project_name',
            width: 140,
            sorter: (a, b) => (a.project_name || '').localeCompare(b.project_name || '', 'en'),
            sortDirections: ['ascend', 'descend', null],
            showSorterTooltip: false,
            render: p => <span style={{ color: 'var(--text-primary)' }}>{p}</span>
        },
        {
            title: t('reports.type'),
            dataIndex: 'work_type',
            width: 130,
            sorter: (a, b) => (a.work_type || '').localeCompare(b.work_type || '', 'en'),
            sortDirections: ['ascend', 'descend', null],
            showSorterTooltip: false,
            render: w => <span className="lq-tag lq-tag--violet">{w}</span>
        },
        {
            title: t('entity.platform'),
            dataIndex: 'platform_name',
            width: 110,
            sorter: (a, b) => (a.platform_name || '').localeCompare(b.platform_name || '', 'en'),
            sortDirections: ['ascend', 'descend', null],
            showSorterTooltip: false,
            render: p => p
                ? <span className="lq-tag">{p}</span>
                : <span className="reports-muted">—</span>
        },
        {
            title: t('common.description'),
            dataIndex: 'description',
            ellipsis: true,
            render: d => <span className="reports-muted">{d || '—'}</span>
        },
        {
            title: t('reports.hours'),
            dataIndex: 'duration',
            width: 90,
            align: 'right',
            sorter: (a, b) => (a.duration || 0) - (b.duration || 0),
            sortDirections: ['ascend', 'descend', null],
            showSorterTooltip: false,
            render: h => <span className="reports-hours">{formatDuration(h || 0)}</span>
        }
    ]

    return (
        <>
            <div className="reports-kpis lq-enter h-metric-strip">
                <GlassCard className="lq-kpi">
                    <span className="lq-kpi__value"><CountUp value={totalHours} decimals={2} format={formatDuration} /></span>
                    <span className="lq-kpi__label">{t('reports.totalHours')}</span>
                </GlassCard>
                <GlassCard className="lq-kpi">
                    <span className="lq-kpi__value"><CountUp value={entryCount} /></span>
                    <span className="lq-kpi__label">{t('reports.entries')}</span>
                </GlassCard>
                <div className="reports-kpis__action">
                    <Button
                        type="primary"
                        icon={<DownloadOutlined />}
                        onClick={exportCsv}
                        loading={exportLoading}
                        aria-label={t('reports.downloadCsvHint')}
                    >{t('reports.downloadCsv')}</Button>
                </div>
            </div>

            <AdminErrorAlert error={isError ? error : null} onRetry={refetch} />

            <GlassCard className="content-card reports-table lq-card--flush">
                {logs.length === 0 && !isLoading && !isError ? (
                    <div className="reports-empty">
                        <Empty description={<span>{t('reports.noEntries')}</span>} />
                    </div>
                ) : (
                    <Table
                        dataSource={logs}
                        columns={columns}
                        rowKey="_rowKey"
                        pagination={{
                            defaultPageSize: 25,
                            showSizeChanger: true,
                            pageSizeOptions: [25, 50, 100],
                            showTotal: (total) => <span className="reports-total">{t('reports.entriesCount', { count: total })}</span>,
                        }}
                        /* Ilk yukleme ile arkaplan yenilemesi AYRI. */
                        loading={isLoading && logs.length === 0}
                        showSorterTooltip={false}
                        scroll={{ x: 960, y: 520 }}
                    />
                )}
                <AdminRefreshHint isFetching={isFetching} hasData={logs.length > 0} />
            </GlassCard>
        </>
    )
}

export default ReportsPage
