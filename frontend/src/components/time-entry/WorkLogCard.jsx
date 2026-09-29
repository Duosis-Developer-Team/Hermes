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
import { EditOutlined, DeleteOutlined, EyeOutlined } from '@ant-design/icons'
import { formatHours } from '../../features/time-entry/model/timeEntry'
import './WorkLogCard.css'
import { useT } from '../../i18n'
import { BrandLogos } from '../liquid'


function WorkLogCard({
    workLog, onEdit, onDelete, onReview, isSelected = false, isCopied = false, onSelect,
}) {
    const t = useT()
    const {
        project_id,
        project_name,
        customer_id,
        customer_name,
        description,
        duration_hours,
        work_type_name,
    } = workLog

    // Hermes Liquid (prototip): baslik "Musteri · Proje", alt satir
    // aciklama ya da is turu. Musteri kisaltma rozeti kalkti.
    const title = [customer_name, project_name].filter(Boolean).join(' \u00b7 ') || 'Project'
    const sub = description || work_type_name || ''

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
            {/* Ust satir (CTO 29.09): musteri + proje logolari solda buyuk,
                sure sagda; baslik altta tam genislik (dar gun kolonu). */}
            <div className="worklog-card-top" aria-hidden="true">
                <BrandLogos
                    customerId={customer_id}
                    customerName={customer_name}
                    projectId={project_id}
                    projectName={project_name}
                    size={34}
                    className="worklog-card-logo"
                />
                <span className="worklog-card-duration">{formatHours(duration_hours)}</span>
            </div>
            <div className="worklog-card-main">
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
                    <span className="worklog-card-name">{title}</span>
                </button>

                {sub && <div className="worklog-card-description">{sub}</div>}
            </div>

            {/* Hover actions — stopPropagation so they don't trigger card select or day select */}
            <div className="worklog-card-actions">
                {onReview && (
                    <Tooltip title={t('workLog.reviewLog')}>
                        <button
                            className="worklog-action-btn"
                            aria-label={t('workLog.reviewLog')}
                            onClick={(e) => { e.stopPropagation(); onReview(workLog) }}
                        >
                            <EyeOutlined />
                        </button>
                    </Tooltip>
                )}
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
