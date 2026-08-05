/**
 * =============================================================================
 * HERMES - Arsiv anahtari (tek dugme)
 * =============================================================================
 * KULLANICI KARARI (2026-08-06): ust seviye "Active | Archive" seridi
 * KALDIRILDI — ayri bir satir isgal ediyor ve calisma alanini asagi
 * itiyordu. Yerine baslik satirinin sagindaki TEK ikon dugme:
 *
 *   kapali  → notr cerceve, arsiv gorunumu KAPALI (Active)
 *   acik    → marka mavisi cerceve + tonal zemin, Archive gorunumu
 *
 * Durum yalniz renkle anlatilmaz: `aria-pressed` ve erisilebilir ad
 * (Show/Hide archived work items) durumu acikca bildirir.
 * =============================================================================
 */
import { InboxOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'

import './lifecycleSwitch.css'

function TaskLifecycleSwitcher({ value, onChange }) {
    const on = value === 'archived'
    return (
        <Tooltip title={on ? 'Hide archive' : 'Show archive'}>
            <button
                type="button"
                className={`h-archive-toggle${on ? ' is-on' : ''}`}
                aria-pressed={on}
                aria-label={on ? 'Hide archived work items' : 'Show archived work items'}
                onClick={() => onChange(on ? 'active' : 'archived')}
            >
                <InboxOutlined />
            </button>
        </Tooltip>
    )
}

export default TaskLifecycleSwitcher
