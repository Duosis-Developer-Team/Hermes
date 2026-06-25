/**
 * =============================================================================
 * HERMES - Task Permissions Hook
 * =============================================================================
 * Wraps GET /api/v1/core/tasks/permissions/me with React Query so the
 * sidebar, route guard, and task pages share a single source of truth.
 *
 * Backend now returns assignable user IDs only. This hook resolves names
 * via authService.lookupUsers (called by callers as needed) and exposes
 * a normalized `assignableUserIds` array.
 *
 * - Stale-while-revalidate: 5 min
 * - Disabled while not authenticated
 * - Falls back to false flags on error (sidebar item hidden)
 * =============================================================================
 */

import { useQuery } from '@tanstack/react-query'

import { taskPermissionService } from '../services/api'
import { useAuthStore } from '../stores/authStore'

const DEFAULT_PERMISSIONS = {
    can_access_tasks: false,
    can_assign_tasks: false,
    is_admin: false,
    assignable_user_ids: [],
    assignable_group_ids: [],
    task: {},
    issue: {},
}

const arr = (v) => (Array.isArray(v) ? v : [])

/**
 * Resolve the {canAccess, canAssign, assignableUserIds, assignableGroupIds}
 * view for one permission scope ('task' | 'issue'), falling back to the
 * back-compat top-level task fields when the nested objects are absent.
 */
function scopeView(data, scope) {
    const s = (scope === 'issue' ? data.issue : data.task) || {}
    if (scope === 'issue') {
        return {
            canAccess: !!s.can_access,
            canAssign: !!s.can_assign,
            assignableUserIds: arr(s.assignable_user_ids),
            assignableGroupIds: arr(s.assignable_group_ids),
        }
    }
    return {
        canAccess: !!(s.can_access ?? data.can_access_tasks),
        canAssign: !!(s.can_assign ?? data.can_assign_tasks),
        assignableUserIds: arr(s.assignable_user_ids).length
            ? arr(s.assignable_user_ids)
            : arr(data.assignable_user_ids),
        assignableGroupIds: arr(s.assignable_group_ids).length
            ? arr(s.assignable_group_ids)
            : arr(data.assignable_group_ids),
    }
}

export function useTaskPermissions() {
    const { isAuthenticated, user } = useAuthStore()

    const query = useQuery({
        queryKey: ['task-permissions', user?.id],
        queryFn: () => taskPermissionService.getMyPermissions(),
        enabled: isAuthenticated && !!user?.id,
        staleTime: 5 * 60 * 1000,
        retry: false,
    })

    const data = query.data || DEFAULT_PERMISSIONS
    const isAdmin = !!data.is_admin
    const taskScope = scopeView(data, 'task')
    const issueScope = scopeView(data, 'issue')

    return {
        ...query,
        isTaskAdmin: isAdmin,
        // Back-compat: task-scope flags (existing callers).
        canAccessTasks: taskScope.canAccess,
        canAssignTasks: taskScope.canAssign,
        assignableUserIds: taskScope.assignableUserIds,
        assignableGroupIds: taskScope.assignableGroupIds,
        // Sidebar / route guard: access to the Tasks area via ANY scope.
        canAccessAny: isAdmin || taskScope.canAccess || issueScope.canAccess,
        // Per-scope views — TasksPage selects by the active work-item type.
        scopes: { task: taskScope, issue: issueScope },
        permissions: data,
    }
}

export default useTaskPermissions
