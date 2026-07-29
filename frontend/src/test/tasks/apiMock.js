/**
 * =============================================================================
 * HERMES - Tasks entegrasyon testleri icin API mock'u (Sprint 5C)
 * =============================================================================
 * MOCK SADAKATI (kanla ogrenilmis kural — scripts/qa/tasks-visual-qa.mjs
 * basliginda da yazili): Tasks yuzeyindeki core uclari DUZ DIZI doner
 * (`taskService.list` → `response.data`). Zarf ({data: []}) dondurmek
 * sayfayi "not iterable" ile route error boundary'ye dusurur — yanlis
 * mock YANLIS KUSUR uretir. Buradaki tum liste uclari dizi doner.
 *
 * Kullanim (test dosyasinin EN USTUNDE, import'lardan once):
 *
 *   vi.mock('../../services/api', async () => await import('./apiMock'))
 *   import { resetTasksApi, mockState, taskService } from './apiMock'
 *
 * `resetTasksApi()` her testte mock'lari SIFIRLAR ve varsayilan
 * implementasyonlari geri yukler (mockReset, once-implementasyon
 * kuyruklarini da temizler).
 * =============================================================================
 */
import { vi } from 'vitest'

// ── Sabit fixture'lar ───────────────────────────────────────────────────
export const CUSTOMERS = [
    { id: 'c1', name: 'Vakko', code: 'VAK', is_active: true },
    { id: 'c2', name: 'Beymen', code: 'BEY', is_active: true },
]
export const PROJECTS = [
    { id: 'p1', customer_id: 'c1', name: 'ATM Yenileme', is_active: true },
    { id: 'p2', customer_id: 'c2', name: 'Web Portal', is_active: true },
]
export const SUB_PROJECTS = [
    { id: 'sp1', customer_id: 'c1', project_id: 'p1', name: 'Faz 1' },
]
export const USERS = [
    { id: 'u1', full_name: 'Ada Lovelace', email: 'ada@duosis.com' },
    { id: 'u2', full_name: 'Grace Hopper', email: 'grace@duosis.com' },
    { id: 'u3', full_name: 'Alan Turing', email: 'alan@duosis.com' },
]
export const WORK_TYPES = [{ id: 'w1', name: 'Development' }]
export const ACTIVITY_TYPES = [{ id: 'a1', name: 'Coding' }]
export const PLATFORMS = [{ id: 'pf1', name: 'Backend' }]
export const WORK_LINES = [{ id: 'wl1', name: 'Delivery' }]

/** GERCEK sekil (snake_case) — useTaskPermissions.scopeView ile birebir. */
export const PERMS_ASSIGNER = {
    is_admin: false,
    task: {
        can_access: true,
        can_assign: true,
        assignable_user_ids: ['u2', 'u3'],
        assignable_group_ids: [],
    },
    issue: {
        can_access: true,
        can_assign: true,
        assignable_user_ids: ['u2'],
        assignable_group_ids: [],
    },
}
export const PERMS_NO_ASSIGN = {
    is_admin: false,
    task: {
        can_access: true,
        can_assign: false,
        assignable_user_ids: [],
        assignable_group_ids: [],
    },
    issue: {
        can_access: true,
        can_assign: false,
        assignable_user_ids: [],
        assignable_group_ids: [],
    },
}
export const PERMS_ADMIN = { ...PERMS_ASSIGNER, is_admin: true }

/** Tek gorev uretici — gercek liste ucunun alan setiyle ayni. */
export const mkTask = (over = {}) => ({
    id: 't1',
    task_code: 'TASK-1',
    task_type: 'task',
    title: 'Gorev basligi',
    description: 'Gorev aciklamasi',
    status: 'pending',
    priority: 'medium',
    customer_id: 'c1',
    project_id: 'p1',
    sub_project_id: null,
    customer_name: 'Vakko',
    project_name: 'ATM Yenileme',
    sub_project_name: null,
    assignee_user_id: 'u1',
    assigner_user_id: 'u2',
    scheduled_date: '2026-07-27',
    due_date: '2026-07-31',
    ...over,
})

const INITIAL = () => ({
    tasks: [],
    perms: PERMS_ASSIGNER,
    customers: CUSTOMERS,
    projects: PROJECTS,
    subProjects: SUB_PROJECTS,
    users: USERS,
    assignableGroups: [],
    workTypes: WORK_TYPES,
    activityTypes: ACTIVITY_TYPES,
    platforms: PLATFORMS,
    workLines: WORK_LINES,
    activity: [],
    comments: [],
    searchResults: [],
})

