/**
 * =============================================================================
 * HERMES - WorkLog Card Component (Jira Tempo Style - Redesigned)
 * =============================================================================
 * Jira style worklog kart - Checkmark icon, issue key, clean hour format
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

function WorkLogCard({ workLog, onEdit, onDelete }) {
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
        <div className="worklog-card">
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

            {/* Hover actions */}
            <div className="worklog-card-actions">
                <Tooltip title="Edit">
                    <button
                        className="worklog-action-btn"
                        onClick={() => onEdit?.(workLog)}
                    >
                        <EditOutlined />
                    </button>
                </Tooltip>
                <Tooltip title="Delete">
                    <button
                        className="worklog-action-btn delete"
                        onClick={() => onDelete?.(workLog)}
                    >
                        <DeleteOutlined />
                    </button>
                </Tooltip>
            </div>
        </div>
    )
}

export default WorkLogCard
