/**
 * =============================================================================
 * HERMES - Geri al ve yeniden ac
 * =============================================================================
 * Yalniz arsivden cikarmak YETMEZ: is terminal kalirsa otomatik job bir
 * sonraki kosuda onu yeniden arsivler. Bu yuzden HANGI assignment'in
 * yeniden acilacagi ACIKCA secilir.
 *
 * Tam olarak bir uygun assignment varsa acikca gosterilir ve secili
 * gelir; birden fazlaysa SESSIZ toplu reopen YAPILMAZ — kullanici
 * secmeden onay dugmesi calismaz.
 * =============================================================================
 */
import { useEffect, useMemo, useState } from 'react'
import { Modal, Radio, Select, Space } from 'antd'

import { assigneeLabelOf } from '../model/grouping'
import { useT } from '../../../i18n'

// Durum -> ceviri ANAHTARI. Durum kodlari API sozlesmesidir ve
// degismez; yalnizca gosterilen metin cevrilir.
const STATUS_LABEL_KEY = {
    pending: 'plan.pending',
    in_progress: 'board.inProgress',
    completed: 'board.completed',
    rejected: 'plan.rejected',
}

function TaskRestoreModal({ item, loading, onCancel, onConfirm }) {
    const t = useT()
    // Referans kararli: her render'da yeni bos dizi uretilirse
    // asagidaki effect surekli yeniden kosardi.
    const assignments = useMemo(() => item?.assignments || [], [item])
    const single = assignments.length === 1
    const [selected, setSelected] = useState(null)
    const [targetStatus, setTargetStatus] = useState('in_progress')

    useEffect(() => {
        // Tek uygun assignment varsa secili gelir; birden fazlaysa
        // kullanici ACIKCA secer (sessiz toplu reopen yok).
        setSelected(single ? assignments[0].id : null)
        setTargetStatus('in_progress')
    }, [item, single, assignments])

    return (
        <Modal
            open={!!item}
            title={t('lifecycle.restoreAndReopen')}
            okText={t('lifecycle.restoreAndReopen')}
            okButtonProps={{ disabled: !selected, loading }}
            cancelButtonProps={{ disabled: loading }}
            closable={!loading}
            maskClosable={!loading}
            onOk={() => selected && onConfirm({
                assignmentTaskId: selected, targetStatus,
            })}
            onCancel={onCancel}
            destroyOnHidden
        >
            <p style={{ marginTop: 0 }}><strong>{item?.title}</strong></p>
            <p style={{ color: 'var(--h-text-secondary)' }}>
                Choose which assignment goes back to work. The others keep
                their current status, and nothing is logged on anyone
                else&apos;s behalf.
            </p>

            <Radio.Group
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                style={{ width: '100%' }}
            >
                <Space direction="vertical" style={{ width: '100%' }}>
                    {assignments.map((a) => (
                        <Radio key={a.id} value={a.id}>
                            {assigneeLabelOf(a)}
                            {' — '}
                            {STATUS_LABEL_KEY[a.status] ? t(STATUS_LABEL_KEY[a.status]) : a.status}
                        </Radio>
                    ))}
                </Space>
            </Radio.Group>

            <div style={{ marginTop: 16 }}>
                <label
                    htmlFor="restore-target-status"
                    style={{ display: 'block', marginBottom: 6,
                             color: 'var(--h-text-secondary)' }}
                >{t('lifecycle.reopenAs')}</label>
                <Select
                    id="restore-target-status"
                    aria-label={t('lifecycle.reopenAs')}
                    value={targetStatus}
                    onChange={setTargetStatus}
                    style={{ width: 200 }}
                    options={[
                        { value: 'in_progress', label: t('board.inProgress') },
                        { value: 'pending', label: t('plan.pending') },
                    ]}
                />
            </div>
        </Modal>
    )
}

export default TaskRestoreModal
