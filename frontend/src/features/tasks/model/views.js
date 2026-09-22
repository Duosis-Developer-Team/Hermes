/**
 * =============================================================================
 * HERMES - Gorunum modeli (PM rework P3.5 / E1, E2, E3, E5)
 * =============================================================================
 * Bes eksen (yerlesim × kapsam × tip × zaman × hizli filtre) TEK kavrama
 * toplanir: GORUNUM. Kontrol cubugunda yalniz iki eksen kalir —
 * gruplama · yerlesim; gorunumun kendisi sol kolondan secilir
 * (04-roller §9, 01-tasarim §3.4).
 *
 * Sistem gorunumleri KODDA yasar (kiraci basina tohum satiri surumlerle
 * drift ederdi); kisisel/paylasilan gorunumler `saved_views`tan gelir.
 * `filter_json` sozlesmesi sunucudaki FILTER_KEYS ile birebirdir.
 *
 * SAF VERI + saf fonksiyonlar: React/DOM/API yok.
 * =============================================================================
 */
import { quickFilterParams } from './dates'

export const VIEW_LAYOUTS = [
    { value: 'board', labelKey: 'views.layoutBoard' },
    { value: 'list', labelKey: 'views.layoutList' },
    { value: 'calendar', labelKey: 'views.layoutCalendar' },
]
export const DEFAULT_LAYOUT = 'board'
export const isValidLayout = (v) => VIEW_LAYOUTS.some((l) => l.value === v)

/** Yerlesim basina anlamli gruplamalar. Pano: sutun = durum ya da
 *  kulvar = sahip. Liste: bolum basliklari. Takvim: gun zaten eksen. */
export const GROUPS_BY_LAYOUT = {
    board: ['status', 'owner'],
    list: ['none', 'project', 'status', 'owner', 'due'],
    calendar: [],
}
export const GROUP_LABEL_KEY = {
    none: 'views.groupNone',
    project: 'views.groupProject',
    status: 'views.groupStatus',
    owner: 'views.groupOwner',
    due: 'views.groupDue',
}
export const defaultGroupFor = (layout) => (
    layout === 'board' ? 'status' : layout === 'list' ? 'project' : 'none'
)
export const isValidGroup = (layout, group) =>
    (GROUPS_BY_LAYOUT[layout] || []).includes(group)

/** Eski `?view=board|list|explorer` baglantilari: deger bir YERLESIMDIR. */
export const legacyLayoutOf = (value) => {
    if (value === 'explorer') return 'board'
    return isValidLayout(value) ? value : null
}

// ---------------------------------------------------------------------------
// Sistem gorunumleri (E1/E3). `assignerOnly`: yalniz atama yetkisi olana.
// ---------------------------------------------------------------------------
export const SYSTEM_VIEWS = [
    { id: 'mine', labelKey: 'views.sys.mine', filter: { scope: 'my-tasks' } },
    { id: 'assigned-by-me', labelKey: 'views.sys.assignedByMe', assignerOnly: true,
      filter: { scope: 'assigned-by-me' }, defaultGroup: 'owner' },
    { id: 'triage', labelKey: 'views.sys.triage', filter: { scope: 'all', owner: 'none' },
      defaultLayout: 'list' },
    { id: 'overdue', labelKey: 'views.sys.overdue', filter: { scope: 'my-tasks', due: 'overdue' } },
    { id: 'due-this-week', labelKey: 'views.sys.dueThisWeek', filter: { scope: 'my-tasks', due: 'this-week' } },
    { id: 'completed-this-week', labelKey: 'views.sys.completedThisWeek',
      filter: { scope: 'my-tasks', due: 'completed-this-week' } },
    { id: 'issues', labelKey: 'views.sys.issues', filter: { scope: 'all', type: 'issue' } },
    { id: 'suggestions', labelKey: 'views.sys.suggestions', filter: { scope: 'all', type: 'suggestion' } },
    { id: 'all', labelKey: 'views.sys.all', filter: { scope: 'all' } },
]
export const DEFAULT_VIEW_ID = 'mine'

/** Eski /project-management/:type segmenti → sistem gorunumu. */
export const viewIdForTypeSegment = (segment) => (
    segment === 'issues' ? 'issues' : segment === 'suggestions' ? 'suggestions' : DEFAULT_VIEW_ID
)

const isSystemId = (id) => SYSTEM_VIEWS.some((v) => v.id === id)

export function systemViewsFor({ canViewAssignedByMe }) {
    return SYSTEM_VIEWS.filter((v) => !v.assignerOnly || canViewAssignedByMe)
}

