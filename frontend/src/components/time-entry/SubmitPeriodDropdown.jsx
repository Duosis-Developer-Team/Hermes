/**
 * =============================================================================
 * HERMES - Submit Period Dropdown Component (Jira Tempo Style)
 * =============================================================================
 * Period durumlarını gösteren dropdown - Timesheets başlıklı panel
 * =============================================================================
 */

import { useState } from 'react'
import { Dropdown, Button, Tag } from 'antd'
import { DownOutlined, UpOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import './SubmitPeriodDropdown.css'

function formatDuration(decimal) {
    if (!decimal) return '0h'
    const h = Math.floor(decimal)
    const m = Math.round((decimal - h) * 60)
    if (m > 0) return `${h}h ${m}m`
    return `${h}h`
}

function SubmitPeriodDropdown({
    periods = [],
    onOpenSubmitModal
}) {
    const [open, setOpen] = useState(false)
    const [showFuturePeriods, setShowFuturePeriods] = useState(false)
    const [showPastPeriods, setShowPastPeriods] = useState(false)

    // Demo periods (gerçek veriler backend'den gelecek)
    const demoPeriods = periods.length > 0 ? periods : [
        {
            id: 'current',
            name: 'Current period',
            status: 'OPEN',
            statusColor: 'blue',
            startDate: dayjs().startOf('month'),
            endDate: dayjs().endOf('month'),
            hoursLogged: 3,
            hoursRequired: 176,
            behind: 93
        },
        {
            id: 'last',
            name: 'Last period',
            status: 'READY TO SUBMIT',
            statusColor: 'orange',
            startDate: dayjs().subtract(1, 'month').startOf('month'),
            endDate: dayjs().subtract(1, 'month').endOf('month'),
            hoursLogged: 174.5,
            hoursRequired: 184,
            behind: 9.5
        }
    ]

    // Period progress hesapla
    const getProgressPercent = (logged, required) => {
        return Math.min((logged / required) * 100, 100)
    }

    // Period kartı render
    const renderPeriodCard = (period) => {
        const progress = getProgressPercent(period.hoursLogged, period.hoursRequired)
        const progressColor = progress >= 100 ? '#10b981' :
            progress >= 80 ? '#facc15' : '#3b82f6'

        return (
            <div key={period.id} className="period-card">
                <div className="period-card-header">
                    <span className="period-name">{period.name}</span>
                    <Tag color={period.statusColor} className="period-status">
                        {period.status}
                    </Tag>
                    {period.behind > 0 && (
                        <span className="period-behind">{formatDuration(period.behind)} behind</span>
                    )}
                    <Button
                        type="text"
                        className="period-submit-btn"
                        onClick={(e) => {
                            e.stopPropagation()
                            onOpenSubmitModal?.(period)
                        }}
                    >
                        Submit
                    </Button>
                </div>

                <div className="period-progress-bar">
                    <div
                        className="period-progress-fill"
                        style={{
                            width: `${progress}%`,
                            background: progressColor
                        }}
                    />
                </div>

                <div className="period-card-footer">
                    <span className="period-dates">
                        {period.startDate.format('DD/MMM/YY')} - {period.endDate.format('DD/MMM/YY')}
                    </span>
                    <span className="period-hours">
                        {formatDuration(period.hoursLogged)}/{formatDuration(period.hoursRequired)}
                    </span>
                </div>
            </div>
        )
    }

    // Dropdown content
    const dropdownContent = (
        <div className="submit-period-panel">
            <div className="panel-title">Timesheets</div>

            {/* Show future periods toggle */}
            <button
                className="periods-toggle"
                onClick={() => setShowFuturePeriods(!showFuturePeriods)}
            >
                {showFuturePeriods ? <UpOutlined /> : <DownOutlined />}
                Show future periods
                {showFuturePeriods ? <UpOutlined /> : <DownOutlined />}
            </button>

            {/* Period cards */}
            <div className="periods-list">
                {demoPeriods.map(renderPeriodCard)}
            </div>

            {/* Show past periods toggle */}
            <div className="panel-footer">
                <button
                    className="periods-toggle"
                    onClick={() => setShowPastPeriods(!showPastPeriods)}
                >
                    {showPastPeriods ? <UpOutlined /> : <DownOutlined />}
                    Show past periods
                    {showPastPeriods ? <UpOutlined /> : <DownOutlined />}
                </button>
                <button className="approval-log-link">
                    Approval Log
                </button>
            </div>
        </div>
    )

    // Current period for button label
    const activePeriod = demoPeriods[0]
    const buttonLabel = activePeriod
        ? `Submit Period ${activePeriod.startDate.format('DD/MMM/YY')}`
        : 'Submit Period'

    return (
        <div className="submit-period-group">
            <Button
                className="submit-period-main-btn"
                onClick={() => onOpenSubmitModal?.(activePeriod || demoPeriods[0])}
            >
                {buttonLabel}
            </Button>

            <Dropdown
                open={open}
                onOpenChange={setOpen}
                /* AntD 5.x: dropdownRender deprecated → popupRender.
                   Console uyarisi Sprint 4 QA kapisinda yakalandi. */
                popupRender={() => dropdownContent}
                trigger={['click']}
                placement="bottomRight"
            >
                <Button className="submit-period-arrow-btn">
                    <DownOutlined />
                </Button>
            </Dropdown>
        </div>
    )
}

export default SubmitPeriodDropdown
