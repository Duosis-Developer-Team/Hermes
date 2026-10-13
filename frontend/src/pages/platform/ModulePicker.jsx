/**
 * =============================================================================
 * HERMES - Kiraci modul secici (super-admin)
 * =============================================================================
 * Gorsel kartlarla coklu secim + hazir sablonlar. Katalog ve bagimlilik
 * kurali frontend aynasindan (features/modules/catalog.js; sunucu ayni
 * kurali ayrica dogrular):
 *   - Raporlar secilince Zaman girisi de acilir;
 *   - Zaman girisi kapatilinca Raporlar da kapanir.
 * Sablonlar yalniz DOLDURMA kisayoludur (K2: paket sistemi yok).
 * =============================================================================
 */
import { useState } from 'react'
import {
    BarChartOutlined, CalendarOutlined, CheckOutlined, CheckSquareOutlined,
    ClockCircleOutlined, CodeOutlined, CustomerServiceOutlined, LockOutlined,
} from '@ant-design/icons'

import { MODULE_CODES, MODULE_REQUIRES } from '../../features/modules/catalog'
import { useT } from '../../i18n'
import './platform.css'

export const MODULE_ICON = {
    time_entry: <ClockCircleOutlined />,
    work: <CheckSquareOutlined />,
    meetings: <CalendarOutlined />,
    tickets: <CustomerServiceOutlined />,
    reports: <BarChartOutlined />,
    developer: <CodeOutlined />,
}

// Modulun kart rengi (Hermes paleti; anlam: yalniz ayirt etme).
export const MODULE_TONE = {
    time_entry: 'blue', work: 'green', meetings: 'violet',
    tickets: 'red', reports: 'amber', developer: 'ink',
}

export const PRESETS = [
    { key: 'full', labelKey: 'platform.presetFull', modules: MODULE_CODES },
    { key: 'tickets', labelKey: 'platform.presetTickets', modules: ['tickets'] },
    { key: 'work', labelKey: 'platform.presetWork', modules: ['time_entry', 'work', 'meetings', 'reports'] },
]

const ordered = (set) => MODULE_CODES.filter((c) => set.has(c))

/** Bagimlilik kurali uygulanmis yeni secim + kullaniciya soylenecek not. */
export function toggleModule(current, code) {
    const set = new Set(current)
    let note = null
    if (set.has(code)) {
        set.delete(code)
        // Bu modula BAGIMLI olanlar da kapanir.
        for (const [mod, deps] of Object.entries(MODULE_REQUIRES)) {
            if (deps.includes(code) && set.has(mod)) {
                set.delete(mod)
                note = 'platform.autoRemovedReports'
            }
        }
    } else {
        set.add(code)
        for (const dep of MODULE_REQUIRES[code] || []) {
            if (!set.has(dep)) {
                set.add(dep)
                note = 'platform.autoAddedTimeEntry'
            }
        }
    }
    return { modules: ordered(set), note }
}

export const presetOf = (modules) => {
    const key = [...modules].sort().join(',')
    return PRESETS.find((p) => [...p.modules].sort().join(',') === key)?.key || null
}

/** Rozet listesi (tablolarda): acik modullerin kucuk ikonlari. */
export function ModuleBadges({ modules = [] }) {
    const t = useT()
    if (!modules.length) return <span className="pc-muted">{t('platform.noModules')}</span>
    return (
        <span className="pc-mbadges" aria-label={modules.map((m) => t(`modules.${m}`)).join(', ')}>
            {modules.map((m) => (
                <span key={m} className={`pc-mbadge pc-tone--${MODULE_TONE[m]}`} title={t(`modules.${m}`)} aria-hidden="true">
                    {MODULE_ICON[m]}
                </span>
            ))}
        </span>
    )
}

function ModulePicker({ value = [], onChange, disabled = false }) {
    const t = useT()
    const [note, setNote] = useState(null)
    const active = presetOf(value)

    const toggle = (code) => {
        if (disabled) return
        const next = toggleModule(value, code)
        setNote(next.note)
        onChange?.(next.modules)
    }

    return (
        <div className="pc-modules">
            <div className="pc-presets" role="group" aria-label={t('platform.presets')}>
                <span className="pc-presets__label">{t('platform.presets')}</span>
                {PRESETS.map((p) => (
                    <button
                        key={p.key}
                        type="button"
                        className={`pc-chip${active === p.key ? ' is-on' : ''}`}
                        aria-pressed={active === p.key}
                        disabled={disabled}
                        onClick={() => { setNote(null); onChange?.(ordered(new Set(p.modules))) }}
                    >
                        {t(p.labelKey)}
                    </button>
                ))}
            </div>
            <ul className="pc-mgrid" role="group" aria-label={t('platform.modulesTitle')}>
                {MODULE_CODES.map((code) => {
                    const on = value.includes(code)
                    const needs = MODULE_REQUIRES[code]
                    return (
                        <li key={code}>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={on}
                                disabled={disabled}
                                className={`pc-mcard pc-tone--${MODULE_TONE[code]}${on ? ' is-on' : ''}`}
                                onClick={() => toggle(code)}
                            >
                                <span className="pc-mcard__icon" aria-hidden="true">{MODULE_ICON[code]}</span>
                                <span className="pc-mcard__text">
                                    <b>{t(`modules.${code}`)}</b>
                                    <small>{t(`platform.moduleDesc.${code}`)}</small>
                                    {needs && <em className="pc-mcard__dep">{t('platform.requiresTimeEntry')}</em>}
                                </span>
                                <span className="pc-mcard__check" aria-hidden="true">{on ? <CheckOutlined /> : null}</span>
                            </button>
                        </li>
                    )
                })}
            </ul>
            <p className="pc-core"><LockOutlined aria-hidden="true" /> {t('platform.coreAlways')}</p>
            {note && <p className="pc-note" role="status">{t(note)}</p>}
        </div>
    )
}

export default ModulePicker
