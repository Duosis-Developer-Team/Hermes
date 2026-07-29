/**
 * =============================================================================
 * HERMES - Hizli filtre cip seridi (Sprint 5C)
 * =============================================================================
 * Ikincil kontrol: aktif kapsamin UZERINE biner. Tek secim; aktif cipe
 * tekrar tiklamak temizler. Bir filtre aktifken sona bir "Clear" pili
 * gelir — kullanici hangi cipin acik oldugunu hatirlamak zorunda kalmaz.
 *
 * "Clear" YALNIZCA bu seridi temizler: birincil kapsam (My Tasks /
 * Assigned by Me) bir filtre DEGILDIR ve etkilenmez; layout ve capraz
 * filtre acilir kutulari da yerinde kalir.
 * =============================================================================
 */
import { CloseOutlined } from '@ant-design/icons'

import { TASK_QUICK_FILTERS } from '../model/constants'

function TaskQuickFilters({ value, onToggle, onClear }) {
    return (
        <div
            className="tasks-quickfilters"
            role="toolbar"
            aria-label="Quick task filters"
        >
            {TASK_QUICK_FILTERS.map((f) => {
                const isActive = value === f.value
                return (
                    <button
                        key={f.value}
                        type="button"
                        aria-pressed={isActive}
                        className={`tasks-quickfilter-chip${
                            isActive ? ' tasks-quickfilter-chip-active' : ''
                        }`}
                        onClick={() => onToggle(f.value)}
                    >
                        {f.label}
                    </button>
                )
            })}
            {value !== null && (
                <button
                    type="button"
                    className="tasks-quickfilter-clear"
                    aria-label="Clear quick filter"
                    onClick={onClear}
                >
                    <CloseOutlined />
                    Clear
                </button>
            )}
        </div>
    )
}

export default TaskQuickFilters
