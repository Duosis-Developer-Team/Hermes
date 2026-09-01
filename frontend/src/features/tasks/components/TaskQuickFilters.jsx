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
import { useT } from '../../../i18n'

function TaskQuickFilters({ value, onToggle, onClear }) {
    const t = useT()
    return (
        <div
            className="tasks-quickfilters"
            role="toolbar"
            aria-label={t('explorer.quickFilters')}
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
                    aria-label={t('explorer.clearQuickFilter')}
                    onClick={onClear}
                >
                    <CloseOutlined />{t('common.clear')}</button>
            )}
        </div>
    )
}

export default TaskQuickFilters
