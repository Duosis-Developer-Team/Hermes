/**
 * Developer Portal — Public API v1 uc katalogu (TEK kaynak).
 *
 * Referans bolumu, hero'daki operasyon sayisi ve arama bu diziden
 * cizilir. Aciklama metinleri sozlukte: `devPortal.ep.<id>`.
 *
 * DEGISMEZ KURAL: buradaki her satir backend router'larinda GERCEKTEN
 * var olmali ve gercek her uc burada olmali — portalReality testi iki
 * yonu de kilitler (uydurma uc yok, belgelenmemis uc yok).
 */

export const ENDPOINT_GROUPS = [
    {
        key: 'meta',
        endpoints: [
            { id: 'health', m: 'GET', path: '/health', noAuth: true },
            { id: 'capabilities', m: 'GET', path: '/capabilities', noAuth: true },
            { id: 'me', m: 'GET', path: '/me' },
        ],
    },
    {
        key: 'tasks',
        endpoints: [
            { id: 'listTasks', m: 'GET', path: '/tasks', scope: 'tasks:read' },
            { id: 'getTask', m: 'GET', path: '/tasks/{code}', scope: 'tasks:read' },
            { id: 'taskActivity', m: 'GET', path: '/tasks/{code}/activity', scope: 'tasks:read' },
            { id: 'listComments', m: 'GET', path: '/tasks/{code}/comments', scope: 'tasks:read' },
            { id: 'createTask', m: 'POST', path: '/tasks', scope: 'tasks:write', write: true, idempotent: true },
            { id: 'createTaskGroup', m: 'POST', path: '/task-groups', scope: 'tasks:write', write: true, idempotent: true },
            { id: 'updateTask', m: 'PATCH', path: '/tasks/{code}', scope: 'tasks:write', write: true },
            { id: 'addComment', m: 'POST', path: '/tasks/{code}/comments', scope: 'tasks:comment', write: true, idempotent: true },
            { id: 'completeTask', m: 'POST', path: '/tasks/{code}/complete', scope: 'tasks:complete', write: true, idempotent: true },
            { id: 'changeStatus', m: 'POST', path: '/tasks/{code}/status', scope: 'tasks:complete', write: true, idempotent: true },
        ],
    },
    {
        key: 'reference',
        endpoints: [
            { id: 'listCustomers', m: 'GET', path: '/customers', scope: 'customers:read' },
            { id: 'getCustomer', m: 'GET', path: '/customers/{id}', scope: 'customers:read' },
            { id: 'listProjects', m: 'GET', path: '/projects', scope: 'projects:read' },
            { id: 'getProject', m: 'GET', path: '/projects/{id}', scope: 'projects:read' },
        ],
    },
    {
        key: 'workLogs',
        endpoints: [
            { id: 'listWorkLogs', m: 'GET', path: '/work-logs', scope: 'work-logs:read' },
            { id: 'getWorkLog', m: 'GET', path: '/work-logs/{id}', scope: 'work-logs:read' },
            { id: 'createWorkLog', m: 'POST', path: '/work-logs', scope: 'work-logs:write', write: true, idempotent: true },
        ],
    },
    {
        key: 'directory',
        endpoints: [
            { id: 'listUsers', m: 'GET', path: '/users', scope: 'users:read' },
            { id: 'getUser', m: 'GET', path: '/users/{id}', scope: 'users:read' },
            { id: 'listGroups', m: 'GET', path: '/groups', scope: 'groups:read' },
            { id: 'getGroup', m: 'GET', path: '/groups/{id}', scope: 'groups:read' },
        ],
    },
    {
        key: 'meetings',
        endpoints: [
            { id: 'listMeetings', m: 'GET', path: '/meetings', scope: 'meetings:read' },
            { id: 'getMeeting', m: 'GET', path: '/meetings/{id}', scope: 'meetings:read' },
        ],
    },
]

export const ALL_ENDPOINTS = ENDPOINT_GROUPS.flatMap((g) => g.endpoints)

export const API_BASE_PATH = '/api/public/v1'
