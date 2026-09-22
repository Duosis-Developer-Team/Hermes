/**
 * =============================================================================
 * HERMES - Kayitli gorunumler (PM rework P3.5 / E2)
 * =============================================================================
 * Kisisel + paylasilan gorunumlerin listesi ve yazma islemleri. Sistem
 * gorunumleri buradan GECMEZ (kodda yasar). Invalidation sozlesmesi tek
 * dosyadadir (useTaskInvalidation).
 * =============================================================================
 */
import { useMemo } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import { savedViewService } from '../../../services/api'
import { queryKeys } from '../../../query/queryKeys'
import { normalizeSavedView } from '../model/views'
import { useTaskInvalidation } from './useTaskInvalidation'

export function useSavedViews({ enabled = true } = {}) {
    const { invalidateSavedViews } = useTaskInvalidation()

    const query = useQuery({
        queryKey: queryKeys.views.all,
        queryFn: () => savedViewService.list(),
        enabled,
        staleTime: 60 * 1000,
    })

    const savedViews = useMemo(
        () => (query.data?.items || []).map(normalizeSavedView),
        [query.data],
    )
    const personal = useMemo(() => savedViews.filter((v) => v.scope === 'personal'), [savedViews])
    const shared = useMemo(() => savedViews.filter((v) => v.scope === 'shared'), [savedViews])

    const createMutation = useMutation({
        mutationFn: (data) => savedViewService.create(data),
        onSuccess: invalidateSavedViews,
    })
    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => savedViewService.update(id, data),
        onSuccess: invalidateSavedViews,
    })
    const deleteMutation = useMutation({
        mutationFn: (id) => savedViewService.remove(id),
        onSuccess: invalidateSavedViews,
    })

    return {
        savedViews,
        personal,
        shared,
        isLoading: query.isLoading,
        createView: createMutation.mutateAsync,
        updateView: updateMutation.mutateAsync,
        deleteView: deleteMutation.mutateAsync,
        isSaving: createMutation.isPending || updateMutation.isPending,
    }
}

export default useSavedViews
