/**
 * =============================================================================
 * HERMES - Timesheet View Component (Jira Tempo Style)
 * =============================================================================
 * Tablo formatında zaman görünümü - Jira Tempo Timesheet tarzı.
 * Issue + Key ayrı sütunlar, grid çizgileri, 1h format
 * =============================================================================
 */

import { useMemo } from 'react'
import { Table, Checkbox } from 'antd'
import { CheckSquareOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import './TimesheetView.css'
import { useT } from '../../i18n'

// 0.75 → "45m", 2.75 → "2h 45m", 2.0 → "2h"
function formatDuration(decimal) {
    if (!decimal) return ''
    const h = Math.floor(decimal)
    const m = Math.round((decimal - h) * 60)
    if (m > 0) return `${h}h ${m}m`
    return `${h}h`
}

function TimesheetView({
    weekStart,
    workLogs = [],
    onCellClick,
}) {
    const t = useT()
    // Haftanın günlerini hesapla (2 hafta gösterilecek - 14 gün)
    const displayDays = useMemo(() => {
        const days = []
        // Sadece mevcut hafta (7 gün)
        for (let i = 0; i < 7; i++) {
            days.push(dayjs(weekStart).add(i, 'day'))
        }
        return days
    }, [weekStart])

    // Worklogs'u proje bazında grupla
    const projectGroups = useMemo(() => {
        const groups = {}

        workLogs.forEach(log => {
            const key = `${log.project_id}`
            if (!groups[key]) {
                groups[key] = {
                    project_id: log.project_id,
                    project_name: log.project_name,
                    customer_name: log.customer_name,
                    customer_code: log.customer_code || log.customer_name?.substring(0, 3).toUpperCase(),
                    customer_id: log.customer_id,
                    logs: [],
                    totalHours: 0,
                    hoursByDate: {}
                }
            }
            const dateKey = log.date_worked
            if (!groups[key].hoursByDate[dateKey]) {
                groups[key].hoursByDate[dateKey] = 0
            }
            groups[key].logs.push(log)
            groups[key].totalHours += parseFloat(log.duration_hours) || 0
            groups[key].hoursByDate[dateKey] += parseFloat(log.duration_hours) || 0
        })

        return Object.values(groups)
    }, [workLogs])

    // Günlük toplamlar
    const dailyTotals = useMemo(() => {
        const totals = {}
        displayDays.forEach(day => {
            const dateKey = day.format('YYYY-MM-DD')
            totals[dateKey] = workLogs
                .filter(log => log.date_worked === dateKey)
                .reduce((sum, log) => sum + (parseFloat(log.duration_hours) || 0), 0)
        })
        return totals
    }, [displayDays, workLogs])

    // Genel toplam
    const grandTotal = workLogs.reduce((sum, log) => sum + (parseFloat(log.duration_hours) || 0), 0)

    // Sütunlar
    const columns = [
        // Checkbox column
        {
            title: '',
            key: 'checkbox',
            fixed: 'left',
            width: 40,
            render: () => <Checkbox className="timesheet-checkbox" />,
        },
        // Issue (Proje) column
        {
            title: t('timesheet.issue'),
            dataIndex: 'project_name',
            key: 'issue',
            fixed: 'left',
            width: 250,
            render: (text) => (
                <div className="timesheet-issue-cell">
                    <CheckSquareOutlined className="timesheet-issue-icon" />
                    <span className="timesheet-issue-name">{text}</span>
                </div>
            ),
        },
        // Key (Müşteri Kodu) column
        {
            title: t('timesheet.key'),
            dataIndex: 'customer_code',
            key: 'key',
            fixed: 'left',
            width: 100,
            render: (text) => (
                <span className="timesheet-key-link">{text || '-'}</span>
            ),
        },
        // Logged (Toplam) column
        {
            title: t('timesheet.logged'),
            dataIndex: 'totalHours',
            key: 'logged',
            width: 70,
            align: 'center',
            render: (hours) => (
                <span className="timesheet-logged-hours">{formatDuration(hours)}</span>
            ),
        },
        // Day columns
        ...displayDays.map(day => {
            const dateKey = day.format('YYYY-MM-DD')
            const dayNum = day.format('DD')
            const dayName = day.format('ddd').toUpperCase()
            const isToday = dateKey === dayjs().format('YYYY-MM-DD')
            const isWeekend = day.day() === 0 || day.day() === 6

            return {
                title: (
                    <div
                        className={`timesheet-day-header ${isToday ? 'today h-today-flag' : ''} ${isWeekend ? 'weekend' : ''}`}
                        aria-current={isToday ? 'date' : undefined}
                    >
                        <span className="day-num">{dayNum}</span>
                        <span className="day-name">{dayName}</span>
                    </div>
                ),
                dataIndex: ['hoursByDate', dateKey],
                key: dateKey,
                width: 50,
                align: 'center',
                className: `timesheet-day-cell ${isToday ? 'today' : ''} ${isWeekend ? 'weekend' : ''}`,
                render: (hours, record) => (
                    <div
                        className={`timesheet-hours-cell ${hours ? 'has-value' : ''}`}
                        onClick={() => onCellClick?.(record, dateKey)}
                    >
                        {hours ? formatDuration(hours) : ''}
                    </div>
                ),
            }
        }),
    ]

    // Tablo verileri
    const dataSource = projectGroups.map((group, index) => ({
        ...group,
        key: group.project_id || index,
    }))

    // Footer (Total row)
    return (
        <div className="timesheet-view">
            <Table
                dataSource={dataSource}
                columns={columns}
                pagination={false}
                scroll={{ x: 900 }}
                size="small"
                className="timesheet-table"
                locale={{ emptyText: t('timesheet.noEntries') }}
                rowClassName="timesheet-row"
                summary={() => {
                    return (
                        <Table.Summary fixed>
                            <Table.Summary.Row className="timesheet-total-row">
                                <Table.Summary.Cell index={0} colSpan={3} className="timesheet-total-label">{t('timesheet.total')}</Table.Summary.Cell>
                                <Table.Summary.Cell index={1} className="timesheet-total-value">
                                    {formatDuration(grandTotal) || '0h'}
                                </Table.Summary.Cell>
                                {displayDays.map((day, i) => {
                                    const dateKey = day.format('YYYY-MM-DD')
                                    const isWeekend = day.day() === 0 || day.day() === 6
                                    return (
                                        <Table.Summary.Cell
                                            key={dateKey}
                                            index={i + 2}
                                            className={`timesheet-total-day ${isWeekend ? 'weekend' : ''}`}
                                        >
                                            {formatDuration(dailyTotals[dateKey]) || 0}
                                        </Table.Summary.Cell>
                                    )
                                })}
                            </Table.Summary.Row>
                        </Table.Summary>
                    )
                }}
            />

            {/* Bottom progress bar */}
            <div className="timesheet-progress-bar">
                <div
                    className="timesheet-progress-fill"
                    style={{ width: `${Math.min((grandTotal / 40) * 100, 100)}%` }}
                />
            </div>
        </div>
    )
}

export default TimesheetView
