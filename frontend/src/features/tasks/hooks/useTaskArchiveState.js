/**
 * =============================================================================
 * HERMES - Active | Archive ekseni (URL'de yasar)
 * =============================================================================
 * Gorunum tercihi gibi bu eksen de URL'den okunur; yerel kopya TUTULMAZ.
 * Boylece ilk boyama zaten dogru havuzdur (gorsel flash yok), tarayici
 * geri/ileri tuslari calisir ve baglanti paylasilabilir.
 *
 *   /project-management/tasks                  → Active (varsayilan)
 *   /project-management/tasks?archive=archived → Archive
 *
 * Gecersiz deger sessizce Active'e duser.
 * =============================================================================
 */
import { useSearchParams } from 'react-router-dom'

import { DEFAULT_ARCHIVE_STATE, isValidArchiveState } from '../model/taskLifecycle'

export function useTaskArchiveState() {
    const [searchParams, setSearchParams] = useSearchParams()
    const raw = searchParams.get('archive')
    const archiveState = isValidArchiveState(raw) ? raw : DEFAULT_ARCHIVE_STATE

    const setArchiveState = (next) => {
        const params = new URLSearchParams(searchParams)
        // Varsayilan havuz URL'i KIRLETMEZ.
        if (next === DEFAULT_ARCHIVE_STATE) params.delete('archive')
        else params.set('archive', next)
        setSearchParams(params)
    }

    return { archiveState, setArchiveState }
}

export default useTaskArchiveState
