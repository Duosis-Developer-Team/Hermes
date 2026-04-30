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

    return {
        ...query,
        canAccessTasks: !!data.can_access_tasks,
        canAssignTasks: !!data.can_assign_tasks,
        isTaskAdmin: !!data.is_admin,
        assignableUserIds: Array.isArray(data.assignable_user_ids)
            ? data.assignable_user_ids
            : [],
        permissions: data,
    }
}

export default useTaskPermissions
