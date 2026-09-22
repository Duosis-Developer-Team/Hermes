/**
 * HERMES - Time Entry hafta navigasyonu + haftalik ozet (Sprint 5).
 * TimeEntryPage'den DAVRANIS DEGISMEDEN cikarildi: ayni markup, ayni
 * siniflar, ayni handler sozlesmesi. Sayfa artik yalnizca orchestrasyon
 * yapar (CTO'nun Sprint 4'ten devreden mimari borcu).
 *
 * PM rework P0 / D2: hedef artik KAPASITE'den gelir (kiraci varsayilani,
 * kullanici override, tatil/izin dusulmus) ve haftada bos kalan gunler
 * tek satirla, sari, suclayici olmadan soylenir. Kapasite verisi yoksa
 * eski "/ 40h" AYNEN kalir.
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

    return (
        <div className="time-entry-header">
            <div className="header-left">
                <div className="week-nav">
                    <Button
                        type="text"
                        icon={<LeftOutlined />}
                        onClick={onPrevious}
                        className="nav-btn"
                        aria-label={t('meetings.previousWeek')}
                    />
                    <span className="week-label">{weekLabel}</span>
                    <Button
                        type="text"
                        icon={<RightOutlined />}
                        onClick={onNext}
                        className="nav-btn"
                        aria-label={t('meetings.nextWeek')}
                    />
                </div>
                <Button onClick={onToday} className="today-btn">{t('meetings.today')}</Button>
            </div>

            <div className="header-right">
                <div className="week-summary">
                    <span className="summary-label">Week:</span>
                    <span className="summary-hours">{totalLabel}</span>
                    <span className="summary-target">{target}</span>
                    {fillPercent !== null && fillPercent !== undefined && (
                        <span className="summary-fill">
                            {t('timeEntry.weekFill', { percent: fillPercent })}
                        </span>
                    )}
                </div>
                {missingDays.length > 0 && (
                    <div className="week-missing" role="status">
                        <span className="week-missing-dot" aria-hidden="true" />
                        {t('timeEntry.missingDaysWeek', {
                            count: missingDays.length, days: missingLabels,
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}

export default WeekNavigator
