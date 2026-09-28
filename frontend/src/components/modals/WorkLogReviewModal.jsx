/**
 * =============================================================================
 * HERMES - Efor kaydi inceleme penceresi (Hermes Liquid)
 * =============================================================================
 * Is incelemesiyle ayni dil: ikonlu baslik (musteri · proje), anahtar–deger
 * izgarasi, aciklama ve cam alt cubuk (Sil | Kapat · Duzenle). Veri cagiran
 * sayfadan gelir; bu pencere istek atmaz. Duzenle/Sil cagiranin mevcut
 * akislarini acar (LogTimeModal / DangerConfirmModal).
 * =============================================================================
 */
import { Button, Modal } from 'antd'
import { ClockCircleOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

import { ModalHead } from '../liquid'
import { formatHours } from '../../features/time-entry/model/timeEntry'
import { useT } from '../../i18n'

function Row({ label, children }) {
    if (children === null || children === undefined || children === '') return null
    return (
        <>
            <dt>{label}</dt>
            <dd>{children}</dd>
        </>
    )
}

function WorkLogReviewModal({ log, onClose, onEdit, onDelete }) {
    const t = useT()
    const title = log
        ? [log.customer_name, log.project_name].filter(Boolean).join(' · ') || t('workLog.untitled')
        : ''
    return (
        <Modal
            open={!!log}
            onCancel={onClose}
            footer={null}
            width={600}
            destroyOnHidden
            className="worklog-review-modal"
            title={log && (
                <ModalHead
                    icon={<ClockCircleOutlined />}
                    tone="green"
                    title={title}
                    subtitle={`${dayjs(log.date_worked).format('dddd, D MMMM YYYY')} · ${formatHours(log.duration_hours)}`}
                />
            )}
        >
            {log && (
                <>
                    <dl className="lq-kv">
                        <Row label={t('entity.customer')}>{log.customer_name}</Row>
                        <Row label={t('entity.project')}>{log.project_name}</Row>
                        <Row label={t('reports.date')}>{dayjs(log.date_worked).format('D MMM YYYY')}</Row>
                        <Row label={t('logTime.duration')}>
                            <span className="lq-tag lq-tag--ok">{formatHours(log.duration_hours)}</span>
                        </Row>
                        <Row label={t('logTime.workType')}>{log.work_type_name}</Row>
                        <Row label={t('logTime.activityType')}>{log.activity_type_name}</Row>
                        <Row label={t('logTime.platform')}>{log.platform_name}</Row>
                        <Row label={t('logTime.workLine')}>{log.work_line_name}</Row>
                        <Row label={t('entity.user')}>{log.user_name}</Row>
                        <Row label={t('workLog.linkedItem')}>{log.work_item_id ? t('workLog.linked') : null}</Row>
                        <Row label={t('workLog.updated')}>
                            {log.updated_at ? dayjs(log.updated_at).format('D MMM YYYY HH:mm') : null}
                        </Row>
                    </dl>
                    {log.description && (
                        <>
                            <h3 className="lq-grp">{t('common.description')}</h3>
                            <p className="worklog-review-desc">{log.description}</p>
                        </>
                    )}
                    <div className="lq-mf">
                        <span className="lq-mf__left">
                            {onDelete && (
                                <Button danger icon={<DeleteOutlined />} onClick={() => onDelete(log)}>
                                    {t('common.delete')}
                                </Button>
                            )}
                        </span>
                        <Button onClick={onClose}>{t('common.close')}</Button>
                        {onEdit && (
                            <Button type="primary" icon={<EditOutlined />} onClick={() => onEdit(log)}>
                                {t('common.edit')}
                            </Button>
                        )}
                    </div>
                </>
            )}
        </Modal>
    )
}

export default WorkLogReviewModal
