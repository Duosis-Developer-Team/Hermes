/**
 * =============================================================================
 * HERMES - WorkLog Card Component (Jira Tempo Style - Redesigned)
 * =============================================================================
 * Jira style worklog kart - Checkmark icon, issue key, clean hour format.
 * isSelected: copy-paste seçili durumu — mavi çerçeve
 * onSelect: kart tıklandığında çağrılır (copy-paste için log seçimi)
 * =============================================================================
 */

import { Tooltip } from 'antd'
import { CheckSquareOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { formatHours } from '../../features/time-entry/model/timeEntry'
import './WorkLogCard.css'


function WorkLogCard({
    workLog, onEdit, onDelete, isSelected = false, isCopied = false, onSelect,
}) {
    const {
        project_name,
        customer_name,
        customer_code,
        description,
        duration_hours,
    } = workLog

    // Issue key gösterimi (müşteri kodu veya kısaltma)
    const issueKey = customer_code || customer_name?.substring(0, 5).toUpperCase() || 'KEY'

    return (
        <div
            className={
                'worklog-card'
                + (isSelected ? ' worklog-card-selected' : '')
                + (isCopied ? ' worklog-card-copied' : '')
            }
            role="button"
            tabIndex={0}
            aria-pressed={isSelected}
            /* Durum yalnizca RENKLE anlatilmaz: erisilebilir ad ile de
               bildirilir (renk korlugu / ekran okuyucu — CTO §5). */
            aria-label={
                `${project_name || 'Project'}, ${formatHours(duration_hours)}`
                + (isCopied ? ' — panoya kopyalandi' : '')
                + (isSelected ? ' — secili' : '')
            }
            onClick={(e) => {
                e.stopPropagation() // Prevent bubbling to DayColumn (which would set targetDate)
                onSelect?.(workLog.id)
            }}
            onKeyDown={(e) => {
                // Klavye ile secim (§ erisilebilirlik): kart bir buton gibi
                // davranir; Space sayfayi kaydirmaz.
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    e.stopPropagation()
                    onSelect?.(workLog.id)
                }
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
                        aria-label="Kaydı düzenle"
                        onClick={(e) => { e.stopPropagation(); onEdit?.(workLog) }}
                    >
                        <EditOutlined />
                    </button>
                </Tooltip>
                <Tooltip title="Delete">
                    <button
                        className="worklog-action-btn delete"
                        aria-label="Kaydı sil"
                        onClick={(e) => { e.stopPropagation(); onDelete?.(workLog) }}
                    >
                        <DeleteOutlined />
                    </button>
                </Tooltip>
            </div>

            {/* Durum rozeti — metin tasir, yalniz renk degil. */}
            {(isCopied || isSelected) && (
                <div
                    className={
                        'worklog-selected-badge'
                        + (isCopied ? ' is-copied' : '')
                    }
                    title={isCopied ? 'Panoda — hedef gün seçip Ctrl+V' : 'Ctrl+C ile kopyala'}
                >
                    {isCopied ? 'COPIED' : 'C'}
                </div>
            )}
        </div>
    )
}

export default WorkLogCard