/** Kayitli satiri (API) ortak sekle cevirir. */
export function normalizeSavedView(row) {
    const f = row?.filter_json || {}
    return {
        id: row.id,
        name: row.name,
        scope: row.scope,               // personal | shared
        filter: f,
        defaultLayout: isValidLayout(row.layout) ? row.layout : DEFAULT_LAYOUT,
        defaultGroup: f.group_by || null,
        canEdit: !!row.can_edit,
        saved: true,
    }
}

/** Gorunum kimligini coz: sistem → kayitli → varsayilan (sessiz dusus). */
export function resolveView(viewId, savedViews = [], { canViewAssignedByMe = false } = {}) {
    const sys = systemViewsFor({ canViewAssignedByMe })
    const found = sys.find((v) => v.id === viewId)
        || (savedViews || []).find((v) => v.id === viewId)
    if (found) return found
    // Yetkisiz sistem gorunumu (orn. assigned-by-me) ya da silinmis kayit.
    return sys.find((v) => v.id === DEFAULT_VIEW_ID) || SYSTEM_VIEWS[0]
}

export const layoutOfView = (view) =>
    (view?.defaultLayout && isValidLayout(view.defaultLayout)) ? view.defaultLayout : DEFAULT_LAYOUT

export const groupOfView = (view, layout) => {
    const g = view?.defaultGroup
    return isValidGroup(layout, g) ? g : defaultGroupFor(layout)
}

// ---------------------------------------------------------------------------
// Capraz filtreler (drawer) ↔ filter_json
// ---------------------------------------------------------------------------
export const EMPTY_FILTERS = Object.freeze({
    status: null, priority: null, customer: null, project: null,
    subProject: null, assignee: null,
})

/** Gorunumun sakladigi capraz filtreler (drawer'in baslangic durumu). */
export function filtersOfView(view) {
    const f = view?.filter || {}
    return {
        status: f.status || null,
        priority: f.priority || null,
        customer: f.customer_id || null,
        project: f.project_id || null,
        subProject: f.sub_project_id || null,
        assignee: f.assignee || null,
    }
}

const same = (a, b) => (a || null) === (b || null)

/** Ekran, secili gorunumden saptı mi? (filtre / yerlesim / gruplama) */
export function isViewDirty(view, { filters, layout, group }) {
    const base = filtersOfView(view)
    const filtersDirty = Object.keys(EMPTY_FILTERS).some((k) => !same(base[k], filters?.[k]))
    const layoutDirty = layout !== layoutOfView(view)
    const groupDirty = group !== groupOfView(view, layout)
    return filtersDirty || layoutDirty || groupDirty
}

/** Kaydedilecek filter_json: gorunumun kapsam/tip/termin ekseni + ekrandaki
 *  capraz filtreler + gruplama. Bos degerler yazilmaz. */
export function toFilterJson(view, { filters, group }) {
    const f = view?.filter || {}
    const out = {}
    const put = (k, v) => { if (v !== null && v !== undefined && v !== '') out[k] = v }
    put('scope', f.scope || 'my-tasks')
    put('type', f.type)
    put('owner', f.owner)
    put('due', f.due)
    put('status', filters?.status)
    put('priority', filters?.priority)
    put('customer_id', filters?.customer)
    put('project_id', filters?.project)
    put('sub_project_id', filters?.subProject)
    put('assignee', filters?.assignee)
    put('group_by', group)
    return out
}

// ---------------------------------------------------------------------------
// Gorunum → sorgu girdileri (buildTaskListParams ile ayni sozlesme)
// ---------------------------------------------------------------------------
const DUE_TO_QUICK = {
    overdue: 'overdue',
    'this-week': 'due-this-week',
    'completed-this-week': 'completed-this-week',
}

export function viewQueryInputs(view, { weekStart, yesterday }) {
    const f = view?.filter || {}
    const scope = f.scope || 'my-tasks'
    return {
        taskType: f.type || null,
        taskScope: scope === 'assigned-by-me' ? 'assigned-by-me' : 'my-tasks',
        // 'all' = gorunur kume (sunucu RBAC); kisiye gore daraltma YOK.
        scopeAll: scope === 'all',
        unassigned: f.owner === 'none',
        quickFilter: DUE_TO_QUICK[f.due]
            ? quickFilterParams(DUE_TO_QUICK[f.due], { weekStart, yesterday })
            : null,
        rangeMode: f.range === 'week' ? 'week' : 'all',
    }
}

/** Olusturma modali icin varsayilan tur: gorunumun tipi ya da task. */
export const createTypeOfView = (view) => view?.filter?.type || 'task'

export const isSystemView = (view) => !!view && !view.saved && isSystemId(view.id)
