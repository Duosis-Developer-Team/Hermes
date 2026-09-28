/**
 * HERMES - Time Entry hafta ozet seridi.
 *
 * Hermes Liquid (28.09.2026): prototipteki cam ozet seridi — solda
 * onceki/Bugun/sonraki, ortada buyuk "girilen / beklenen" ve yuklenirken
 * soldan buyuyen dolum cubugu, sagda bos gunler hapi. Hedef KAPASITE'den
 * gelir (P0/D2); kapasite yoksa eski "/ 40h" aynen. Sinif sozlesmesi
 * (.summary-target, .summary-fill, .week-missing[role=status]) korunur.
 */
import { Button } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useT } from '../../../i18n'

const formatHours = (value) => {
    const n = Number(value)
    if (!Number.isFinite(n)) return '0'
    return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '')
}

function WeekNavigator({
    weekLabel, totalLabel, targetLabel = '/ 40h',
    capacity = null,
    onPrevious, onNext, onToday,
}) {
    const t = useT()
    const expectedTotal = capacity ? Number(capacity.expected_total) : null
    const target = expectedTotal !== null && Number.isFinite(expectedTotal)
        ? `/ ${formatHours(expectedTotal)}h`
        : targetLabel
    const fillPercent = capacity?.fill_percent
    const missingDays = Array.isArray(capacity?.missing_days) ? capacity.missing_days : []
    const missingLabels = missingDays.map((d) => dayjs(d).format('ddd')).join(', ')
    const width = Math.max(0, Math.min(100, Number(fillPercent) || 0))

    return (
        <div className="time-entry-header te-summary lq-card">
            <div className="week-nav">
                <Button
                    shape="circle"
                    icon={<LeftOutlined />}
                    onClick={onPrevious}
                    className="nav-btn"
                    aria-label={t('meetings.previousWeek')}
                />
                <Button onClick={onToday} className="today-btn">{t('meetings.today')}</Button>
                <Button
                    shape="circle"
                    icon={<RightOutlined />}
                    onClick={onNext}
                    className="nav-btn"
                    aria-label={t('meetings.nextWeek')}
                />
                <span className="week-label h-sr-only">{weekLabel}</span>
            </div>

            <div className="week-summary">
                <span className="summary-hours">{totalLabel}</span>
                <span className="summary-target">{target}</span>
            </div>

            <div className="te-summary__meter" aria-hidden="true">
                <i style={{ width: `${width}%` }} />
            </div>
            {fillPercent !== null && fillPercent !== undefined && (
                <span className="summary-fill">
                    {t('timeEntry.weekFill', { percent: fillPercent })}
                </span>
            )}

            {missingDays.length > 0 && (
                <div className="week-missing" role="status">
                    <span className="week-missing-dot" aria-hidden="true" />
                    {t('timeEntry.missingDaysWeek', {
                        count: missingDays.length, days: missingLabels,
                    })}
                </div>
            )}
        </div>
    )
}

export default WeekNavigator
