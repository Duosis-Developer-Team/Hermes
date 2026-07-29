/**
 * =============================================================================
 * HERMES - Zaman araligi seridi (Sprint 5C)
 * =============================================================================
 * All (tarihten bagimsiz kanban, varsayilan) ile Weekly arasinda gecis.
 * Weekly, pencereyi DUE DATE (termin) ile kurar ve hafta pager'ini acar;
 * All her gorunur kaydi tarihten bagimsiz gosterir.
 * =============================================================================
 */
import { Button, Space } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'

import { TASK_RANGE_MODES } from '../model/constants'

function TaskRangeBar({
    rangeMode, onSelectRange, weekStart, weekEnd,
    onPreviousWeek, onCurrentWeek, onNextWeek,
}) {
    return (
        <div
            className="tasks-body"
            style={{
                display: 'flex',
                justifyContent: 'flex-start',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 12,
                paddingTop: 10,
                paddingBottom: 0,
            }}
        >
            <div className="tasks-views" role="tablist" aria-label="Time range">
                {TASK_RANGE_MODES.map((m) => (
                    <button
                        key={m.value}
                        type="button"
                        role="tab"
                        aria-selected={rangeMode === m.value}
                        className={`tasks-views-pill${
                            rangeMode === m.value ? ' tasks-views-pill-active' : ''
                        }`}
                        onClick={() => onSelectRange(m.value)}
                    >
                        {m.label}
                    </button>
                ))}
            </div>
            {rangeMode === 'week' && (
                <Space wrap>
                    <Button
                        icon={<LeftOutlined />}
                        aria-label="Previous week"
                        onClick={onPreviousWeek}
                    />
                    <Button onClick={onCurrentWeek}>Today</Button>
                    <Button
                        icon={<RightOutlined />}
                        aria-label="Next week"
                        onClick={onNextWeek}
                    />
                    <span style={{ color: 'var(--c-text-strong)', fontWeight: 500 }}>
                        {weekStart.format('DD MMM')} –{' '}
                        {weekEnd.format('DD MMM, YYYY')}
                    </span>
                    <span style={{ color: 'var(--c-text-muted)', fontSize: 12 }}>
                        by due date
                    </span>
                </Space>
            )}
        </div>
    )
}

export default TaskRangeBar
