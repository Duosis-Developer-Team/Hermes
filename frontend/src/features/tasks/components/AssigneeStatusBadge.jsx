/**
 * =============================================================================
 * HERMES - Assignee status badge + roster (TEK KAYNAK)
 * =============================================================================
 * Board, List ve Explorer AYNI bu bilesenleri kullanir — uc ayri assignee
 * gosterim implementasyonu OLUSMAZ (spesifikasyon §8).
 *
 * Erisilebilirlik sozlesmesi:
 *   - Status YALNIZ renkle anlatilmaz: her badge'de status metni/kisaltmasi
 *     ve `title` + `aria-label` bulunur.
 *   - Isim cozulemediyse (yetki yok / dizin yuklenmedi) ham UUID BASILMAZ;
 *     notr bir yer tutucu gosterilir — badge veya tooltip uzerinden kimlik
 *     sizintisi olmaz (§13).
 *   - Renkler sayfa-ozel hex DEGIL, mevcut status tokenlarindan gelir.
 * =============================================================================
 */
import { Tooltip } from 'antd'
import { assigneeLabelOf } from '../model/grouping'
import './assigneeStatus.css'

const STATUS_LABEL = {
    pending: 'Pending',
    in_progress: 'In Progress',
    completed: 'Completed',
    cancelled: 'Cancelled',
    rejected: 'Rejected',
}

/* Status YALNIZ renkle degil, ayirt edilebilir bir isaretle de anlatilir. */
const STATUS_MARK = {
    pending: '•',
    in_progress: '◔',
    completed: '✓',
    cancelled: '–',
    rejected: '✕',
}

export function AssigneeStatusBadge({ assignment, compact = false }) {
    const label = assigneeLabelOf(assignment)
    const status = assignment?.status || 'pending'
    const statusLabel = STATUS_LABEL[status] || status
    const full = `${label} — ${statusLabel}`

    return (
        <Tooltip title={full} mouseEnterDelay={0.2}>
            <span
                className={`h-assignee-badge h-assignee-badge--${status}`}
                // Klavye ile de acilabilmeli (§16): odaklanabilir.
                tabIndex={0}
                role="img"
                aria-label={full}
                title={full}
            >
                <span className="h-assignee-badge__mark" aria-hidden="true">
                    {STATUS_MARK[status] || '•'}
                </span>
                <span className="h-assignee-badge__name">{label}</span>
                {!compact && (
                    <span className="h-assignee-badge__status">{statusLabel}</span>
                )}
            </span>
        </Tooltip>
    )
}

/**
 * Kart uzerindeki badge listesi.
 * §8: bes kisiye kadar HEPSI gorunur; altincidan itibaren `+N`.
 * `+N` bir eylemdir — tiklanabilir/odaklanabilir olmali ki tam liste
 * acilabilsin (acma davranisini cagiran saglar).
 */
export function AssignmentRoster({
    assignments = [],
    max = 5,
    compact = false,
    onShowAll,
}) {
    const visible = assignments.slice(0, max)
    const hidden = assignments.length - visible.length

    return (
        <div className="h-assignee-roster">
            {visible.map((a) => (
                <AssigneeStatusBadge key={a.id} assignment={a} compact={compact} />
            ))}
            {hidden > 0 && (
                <button
                    type="button"
                    className="h-assignee-badge h-assignee-badge--more"
                    aria-label={`Show all ${assignments.length} assignees`}
                    onClick={(e) => {
                        e.stopPropagation()
                        onShowAll?.()
                    }}
                >
                    +{hidden}
                </button>
            )}
        </div>
    )
}

export default AssigneeStatusBadge
