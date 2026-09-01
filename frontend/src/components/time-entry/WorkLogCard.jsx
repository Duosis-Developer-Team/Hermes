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
import { useT } from '../../i18n'


function WorkLogCard({
    workLog, onEdit, onDelete, isSelected = false, isCopied = false, onSelect,
}) {
    const t = useT()
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
        /*
         * KOK ARTIK INTERAKTIF DEGIL (Sprint 7 final QA bulgusu).
         * Onceden `role="button" tabIndex={0}` idi ve ICINDE duzenle/sil
         * butonlari vardi — TaskCard'daki ile ayni gecersiz ic ice
         * semantik. Ayni recete uygulandi: kok sade kapsayici (fare
         * tiklamasi korunur), secim islemi icin baslik GERCEK bir buton
         * (klavye, odak halkasi, aria-pressed ve erisilebilir ad onda).
         */
        <div
            className={
                'worklog-card'
                + (isSelected ? ' worklog-card-selected' : '')
                + (isCopied ? ' worklog-card-copied' : '')
            }
            onClick={(e) => {
                e.stopPropagation() // Prevent bubbling to DayColumn (which would set targetDate)
                onSelect?.(workLog.id)
            }}
        >
            <button
                type="button"
                className="worklog-card-title worklog-card-open"
                aria-pressed={isSelected}
                /* Durum yalnizca RENKLE anlatilmaz: erisilebilir ad ile
                   de bildirilir (renk korlugu / ekran okuyucu — CTO §5). */
                aria-label={
                    `${project_name || 'Project'}, ${formatHours(duration_hours)}`
                    + (isCopied ? ' — copied to clipboard' : '')
                    + (isSelected ? ' — selected' : '')
                }
                onClick={(e) => {
                    // Kok da ayni islemi tetikler; tekrari onle.
                    e.stopPropagation()
                    onSelect?.(workLog.id)
                }}
            >
                {project_name || 'Project'}
            </button>

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
                <Tooltip title={t('common.edit')}>
                    <button
                        className="worklog-action-btn"
                        aria-label={t('workLog.editLog')}
                        onClick={(e) => { e.stopPropagation(); onEdit?.(workLog) }}
                    >
                        <EditOutlined />
                    </button>
                </Tooltip>
                <Tooltip title={t('common.delete')}>
                    <button
                        className="worklog-action-btn delete"
                        aria-label={t('workLog.deleteLog')}
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
                    title={isCopied ? 'On clipboard — pick a target day and press Ctrl+V' : 'Copy with Ctrl+C'}
                >
                    {isCopied ? 'COPIED' : 'C'}
                </div>
            )}
        </div>
    )
}

export default WorkLogCard
