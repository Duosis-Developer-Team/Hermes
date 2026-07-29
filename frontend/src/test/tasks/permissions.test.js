/**
 * Sprint 5 — Tasks izin selector'lari (§4 permission model, §14 RBAC).
 * Mantik TasksPage'den birebir cikarildi; bu testler mevcut davranisi
 * KILITLER.
 */
import { describe, expect, it } from 'vitest'
import {
    isTaskCopyable, permScopeFor, resolveViewedUserId,
    selectTaskPermissions, scopePerms,
} from '../../features/tasks/model/permissions'

const SCOPES = {
    task: { canAccess: true, canAssign: true,
            assignableUserIds: ['u2', 'u3'], assignableGroupIds: ['g1'] },
    issue: { canAccess: true, canAssign: false,
             assignableUserIds: [], assignableGroupIds: [] },
}

describe('scope esleme', () => {
    it('task → task; issue VE suggestion → issue', () => {
        expect(permScopeFor('task')).toBe('task')
        expect(permScopeFor('issue')).toBe('issue')
        expect(permScopeFor('suggestion')).toBe('issue')
    })
    it('bilinmeyen scope task a duser (mevcut davranis)', () => {
        expect(scopePerms(SCOPES, 'task')).toBe(SCOPES.task)
        expect(scopePerms({ task: SCOPES.task }, 'issue')).toBe(SCOPES.task)
    })
})

describe('FAIL-CLOSED: izinler yuklenmemisken', () => {
    it.each([undefined, null, {}])('scopes=%s → her sey kapali', (scopes) => {
        const p = selectTaskPermissions({ scopes, canAccessAny: false })
        expect(p.canAccessTasks).toBe(false)
        expect(p.canAssignTasks).toBe(false)
        expect(p.canViewAssignedByMe).toBe(false)
        expect(p.canSelectUser).toBe(false)
        expect(p.assignableUserIds).toEqual([])
    })
})

describe('normal kullanici — erisim var, atama YOK', () => {
    const p = selectTaskPermissions({
        scopes: SCOPES, canAccessAny: true, taskType: 'issue',
    })
    it('erisir ama atayamaz', () => {
        expect(p.canAccessTasks).toBe(true)
        expect(p.canAssignTasks).toBe(false)
    })
    it('"Assigned by Me" gorunmez', () => {
        expect(p.canViewAssignedByMe).toBe(false)
    })
    it('kullanici secemez', () => expect(p.canSelectUser).toBe(false))
    it('aday listesi BOS', () => expect(p.assignableUserIds).toEqual([]))
})

describe('atama yetkisi olan kullanici (admin DEGIL)', () => {
    const p = selectTaskPermissions({
        scopes: SCOPES, canAccessAny: true, taskType: 'task',
    })
    it('atayabilir ve "Assigned by Me" gorur', () => {
        expect(p.canAssignTasks).toBe(true)
        expect(p.canViewAssignedByMe).toBe(true)
    })
    it('aday listesi hiyerarsiden gelir', () => {
        expect(p.assignableUserIds).toEqual(['u2', 'u3'])
        expect(p.assignableGroupIds).toEqual(['g1'])
    })
    it('YINE DE kullanici secemez (yalniz admin)', () => {
        expect(p.canSelectUser).toBe(false)
    })
})

describe('admin', () => {
    const p = selectTaskPermissions({
        scopes: SCOPES, isTaskAdmin: true, canAccessAny: true, taskType: 'issue',
    })
    it('atama yetkisi olmasa BILE "Assigned by Me" gorur', () => {
        expect(p.canAssignTasks).toBe(false)
        expect(p.canViewAssignedByMe).toBe(true)
    })
    it('kullanici secebilir', () => expect(p.canSelectUser).toBe(true))
})

describe('create scope, goruntulenen turden BAGIMSIZ', () => {
    it('Tasks sekmesinde "+ New Issue": adaylar ISSUE scope undan gelir', () => {
        const p = selectTaskPermissions({
            scopes: SCOPES, canAccessAny: true,
            taskType: 'task', createType: 'issue',
        })
        expect(p.assignableUserIds).toEqual(['u2', 'u3'])
        expect(p.createAssignableUserIds).toEqual([])
    })
})

describe('goruntulenen kullanici cozumu', () => {
    it('admin secebilir', () => {
        expect(resolveViewedUserId({
            isTaskAdmin: true, selectedUserId: 'u9', currentUserId: 'u1',
        })).toBe('u9')
    })
    it('admin secim yapmadiysa kendisi', () => {
        expect(resolveViewedUserId({
            isTaskAdmin: true, selectedUserId: null, currentUserId: 'u1',
        })).toBe('u1')
    })
    it('NON-ADMIN secili id OLSA BILE her zaman kendisi (veri sizmasi yok)', () => {
        expect(resolveViewedUserId({
            isTaskAdmin: false, selectedUserId: 'u9', currentUserId: 'u1',
        })).toBe('u1')
    })
})

describe('kopyalanabilirlik kurali', () => {
    it('completed ve rejected kopyalanamaz; pending/in_progress kopyalanabilir', () => {
        expect(isTaskCopyable({ status: 'pending' })).toBe(true)
        expect(isTaskCopyable({ status: 'in_progress' })).toBe(true)
        expect(isTaskCopyable({ status: 'completed' })).toBe(false)
        expect(isTaskCopyable({ status: 'rejected' })).toBe(false)
        expect(isTaskCopyable(null)).toBe(false)
    })
})
