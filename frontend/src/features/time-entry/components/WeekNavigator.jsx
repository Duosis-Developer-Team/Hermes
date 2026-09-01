/**
 * HERMES - Time Entry hafta navigasyonu + haftalik ozet (Sprint 5).
 * TimeEntryPage'den DAVRANIS DEGISMEDEN cikarildi: ayni markup, ayni
 * siniflar, ayni handler sozlesmesi. Sayfa artik yalnizca orchestrasyon
 * yapar (CTO'nun Sprint 4'ten devreden mimari borcu).
 */
import { Button } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import { useT } from '../../../i18n'

function WeekNavigator({
    weekLabel, totalLabel, targetLabel = '/ 40h',
    onPrevious, onNext, onToday,
}) {
    const t = useT()
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
                    <span className="summary-target">{targetLabel}</span>
                </div>
            </div>
        </div>
    )
}

export default WeekNavigator
