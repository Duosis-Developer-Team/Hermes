/**
 * =============================================================================
 * HERMES - WorkLog Card Component (Jira Tempo Style - Redesigned)
 * =============================================================================
 * Jira style worklog kart - Checkmark icon, issue key, clean hour format.
 * isSelected: copy-paste seçili durumu — mavi çerçeve
 * onSelect: kart tıklandığında çağrılır (copy-paste için log seçimi)
 * =============================================================================
 */

import { Tag, Tooltip } from 'antd'
import { CheckSquareOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import './WorkLogCard.css'

// Format decimal hours → "2h 30m" (handles legacy data: 2.5 → 2h 30m)
const formatHours = (hours) => {
    if (!hours && hours !== 0) return '0h'
    const num = parseFloat(hours)
    const h = Math.floor(num)
    const m = Math.round((num - h) * 60)
    if (m === 0) return `${h}h`
    return `${h}h ${m}m`
}

function WorkLogCard({ workLog, onEdit, onDelete, isSelected = false, onSelect }) {
    const {
        project_name,
        customer_name,
        customer_code,
        description,
        duration_hours,
        work_type_name
    } = workLog

    // Issue key gösterimi (müşteri kodu veya kısaltma)
    const issueKey = customer_code || customer_name?.substring(0, 5).toUpperCase() || 'KEY'

    return (
        <div
            className={`worklog-card${isSelected ? ' worklog-card-selected' : ''}`}
            onClick={(e) => {
                e.stopPropagation() // Prevent bubbling to DayColumn (which would set targetDate)
                onSelect?.(workLog.id)
            }}
        >
            {/* Proje Adı (Ana başlık) */}
            <div className="worklog-card-title">
                {project_name || 'Project'}
            </div>

            {/* Açıklama (Açık gri, kısaltılmış) */}
            {description && (
                <div className="worklog-card-description">
                    {description.length > 35
                        ? `${description.substring(0, 35)}...`
                        : description
                    }
                </div>
            )}

            {/* Alt kısım - Issue Key (checkmark icon ile) + Süre */}
            <div className="worklog-card-footer">
                <div className="worklog-issue-key">
                    <CheckSquareOutlined className="issue-key-icon" />
                    <span className="issue-key-text">{issueKey}</span>
                </div>
                <span className="worklog-card-duration">
                    {formatHours(duration_hours)}
                </span>
            </div>

            {/* Hover actions — stopPropagation so they don't trigger card select or day select */}
            <div className="worklog-card-actions">
                <Tooltip title="Edit">
                    <button
                        className="worklog-action-btn"
                        onClick={(e) => { e.stopPropagation(); onEdit?.(workLog) }}
                    >
                        <EditOutlined />
                    </button>
                </Tooltip>
                <Tooltip title="Delete">
                    <button
                        className="worklog-action-btn delete"
                        onClick={(e) => { e.stopPropagation(); onDelete?.(workLog) }}
                    >
                        <DeleteOutlined />
                    </button>
                </Tooltip>
            </div>

            {/* Selected indicator badge */}
            {isSelected && (
                <div className="worklog-selected-badge" title="Press Ctrl+C to copy">
                    C
                </div>
            )}
        </div>
    )
}

export default WorkLogCard
