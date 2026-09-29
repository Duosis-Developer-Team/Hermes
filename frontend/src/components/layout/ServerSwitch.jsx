/**
 * =============================================================================
 * HERMES - Masaustu sunucu anahtari (Test ⇄ Dev, tek tik)
 * =============================================================================
 * YALNIZ masaustu uygulamasinda gorunur: preload koprusu
 * (`window.hermesDesktop.getServers/switchServer`) varsa ada hapi cizilir;
 * tarayicida kopru yoktur → hicbir sey cizilmez. Gecisi ana surec yapar
 * (secimi saklar, pencereyi yeni sunucuya yukler); sayfa yalniz istegi
 * iletir. Oturumlar sunucu basina ayridir (cerez host'a bagli).
 * =============================================================================
 */
import { useState } from 'react'

import { useT } from '../../i18n'
import './ServerSwitch.css'

function readServers() {
    try {
        const info = window.hermesDesktop?.getServers?.()
        return info && Array.isArray(info.servers) && info.servers.length > 1 ? info : null
    } catch {
        return null
    }
}

function ServerSwitch({ className = '' }) {
    const t = useT()
    const [info] = useState(readServers)
    if (!info) return null
    return (
        <span className={`island-seg island-seg--text srv-switch ${className}`} role="group" aria-label={t('shellExtra.server')}>
            {info.servers.map((s) => {
                const on = s.id === info.current
                return (
                    <button
                        key={s.id}
                        type="button"
                        className={`${on ? 'is-on' : ''} srv-switch--${s.id}`}
                        aria-pressed={on}
                        title={on ? s.label : t('shellExtra.switchServer', { name: s.label })}
                        onClick={() => { if (!on) window.hermesDesktop.switchServer(s.id) }}
                    >
                        <i className="srv-switch__dot" aria-hidden="true" />
                        {s.label}
                    </button>
                )
            })}
        </span>
    )
}

export default ServerSwitch
