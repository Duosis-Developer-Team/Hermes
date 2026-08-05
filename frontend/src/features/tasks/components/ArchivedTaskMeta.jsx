/**
 * =============================================================================
 * HERMES - Arsiv rozeti (tarih + sebep)
 * =============================================================================
 * Arsiv tarihi ve sebebi ERISILEBILIR bicimde gosterilir: bilgi yalnizca
 * renkle degil METINLE anlatilir.
 * =============================================================================
 */
import dayjs from 'dayjs'

const REASON_LABEL = {
    auto_retention: 'Auto-archived',
    manual: 'Archived manually',
    legacy: 'Archived',
}

function ArchivedTaskMeta({ archivedAt, reason }) {
    if (!archivedAt) return null
    const when = dayjs(archivedAt).format('DD MMM YYYY')
    const label = `${REASON_LABEL[reason] || REASON_LABEL.legacy} · ${when}`
    return (
        <span className="h-archived-meta" title={label} aria-label={label}>
            {label}
        </span>
    )
}

export default ArchivedTaskMeta
