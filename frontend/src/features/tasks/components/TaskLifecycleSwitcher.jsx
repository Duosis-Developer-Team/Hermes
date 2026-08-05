/**
 * =============================================================================
 * HERMES - Active | Archive gecisi
 * =============================================================================
 * Ust seviye yasam dongusu ekseni. Gorunum (Explorer/Board/List) ve
 * kapsam eksenlerinden BAGIMSIZDIR: havuz degistirmek gorunum tercihini
 * sifirlamaz.
 * =============================================================================
 */
import { Segmented } from 'antd'

import { ARCHIVE_STATES } from '../model/taskLifecycle'

function TaskLifecycleSwitcher({ value, onChange }) {
    return (
        <Segmented
            className="h-lifecycle-switch"
            size="small"
            value={value}
            onChange={onChange}
            options={ARCHIVE_STATES}
            aria-label="Work item pool"
        />
    )
}

export default TaskLifecycleSwitcher
