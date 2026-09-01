/**
 * =============================================================================
 * HERMES - Arsivleme onayi
 * =============================================================================
 * SILME DEGIL: metin bunu acikca soyler. Kayit korunur, geri alinabilir.
 * Hata durumunda modal ACIK kalir (mutation onError kapatmaz) — kapanmasi
 * "arsivlendi" izlenimi verirdi.
 * =============================================================================
 */
import { InboxOutlined } from '@ant-design/icons'
import { Modal } from 'antd'

import { typeMeta } from '../../../utils/workItemType'
import { useT } from '../../../i18n'

function TaskArchiveModal({ item, loading, onCancel, onConfirm }) {
    const t = useT()
    const meta = typeMeta(item?.kind || item?.representative?.task_type)
    const count = item?.assignments?.length || 0
    return (
        <Modal
            open={!!item}
            title={`Archive ${meta.singular}`}
            okText={t('lifecycle.archiveNow')}
            okButtonProps={{ icon: <InboxOutlined />, loading }}
            cancelButtonProps={{ disabled: loading }}
            closable={!loading}
            maskClosable={!loading}
            onOk={onConfirm}
            onCancel={onCancel}
            destroyOnHidden
        >
            <p style={{ marginTop: 0 }}>
                <strong>{item?.title}</strong>
            </p>
            <p style={{ color: 'var(--h-text-secondary)' }}>
                This moves the {meta.lower} out of the Active workspace.
                Nothing is deleted — history, comments and logged time stay
                exactly as they are, and you can restore it later.
            </p>
            {count > 1 && (
                <p style={{ color: 'var(--h-text-secondary)' }}>
                    All {count} assignments of this work item are archived
                    together.
                </p>
            )}
        </Modal>
    )
}

export default TaskArchiveModal
