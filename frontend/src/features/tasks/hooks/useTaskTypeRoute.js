/**
 * =============================================================================
 * HERMES - Is-turu ↔ route senkronizasyonu (Sprint 5C)
 * =============================================================================
 * Aktif is turu (task | issue | suggestion) URL segmentinden gelir:
 * /project-management/:type. Ayrica bildirim e-postalarindaki derin
 * baglanti burada cozulur: ?item=<id> ilgili kaydin Review modalini
 * acar ve parametre URL'den SILINIR ki yenilemede tekrar acilmasin.
 * (?type= eski baglantilar icin hala onurlandirilir.)
 * =============================================================================
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { taskService } from '../../../services/api'
import { PLURAL_TO_TYPE, PM_BASE, TYPE_TO_PLURAL } from '../model/constants'

const KINDS = ['task', 'issue', 'suggestion']

export function useTaskTypeRoute({ onDeepLinkTask }) {
    const { type: typeParam } = useParams()
    const navigate = useNavigate()
    const [searchParams, setSearchParams] = useSearchParams()
    const [taskType, setTaskType] = useState('task')

    useEffect(() => {
        const t = PLURAL_TO_TYPE[typeParam]
        if (t) setTaskType(t)
    }, [typeParam])

    useEffect(() => {
        const itemId = searchParams.get('item')
        const legacyType = searchParams.get('type')
        if (legacyType && KINDS.includes(legacyType)) setTaskType(legacyType)
        if (itemId) {
            taskService
                .getById(itemId)
                .then((t) => { if (t) onDeepLinkTask?.(t) })
                .catch(() => {})
            const next = new URLSearchParams(searchParams)
            next.delete('item')
            next.delete('type')
            setSearchParams(next, { replace: true })
        }
        // Run once on mount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return {
        taskType,
        /** Tur degistirmek bir NAVIGASYONDUR — durum degil URL degisir. */
        goToType: (value) => {
            if (value !== taskType) navigate(`${PM_BASE}/${TYPE_TO_PLURAL[value]}`)
        },
    }
}

export default useTaskTypeRoute
