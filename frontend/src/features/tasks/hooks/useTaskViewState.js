/**
 * =============================================================================
 * HERMES - Tasks gorunum durumu (Sprint 5C → PM rework P3.5 / E1, E2)
 * =============================================================================
 * EKRANIN DURUMU = SECILI GORUNUM. Uc eksen URL'de yasar (tek kaynak,
 * link ile paylasilabilir — E2):
 *
 *   ?view=<sistem-kimligi | kayitli-uuid>   hangi gorunum
 *   ?layout=board|list|calendar            yerlesim (E5: takvim de bir yerlesim)
 *   ?group=status|owner|project|due|none   gruplama
 *
 * Varsayilan degerler URL'i KIRLETMEZ. Gorunum degisince yerlesim ve
 * gruplama o gorunumun varsayilanina doner (parametreler silinir).
 * Eski `?view=board|list|explorer` baglantilari yerlesim olarak
 * onurlandirilir (explorer → board). setSearchParams PUSH yapar; geri/
 * ileri calisir.
 *
 * Yerel state YOK: ilk boyama zaten dogru gorunumdur (gorsel flash yok).
 * Hafta ve admin kullanici secimi eksen DEGILDIR, burada yasar.
 * =============================================================================
 */
import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'

import { currentWeekStart } from '../model/dates'
import {
    DEFAULT_LAYOUT, defaultGroupFor, isValidGroup, isValidLayout, legacyLayoutOf,
    viewIdForTypeSegment,
} from '../model/views'

export function useTaskViewState({ resolveDefaults = null } = {}) {
    const [weekStart, setWeekStart] = useState(() => currentWeekStart())
    const [searchParams, setSearchParams] = useSearchParams()
    const { type: typeSegment } = useParams()

    const rawView = searchParams.get('view')
    const legacyLayout = legacyLayoutOf(rawView)
    // Eski baglanti (?view=board) gorunum DEGIL yerlesim soyler.
    const viewId = rawView && !legacyLayout ? rawView : viewIdForTypeSegment(typeSegment)
    // Gorunumun varsayilan yerlesim/gruplamasi (URL'de yoksa buna duser).
    const viewDefaults = resolveDefaults ? resolveDefaults(viewId) : null

    const rawLayout = searchParams.get('layout')
    const layout = isValidLayout(rawLayout)
        ? rawLayout
        : (legacyLayout || (isValidLayout(viewDefaults?.layout) ? viewDefaults.layout : DEFAULT_LAYOUT))

    // Gorunumun gruplama varsayilani YALNIZ kendi yerlesiminde gecerlidir;
    // kullanici yerlesimi degistirince o yerlesimin varsayilani gelir.
    const baseGroup = (viewDefaults?.layout === layout && isValidGroup(layout, viewDefaults?.group))
        ? viewDefaults.group
        : defaultGroupFor(layout)
    const rawGroup = searchParams.get('group')
    const groupBy = isValidGroup(layout, rawGroup) ? rawGroup : baseGroup

    const setViewId = (next) => {
        const params = new URLSearchParams(searchParams)
        if (!next || next === viewIdForTypeSegment(typeSegment)) params.delete('view')
        else params.set('view', next)
        // Gorunum degisti → yerlesim/gruplama o gorunumun varsayilanina.
        params.delete('layout')
        params.delete('group')
        setSearchParams(params)
    }

    const setLayout = (next) => {
        if (!isValidLayout(next)) return
        const params = new URLSearchParams(searchParams)
        if (legacyLayout) params.delete('view')
        const base = isValidLayout(viewDefaults?.layout) ? viewDefaults.layout : DEFAULT_LAYOUT
        if (next === base) params.delete('layout')
        else params.set('layout', next)
        // Mevcut gruplama yeni yerlesimde anlamsizsa parametre silinir.
        if (!isValidGroup(next, params.get('group'))) params.delete('group')
        setSearchParams(params)
    }

    const setGroupBy = (next) => {
        if (!isValidGroup(layout, next)) return
        const params = new URLSearchParams(searchParams)
        if (next === baseGroup) params.delete('group')
        else params.set('group', next)
        setSearchParams(params)
    }

    // Admin-only user selector (Time Entry parity). null → current user.
    const [selectedUserId, setSelectedUserId] = useState(null)

    return {
        viewId,
        setViewId,
        layout,
        setLayout,
        groupBy,
        setGroupBy,
        weekStart,
        setWeekStart,
        goToPreviousWeek: () => setWeekStart((p) => p.subtract(1, 'week')),
        goToNextWeek: () => setWeekStart((p) => p.add(1, 'week')),
        goToCurrentWeek: () => setWeekStart(currentWeekStart()),
        selectedUserId,
        setSelectedUserId,
    }
}

export default useTaskViewState
