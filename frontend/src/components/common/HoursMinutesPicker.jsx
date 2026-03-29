/**
 * =============================================================================
 * HERMES - HoursMinutesPicker Component
 * =============================================================================
 * Reusable Hours & Minutes picker with 15-min increment validation.
 * Designed for Ant Design Form.Item integration (value/onChange controlled).
 *
 * value  : decimal hours (e.g. 2.5 = 2h 30m)
 * onChange: called with decimal hours
 * =============================================================================
 */

import { useState, useEffect } from 'react'
import './HoursMinutesPicker.css'

// Decimal hours → { h, m } (m snapped to nearest 15 for legacy data)
function decimalToHM(decimal) {
    if (decimal === null || decimal === undefined || decimal === '') return { h: 0, m: 0 }
    const num = parseFloat(decimal)
    if (isNaN(num)) return { h: 0, m: 0 }
    const h = Math.floor(num)
    const rawM = Math.round((num - h) * 60)
    // Snap to nearest 15-min slot for legacy decimal values (e.g. 2.5 → 30)
    const m = Math.round(rawM / 15) * 15
    if (m >= 60) return { h: h + 1, m: 0 }
    return { h, m }
}

function HoursMinutesPicker({ value, onChange, disabled = false, size = 'default' }) {
    const [hours, setHours] = useState(0)
    const [hoursRaw, setHoursRaw] = useState('0')
    const [minutes, setMinutes] = useState(0)
    const [minutesRaw, setMinutesRaw] = useState('0') // what the input shows
    const [minutesError, setMinutesError] = useState('')

    // Sync from external value (Form.Item sets this on mount/edit)
    useEffect(() => {
        const { h, m } = decimalToHM(value)
        setHours(h)
        setHoursRaw(String(h))
        setMinutes(m)
        setMinutesRaw(String(m))
        setMinutesError('')
    }, [value])

    const emit = (h, m) => {
        onChange?.(h + m / 60)
    }

    // ── Hours ──────────────────────────────────────────────────────────────────

    const handleHoursChange = (e) => {
        const raw = e.target.value.replace(/[^0-9]/g, '')
        setHoursRaw(raw)
        const parsed = parseInt(raw, 10)
        const newH = isNaN(parsed) ? 0 : Math.max(0, parsed)
        setHours(newH)
        emit(newH, minutes)
    }

    const handleHoursBlur = () => {
        setHoursRaw(String(hours))
    }

    const incrementHours = (e) => {
        e.preventDefault()
        const newH = hours + 1
        setHours(newH)
        setHoursRaw(String(newH))
        emit(newH, minutes)
    }

    const decrementHours = (e) => {
        e.preventDefault()
        const newH = Math.max(0, hours - 1)
        setHours(newH)
        setHoursRaw(String(newH))
        emit(newH, minutes)
    }

    // ── Minutes ────────────────────────────────────────────────────────────────

    // Snap to next 15-min slot above current value
    const nextSlot = (current) => Math.ceil((current + 1) / 15) * 15
    // Snap to prev 15-min slot below current value
    const prevSlot = (current) => Math.floor((current - 1) / 15) * 15

    const incrementMinutes = (e) => {
        e.preventDefault()
        setMinutesError('')
        const next = nextSlot(minutes)
        if (next >= 60) {
            const newH = hours + 1
            setHours(newH)
            setMinutes(0)
            setMinutesRaw('0')
            emit(newH, 0)
        } else {
            setMinutes(next)
            setMinutesRaw(String(next))
            emit(hours, next)
        }
    }

    const decrementMinutes = (e) => {
        e.preventDefault()
        setMinutesError('')
        const prev = prevSlot(minutes)
        if (prev < 0) {
            if (hours > 0) {
                const newH = hours - 1
                setHours(newH)
                setMinutes(45)
                setMinutesRaw('45')
                emit(newH, 45)
            }
        } else {
            setMinutes(prev)
            setMinutesRaw(String(prev))
            emit(hours, prev)
        }
    }

    // Manual minute input — allow free typing, validate on blur
    const handleMinutesChange = (e) => {
        const raw = e.target.value.replace(/[^0-9]/g, '')
        setMinutesRaw(raw)
        const parsed = parseInt(raw, 10)
        if (!isNaN(parsed)) setMinutes(parsed)
    }

    const handleMinutesBlur = () => {
        const validSlots = [0, 15, 30, 45]
        const parsed = parseInt(minutesRaw, 10)
        if (isNaN(parsed) || parsed < 0 || parsed > 59) {
            setMinutesError('Minutes must be in increments of 15 (0, 15, 30, 45).')
            return
        }
        if (!validSlots.includes(parsed)) {
            setMinutesError('Minutes must be in increments of 15 (0, 15, 30, 45).')
            setMinutes(parsed) // keep raw value visible, let user fix
        } else {
            setMinutesError('')
            setMinutes(parsed)
            setMinutesRaw(String(parsed))
            emit(hours, parsed)
        }
    }

    return (
        <div className={`hmp-root${disabled ? ' hmp-disabled' : ''}${size === 'small' ? ' hmp-small' : ''}`}>
            <div className="hmp-fields">
                {/* Hours */}
                <div className="hmp-group">
                    <button
                        type="button"
                        className="hmp-btn"
                        onClick={decrementHours}
                        disabled={disabled || hours <= 0}
                        tabIndex={-1}
                    >−</button>
                    <input
                        className="hmp-input"
                        type="text"
                        inputMode="numeric"
                        value={hoursRaw}
                        onChange={handleHoursChange}
                        onBlur={handleHoursBlur}
                        onFocus={(e) => e.target.select()}
                        disabled={disabled}
                    />
                    <button
                        type="button"
                        className="hmp-btn"
                        onClick={incrementHours}
                        disabled={disabled}
                        tabIndex={-1}
                    >+</button>
                    <span className="hmp-unit">h</span>
                </div>

                {/* Minutes */}
                <div className="hmp-group">
                    <button
                        type="button"
                        className="hmp-btn"
                        onClick={decrementMinutes}
                        disabled={disabled || (hours <= 0 && minutes <= 0)}
                        tabIndex={-1}
                    >−</button>
                    <input
                        className={`hmp-input${minutesError ? ' hmp-input-error' : ''}`}
                        type="text"
                        inputMode="numeric"
                        value={minutesRaw}
                        onChange={handleMinutesChange}
                        onBlur={handleMinutesBlur}
                        onFocus={(e) => e.target.select()}
                        disabled={disabled}
                    />
                    <button
                        type="button"
                        className="hmp-btn"
                        onClick={incrementMinutes}
                        disabled={disabled}
                        tabIndex={-1}
                    >+</button>
                    <span className="hmp-unit">m</span>
                </div>
            </div>

            {minutesError && (
                <div className="hmp-error-msg">{minutesError}</div>
            )}
        </div>
    )
}

export default HoursMinutesPicker