/** Testlerin okudugu/yazdigi paylasilan durum. */
export const mockState = INITIAL()

const ok = (value) => () => Promise.resolve(value)
const from = (key) => () => Promise.resolve(mockState[key])

// ── Varsayilan implementasyonlar (servis → fonksiyon → impl) ────────────
const DEFS = {
    authService: {
        // Gercek uc gibi davranir: `ids` verilirse YALNIZ o kimlikler
        // doner — izin listesinin UI'a nasil yansidigini test edebilmek
        // icin sart.
        lookupUsers: (params) =>
            Promise.resolve(
                Array.isArray(params?.ids)
                    ? mockState.users.filter((u) => params.ids.includes(u.id))
                    : mockState.users
            ),
        getMe: ok({ id: 'u1', full_name: 'Ada Lovelace' }),
        getUsers: from('users'),
    },
    customerService: { getAll: from('customers') },
    projectService: { getAll: from('projects') },
    workTypeService: { getAll: from('workTypes') },
    activityTypeService: { getAll: from('activityTypes') },
    platformService: { getAll: from('platforms') },
    workLineService: { getAll: from('workLines') },
    taskSubProjectService: {
        list: from('subProjects'),
        createInline: ok({ id: 'sp-new', name: 'Yeni' }),
    },
    taskPermissionService: { getMyPermissions: from('perms') },
    workLogService: {
        create: ok({ id: 'wl-new' }),
        getMyLogs: ok([]),
        update: ok({}),
        delete: ok(undefined),
    },
    timesheetService: { getPeriodStatus: ok({ status: 'open' }) },
    taskService: {
        list: from('tasks'),
        getById: (id) =>
            Promise.resolve(mockState.tasks.find((t) => t.id === id) || null),
        create: ok({ id: 't-new' }),
        createBulk: ok([{ id: 't-new' }]),
        createForGroup: ok({ tasks: [{ id: 't-new' }] }),
        listAssignableGroups: from('assignableGroups'),
        update: (id) => Promise.resolve({ id, status: 'pending' }),
        updateStatus: (id, status) => Promise.resolve({ id, status }),
        setCompleted: (id, completed) =>
            Promise.resolve({ id, status: completed ? 'completed' : 'pending' }),
        reject: (id) => Promise.resolve({ id, status: 'rejected' }),
        delete: ok({ ok: true }),
        listActivity: from('activity'),
        listComments: from('comments'),
        createComment: ok({ id: 'cm-new' }),
        updateComment: ok({ id: 'cm-1' }),
        deleteComment: ok({ ok: true }),
        search: from('searchResults'),
    },
}

const build = (name) =>
    Object.fromEntries(
        Object.entries(DEFS[name]).map(([fn, impl]) => [fn, vi.fn(impl)])
    )

export const authService = build('authService')
export const customerService = build('customerService')
export const projectService = build('projectService')
export const workTypeService = build('workTypeService')
export const activityTypeService = build('activityTypeService')
export const platformService = build('platformService')
export const workLineService = build('workLineService')
export const taskSubProjectService = build('taskSubProjectService')
export const taskPermissionService = build('taskPermissionService')
export const workLogService = build('workLogService')
export const timesheetService = build('timesheetService')
export const taskService = build('taskService')

const SERVICES = {
    authService,
    customerService,
    projectService,
    workTypeService,
    activityTypeService,
    platformService,
    workLineService,
    taskSubProjectService,
    taskPermissionService,
    workLogService,
    timesheetService,
    taskService,
}

/**
 * Her testin basinda cagrilir: durumu fixture'lara dondurur ve TUM
 * mock'lari sifirlayip varsayilan implementasyonu geri yukler.
 * mockReset kullanilir — `mockResolvedValueOnce` kuyruklari testler
 * arasinda SIZMAZ.
 */
export function resetTasksApi(patch = {}) {
    Object.assign(mockState, INITIAL(), patch)
    for (const [name, svc] of Object.entries(SERVICES)) {
        for (const [fn, impl] of Object.entries(DEFS[name])) {
            svc[fn].mockReset()
            svc[fn].mockImplementation(impl)
        }
    }
}
